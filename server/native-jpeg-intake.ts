import {eq,sql} from "drizzle-orm";
import {db} from "./db";
import {mediaReservations,mediaItems,mediaUploadSessions,type InsertMediaItem} from "@shared/schema";
import {getObjectStore,R2Store,ObjectStoreError} from "./object-store";
import {databaseMultipartContext} from "./r2-multipart-journal";
import {uploadR2MultipartFile,cancelR2Multipart,MultipartUploadError,type MultipartPlan} from "./r2-multipart-upload";
import {prepareMultipartJpeg} from "./r2-multipart-jpeg";
import {registerValidatedMultipart,cleanupMultipartStaging} from "./r2-multipart-lifecycle";
import {putMediaObject,routeFor,hashStream} from "./media-object-routing";
import {withMediaWorkBudget} from "./media-work-budget";
type Session=typeof mediaUploadSessions.$inferSelect;
export const NATIVE_JPEG_TRANSPORT="r2-jpeg-v1";
export const nativeJpegSession=(row:Session)=>
  (row.metadata as {nativeTransport?:string})?.nativeTransport===NATIVE_JPEG_TRANSPORT||
  row.mime==="image/jpeg"&&!!(row.metadata as {nativeReceipt?:unknown})?.nativeReceipt;

/** Explicit opt-in only. Never silently fall back after selecting native mode. */
export async function nativeJpegReady(){
  const result=await db.execute(sql`select to_regclass('media_r2_multipart_journals') is not null
    and to_regclass('media_asset_records') is not null and to_regclass('media_asset_objects') is not null
    and to_regclass('media_asset_variants') is not null as ready`);
  if(!result.rows[0]?.ready)throw new ObjectStoreError("configuration");
  const store=getObjectStore("r2");
  if(!(store instanceof R2Store))throw new ObjectStoreError("configuration");
  const driver=store.preparedMultipart();driver.writable();
}
export async function nativeJpegContext(row:Session){
  if(row.mime!=="image/jpeg"||!nativeJpegSession(row))throw new MultipartUploadError("closed");
  const [reservation]=await db.select().from(mediaReservations).where(eq(mediaReservations.id,row.id));
  let key=reservation?.storageKey;
  if(!key){
    const [current]=await db.select().from(mediaUploadSessions).where(eq(mediaUploadSessions.id,row.id));
    const receipt=(current?.metadata as {nativeReceipt?:{kind?:string}})?.nativeReceipt;
    if(current?.state!=="completed"||receipt?.kind!=="registered"||!current.mediaId)
      throw new MultipartUploadError("closed");
    const [media]=await db.select().from(mediaItems).where(eq(mediaItems.id,current.mediaId));
    if(!media||media.eventId!==row.eventId||!media.url.startsWith("/api/media/files/"))
      throw new MultipartUploadError("closed");
    key=media.url.slice("/api/media/files/".length);
  }
  const store=getObjectStore("r2");
  if(!(store instanceof R2Store))throw new ObjectStoreError("configuration");
  const driver=store.preparedMultipart();
  const plan:MultipartPlan={sessionId:row.id,actorId:row.actorId,eventId:row.eventId,
    owner:{kind:row.ownerId===null?"official":"creator",creatorId:row.ownerId,revision:row.requestFingerprint},
    key,mime:row.mime,size:row.size,sha256:row.sha256,expiresAt:row.expiresAt.getTime()};
  return {plan,driver};
}
export async function pinNativeJpeg(row:Session){
  const {plan,driver}=await nativeJpegContext(row),context=databaseMultipartContext(plan,driver);
  await context.journal.exclusive(driver.scope,plan.key,plan.sessionId,async raw=>{
    if(raw&&["initiating","aborting","aborted"].includes((raw as {phase:string}).phase))
      throw new MultipartUploadError("uncertain");
    await context.journal.pinStaging();
  });
}
export async function saveNativeJpeg(row:Session,filename:string,
  metadata:Pick<InsertMediaItem,"caption"|"photographer"|"tags">,requestAnalysis:boolean){
  const {plan,driver}=await nativeJpegContext(row);
  // Complete-reply recovery is read-only; it does not blindly repeat Complete.
  const recovery=databaseMultipartContext(plan,driver);
  const phase=await recovery.journal.exclusive(driver.scope,plan.key,plan.sessionId,async raw=>
    (raw as {phase?:string}|undefined)?.phase);
  if(phase==="completing")await uploadR2MultipartFile(plan,filename,databaseMultipartContext(plan,driver));
  const prepared=await prepareMultipartJpeg(plan,filename,driver);
  if(phase!=="completing")await uploadR2MultipartFile(plan,filename,databaseMultipartContext(plan,driver));
  // Use the ordinary small-object pipeline for the bounded WebP, not another
  // source upload or another recognition pipeline. Keep it under the key lease.
  const thumbnail=databaseMultipartContext(plan,driver);
  await thumbnail.journal.exclusive(driver.scope,plan.key,plan.sessionId,async()=>{
    await thumbnail.authorize(plan,"upload");
    await withMediaWorkBudget(async()=>{
      const key=prepared.thumbnail.key,existing=await routeFor(key);
      if(!existing)await putMediaObject(key,prepared.thumbnail.path);
      else if(existing.provider==="r2"&&existing.state==="pending"){
        // Only this session's reserved, deterministically prepared thumbnail is
        // eligible. A lost PUT reply is not permission to overwrite or delete.
        if(existing.sha256!=null||existing.size!=null||existing.mime!=null||
          existing.object_version!=null||existing.retained_source||existing.source_sha256!=null)
          throw new MultipartUploadError("integrity");
        const store=getObjectStore("r2");
        let head;
        try{head=await store.metadata(key);}
        catch(error){
          if(error instanceof ObjectStoreError&&error.code==="missing")
            throw new MultipartUploadError("cleanup_pending");
          throw error;
        }
        if(!head.version||head.size!==prepared.thumbnail.size||head.mime!=="image/webp")
          throw new MultipartUploadError("integrity");
        const actual=await hashStream(store.open(key,undefined,head.version),100000);
        if(actual.size!==prepared.thumbnail.size||actual.sha256!==prepared.thumbnail.sha256)
          throw new MultipartUploadError("integrity");
        const confirmed=await store.metadata(key);
        if(confirmed.version!==head.version||confirmed.size!==head.size||confirmed.mime!==head.mime)
          throw new MultipartUploadError("integrity");
        thumbnail.journal.assertLease();
        const updated=await db.execute(sql`update media_object_routes
          set state='verified',sha256=${actual.sha256},size=${actual.size},
          mime='image/webp',object_version=${head.version},updated_at=now()
          where key=${key} and provider='r2' and state='pending'
          and sha256 is null and size is null and mime is null and object_version is null
          and coalesce(to_jsonb(media_object_routes)->>'retained_source','false')='false'
          and to_jsonb(media_object_routes)->>'source_sha256' is null returning key`);
        if(updated.rows.length!==1)throw new MultipartUploadError("integrity");
      }
      const route=await routeFor(key),store=getObjectStore("r2");
      if(!route||route.provider!=="r2"||route.state!=="verified"||
        Number(route.size)!==prepared.thumbnail.size||route.sha256!==prepared.thumbnail.sha256||
        route.mime!=="image/webp"||!route.object_version)throw new MultipartUploadError("cleanup_pending");
      const head=await store.metadata(key);
      if(head.version!==route.object_version||head.size!==prepared.thumbnail.size||head.mime!=="image/webp")
        throw new MultipartUploadError("integrity");
      const bytes=await hashStream(store.open(key,undefined,head.version),100000);
      if(bytes.sha256!==prepared.thumbnail.sha256||bytes.size!==prepared.thumbnail.size)
        throw new MultipartUploadError("integrity");
      thumbnail.journal.assertLease();
    });
  });
  return registerValidatedMultipart(plan,{...metadata,...prepared.media},driver,requestAnalysis);
}
export async function cleanupNativeJpeg(row:Session){
  const {plan,driver}=await nativeJpegContext(row);
  return cleanupMultipartStaging(plan,driver);
}
export async function cancelNativeJpeg(row:Session){
  const {plan,driver}=await nativeJpegContext(row);
  await cancelR2Multipart(plan,databaseMultipartContext(plan,driver));
  return cleanupMultipartStaging(plan,driver);
}
