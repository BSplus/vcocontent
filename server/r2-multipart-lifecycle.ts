import {and,eq,sql} from "drizzle-orm";
import {db} from "./db";
import {storage} from "./storage";
import {mediaItems,mediaUploadSessions as sessions,mediaReservations,mediaObjectRoutes as routes,
  type InsertMediaItem} from "@shared/schema";
import {r2MultipartJournals as journals} from "@shared/r2-multipart-schema";
import {databaseMultipartContext,MultipartJournalError} from "./r2-multipart-journal";
import {multipartPlanBinding,restoreMultipartCheckpoint,MultipartUploadError,type MultipartPlan} from "./r2-multipart-upload";
import type {R2MultipartDriver} from "./r2-multipart-driver";
import {ObjectStoreError} from "./object-store";
import {linkAssetObject} from "./media-asset-store";
import {lockedCreatorBudget,creatorAllowed} from "./beta-policy";
import {users,events,insertMediaItemSchema} from "@shared/schema";
import {removeUploadSessionStaging} from "./upload-session-staging";
import {resolveGalleryOwnership} from "@shared/gallery-ownership";

type Transaction=Parameters<Parameters<typeof db.transaction>[0]>[0];
const conflict=():never=>{throw new MultipartJournalError("conflict");};
const fileUrl=(key:string)=>`/api/media/files/${key}`;
type Receipt={binding:string;kind:"registered"|"released";mediaId?:number};
async function session(tx:Transaction,id:string){
  return (await tx.select().from(sessions).where(eq(sessions.id,id)).for("update"))[0];
}
async function receipt(id:string,binding:string){
  const [row]=await db.select().from(sessions).where(eq(sessions.id,id));
  const value=(row?.metadata as {nativeReceipt?:Receipt})?.nativeReceipt;
  if(value&&value.binding!==binding)conflict();
  if(row?.state==="completed"&&value?.kind!=="registered")conflict();
  return value;
}
async function owned(tx:Transaction,plan:MultipartPlan){
  if(plan.owner.creatorId!==null)await tx.select().from(users).where(eq(users.id,plan.owner.creatorId)).for("update");
  const [event]=await tx.select().from(events).where(eq(events.id,plan.eventId)).for("update");
  const [actor]=await tx.select().from(users).where(eq(users.id,plan.actorId));
  const current=await session(tx,plan.sessionId);
  if(!actor||!creatorAllowed(actor)||!event||event.creatorId!==plan.owner.creatorId||event.isPremium||
    !actor.isAdmin&&event.creatorId!==actor.id||!current||current.actorId!==plan.actorId||
    current.eventId!==plan.eventId||current.ownerId!==plan.owner.creatorId||
    current.requestFingerprint!==plan.owner.revision||current.sha256!==plan.sha256||
    current.mime!==plan.mime||current.size!==plan.size||current.expiresAt.getTime()!==plan.expiresAt)conflict();
  return current;
}
function header(plan:MultipartPlan,driver:R2MultipartDriver,binding:string){
  return and(eq(journals.sessionId,plan.sessionId),eq(journals.reservationId,plan.sessionId),
    eq(journals.scope,driver.scope),eq(journals.objectKey,plan.key),eq(journals.binding,binding));
}

/**
 * Internal atomic repository for ALREADY content-validated intake output.
 * NOT a parser/upload/auth endpoint or independent safety approval. The future
 * intake adapter must pass existing validated originals/derivatives and policy
 * decisions; raw browser metadata must never call this directly.
 */
export async function registerValidatedMultipart(plan:MultipartPlan,input:InsertMediaItem,
  driver:R2MultipartDriver,requestAnalysis=false){
  const context=databaseMultipartContext(plan,driver),binding=multipartPlanBinding(plan,driver);
  return context.journal.exclusive(driver.scope,plan.key,plan.sessionId,async(raw)=>{
    const done=await receipt(plan.sessionId,binding);
    if(done){
      if(done.kind!=="registered"||!done.mediaId)throw new MultipartJournalError("closed");
      const [item]=await db.select().from(mediaItems).where(eq(mediaItems.id,done.mediaId));
      if(!item||item.eventId!==plan.eventId||item.url!==fileUrl(plan.key))throw new MultipartJournalError("closed");
      return item;
    }
    const state=restoreMultipartCheckpoint(raw,binding,plan);
    if(state?.phase!=="verified"||!state.version)throw new MultipartUploadError("uncertain");
    await context.authorize(plan,"upload");
    const parsed=insertMediaItemSchema.safeParse(input);
    if(!parsed.success)conflict();
    const media=parsed.data!;
    if(media.eventId!==plan.eventId||media.url!==fileUrl(plan.key)||media.isPremium||
      media.type!==(plan.mime.startsWith("image/")?"image":"video")||media.highBytes!==plan.size)conflict();
    const ownership=resolveGalleryOwnership({id:plan.eventId,creatorId:plan.owner.creatorId});
    let thumbnail:typeof routes.$inferSelect|undefined;
    return storage.finishMedia(plan.sessionId,media,undefined,undefined,requestAnalysis,plan.owner.kind==="creator",
      async(tx,item)=>{
        // The reservation has now been removed in this same transaction. Asset
        // accounting must never count both reservation and physical bytes.
        await linkAssetObject({mediaId:item.id,ownership,key:plan.key,
          purpose:plan.mime==="image/jpeg"?"original":"legacy_source",sourceVersion:1,
          sha256:plan.sha256,objectVersion:state.version!},tx);
        if(thumbnail)await linkAssetObject({mediaId:item.id,ownership,key:thumbnail.key,
          purpose:media.type==="video"?"poster":"thumbnail",sourceVersion:1,sourceKey:plan.key,
          sha256:thumbnail.sha256!,objectVersion:thumbnail.objectVersion!},tx);
        if(plan.owner.creatorId!==null)await lockedCreatorBudget(tx,plan.owner.creatorId,0,0,0,0,true,"CREATOR");
        const committed=await tx.update(sessions).set({state:"completed",mediaId:item.id,workerPid:null,
          metadata:{nativeReceipt:{binding,kind:"registered",mediaId:item.id}}})
          .where(and(eq(sessions.id,plan.sessionId),eq(sessions.state,"finalizing"))).returning({id:sessions.id});
        if(committed.length!==1)conflict();
        context.journal.assertLease();
      },
      async(tx)=>{
        context.journal.assertLease();driver.writable();
        const current=await owned(tx,plan);
        if(current.state!=="finalizing"||current.cleanedAt)conflict();
        const [intent]=await tx.select().from(journals).where(header(plan,driver,binding)).for("update");
        if(intent?.checkpoint?.phase!=="verified"||intent.checkpoint.version!==state.version)conflict();
        const [reservation]=await tx.select().from(mediaReservations).where(eq(mediaReservations.id,plan.sessionId));
        if(!reservation||reservation.storageKey!==plan.key||reservation.creatorId!==plan.owner.creatorId)conflict();
        await tx.insert(routes).values({key:plan.key,provider:"r2",state:"verified",size:plan.size,
          sha256:plan.sha256,mime:plan.mime,objectVersion:state.version}).onConflictDoNothing();
        const [source]=await tx.select().from(routes).where(eq(routes.key,plan.key)).for("update");
        if(!source||source.provider!=="r2"||source.state!=="verified"||source.size!==plan.size||
          source.sha256!==plan.sha256||source.mime!==plan.mime||source.objectVersion!==state.version)conflict();
        if(media.thumbnail!==media.url){
          if(media.thumbnail!==fileUrl(reservation.thumbnailKey))conflict();
          [thumbnail]=await tx.select().from(routes).where(eq(routes.key,reservation.thumbnailKey)).for("update");
          if(!thumbnail||thumbnail.provider!=="r2"||thumbnail.state!=="verified"||
            !Number.isSafeInteger(thumbnail.size)||(thumbnail.size??0)<=0||
            !/^[a-f0-9]{64}$/.test(thumbnail.sha256??"")||!thumbnail.objectVersion)conflict();
        }
        const bytes=plan.size+(thumbnail?.size??0);
        if(media.storedBytes!==bytes||media.objectCount!==(thumbnail?2:1)||
          media.lowBytes!==(thumbnail?.size??0)||bytes>reservation.reservedBytes)conflict();
        const removed=await tx.delete(journals).where(and(header(plan,driver,binding),
          eq(journals.revision,intent.revision))).returning({id:journals.sessionId});
        if(removed.length!==1)conflict();
      });
  });
}

async function absent(operation:()=>Promise<unknown>){
  try{await operation();}
  catch(error){if(error instanceof ObjectStoreError&&error.code==="missing")return;throw error;}
  throw new MultipartUploadError("cleanup_pending");
}

/** Only known-aborted native uploads or already registered receipts may lose
 * staging. Unknown Create/Complete outcomes never trigger deletion or release.
 */
export async function cleanupMultipartStaging(plan:MultipartPlan,driver:R2MultipartDriver){
  const context=databaseMultipartContext(plan,driver),binding=multipartPlanBinding(plan,driver);
  return context.journal.exclusive(driver.scope,plan.key,plan.sessionId,async(raw)=>{
    const done=await receipt(plan.sessionId,binding);
    if(done){
      await removeUploadSessionStaging(plan.sessionId);
      await db.transaction(async tx=>{
        const current=await owned(tx,plan);
        const value=(current.metadata as {nativeReceipt?:Receipt}).nativeReceipt;
        if(value?.binding!==binding||value.kind!==done.kind)conflict();
        await tx.update(sessions).set({cleanedAt:new Date()}).where(eq(sessions.id,plan.sessionId));
        context.journal.assertLease();
      });
      return done.kind;
    }
    const state=restoreMultipartCheckpoint(raw,binding,plan);
    if(state?.phase!=="aborted"||!state.uploadId)throw new MultipartUploadError("uncertain");
    await context.authorize(plan,"cancel");
    await absent(()=>driver.parts(plan.key,state.uploadId!,context.signal));
    await absent(()=>driver.head(plan.key,context.signal));
    await removeUploadSessionStaging(plan.sessionId);
    await db.transaction(async tx=>{
      const [reservation]=await tx.select().from(mediaReservations).where(eq(mediaReservations.id,plan.sessionId)).for("update");
      const current=await owned(tx,plan);
      if(!reservation||reservation.storageKey!==plan.key||reservation.creatorId!==plan.owner.creatorId||
        reservation.eventId!==plan.eventId||current.state!=="finalizing"||current.cleanedAt)conflict();
      const [intent]=await tx.select().from(journals).where(header(plan,driver,binding)).for("update");
      if(intent?.checkpoint?.phase!=="aborted"||intent.checkpoint.uploadId!==state.uploadId)conflict();
      await tx.delete(journals).where(header(plan,driver,binding));
      await tx.update(sessions).set({state:"cancelled",workerPid:null,cleanedAt:new Date(),
        metadata:{nativeReceipt:{binding,kind:"released"}}}).where(eq(sessions.id,plan.sessionId));
      await tx.delete(mediaReservations).where(eq(mediaReservations.id,plan.sessionId));
      context.journal.assertLease();
    });
    return "released";
  });
}
