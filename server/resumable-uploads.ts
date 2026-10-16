import { json, type Express, type Request, type Response } from "express";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, rm, rename, stat, statfs, mkdtemp } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { storage } from "./storage";
import { mediaUploadSessions as sessions, mediaReservations, insertMediaItemSchema } from "@shared/schema";
import { mediaCreditSchema } from "@shared/media-credit";
import { mediaTagSchema } from "@shared/media-tag-policy";
import { requireCreator } from "./middleware/auth";
import { communityLimits, takeBetaRate, creatorAllowed } from "./beta-policy";
import { canManage } from "./beta-access";
import { mediaPolicy, MediaLimitError } from "./media-policy";
import { MediaBusyError, withMediaWorkBudget } from "./media-work-budget";
import { createMediaKeys, uploadMedia } from "./media-storage";
import { assertNewMediaUploadsEnabled } from "./media-object-routing";
import { reviewMediaSafety } from "./content-safety";
import { analysisStatus, kickAnalysisWorker } from "./analysis-jobs";
import {nativeUploadFenceAvailable,nativeUploadOwnsSession} from "./native-upload-fence";
import {UPLOAD_SESSION_ROOT,uploadSessionDirectory} from "./upload-session-staging";
import {assembleUploadSource,UPLOAD_PART_BYTES} from "./upload-session-assembly";
import {NATIVE_JPEG_TRANSPORT,nativeJpegSession,nativeJpegReady,pinNativeJpeg,
  saveNativeJpeg,cleanupNativeJpeg,cancelNativeJpeg} from "./native-jpeg-intake";
import {MultipartUploadError} from "./r2-multipart-upload";
import {MultipartJournalError} from "./r2-multipart-journal";
import {recoverNativeUploadSessions} from "./native-upload-recovery";

export {UPLOAD_PART_BYTES};
const ROOT = UPLOAD_SESSION_ROOT;
const TTL = 60*60*1000;
const activeFinalizers = new Set<string>();
const mimes = ["image/jpeg","image/png","image/gif","image/webp","video/mp4","video/quicktime","video/webm"] as const;
const details = z.object({type:z.enum(["image","video"]),caption:z.string().max(1000).default(""),
  photographer:mediaCreditSchema.default(""),tags:z.array(mediaTagSchema).max(30).default([]),autoTag:z.boolean()}).strict();
const input = z.object({requestKey:z.string().uuid(),size:z.number().int().positive(),
  mime:z.enum(mimes),sha256:z.string().regex(/^[a-f0-9]{64}$/),metadata:details}).strict();
type Session = typeof sessions.$inferSelect;
type Parts = Record<string,{size:number;sha256:string}>;
class SessionError extends Error { constructor(public status:number,message:string){super(message);} }
const folder = (id:string) => uploadSessionDirectory(z.string().uuid().parse(id));

export async function resumableUploadsAvailable() {
  if (process.env.MEDIA_RESUMABLE_UPLOADS_ENABLED !== "true") return false;
  return !!(await db.execute(sql`select to_regclass('media_upload_sessions') as name`)).rows[0]?.name;
}
function writesAllowed() { assertNewMediaUploadsEnabled(); }
async function gallery(row:Pick<Session,"eventId"|"ownerId">,actorId:number) {
  const event=await storage.getEvent(row.eventId);
  const actor=await storage.getUser(actorId);
  if(!event || !actor || !creatorAllowed(actor) || !canManage(actor,event) || event.creatorId!==row.ownerId)
    throw new SessionError(403,"Gallery access or ownership changed. Cancel this upload and start again.");
  if(event.isPremium) throw new SessionError(403,"Premium uploads are not enabled.");
  return event;
}
function currentLimit(mime:string,ownerId:number|null) {
  if(ownerId!==null && !mime.startsWith("image/")) throw new SessionError(413,"Video uploads are not available for Community Creators.");
  return mime.startsWith("image/") ? ownerId!==null ? communityLimits.imageBytes : mediaPolicy.imageBytes : mediaPolicy.videoBytes;
}
function view(row:Session) {
  return {id:row.id,eventId:row.eventId,state:row.state,size:row.size,sha256:row.sha256,
    partBytes:UPLOAD_PART_BYTES,received:Object.keys(row.parts as Parts).length,
    uploadedBytes:Object.values(row.parts as Parts).reduce((n,p)=>n+p.size,0),
    expiresAt:row.expiresAt,mediaId:row.mediaId,
    canResumeFinalization:nativeJpegSession(row)&&row.state==="finalizing"&&row.expiresAt>new Date()&&
      !finalizerActive(row)};
}
async function owned(req:Request) {
  const id=z.string().uuid().parse(req.params.sessionId);
  const [row]=await db.select().from(sessions).where(and(eq(sessions.id,id),eq(sessions.actorId,req.user!.id)));
  if(!row) throw new SessionError(404,"Upload session not found.");
  return row;
}
async function reserveBody(req:Request) {
  const body=input.parse(req.body);
  const event=await storage.getEvent(z.coerce.number().int().positive().parse(req.params.eventId));
  if(!event || !canManage(req.user,event)) throw new SessionError(403,"Gallery access denied.");
  await gallery({eventId:event.id,ownerId:event.creatorId},req.user!.id);
  if(body.metadata.type!== (body.mime.startsWith("image/")?"image":"video"))
    throw new SessionError(400,"File and media type do not match.");
  if(body.size>currentLimit(body.mime,event.creatorId)) throw new SessionError(413,"File exceeds the current gallery upload limit.");
  writesAllowed();
  const requestFingerprint=createHash("sha256").update(JSON.stringify({eventId:event.id,...body,requestKey:undefined})).digest("hex");
  let reserved:string|undefined;
  try { return await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(761041)`);
    const [previous]=await tx.select().from(sessions).where(and(eq(sessions.actorId,req.user!.id),eq(sessions.requestKey,body.requestKey)));
    if(previous){
      if(previous.requestFingerprint!==requestFingerprint)
        throw new SessionError(409,"This request key belongs to another upload.");
      return previous;
    }
    const native=process.env.MEDIA_R2_MULTIPART_ENABLED==="true"&&body.mime==="image/jpeg";
    if(native)await nativeJpegReady();
    const counts=await tx.execute(sql`select count(*)::int as total,
      count(*) filter(where actor_id=${req.user!.id})::int as owned,
      coalesce(sum(size),0)::bigint as bytes from media_upload_sessions s
      where s.cleaned_at is null or exists(select 1 from media_reservations r where r.id=s.id)`);
    if(Number(counts.rows[0].total)>=4 || Number(counts.rows[0].owned)>=2 ||
       (Number(counts.rows[0].bytes)+body.size)*2>512*1048576)
      throw new SessionError(429,"Upload slots are full. Resume or cancel an existing upload first.");
    if(!await takeBetaRate(`resumable:${req.user!.id}`,30,3600000))
      throw new SessionError(429,"Too many upload sessions. Try again later.");
    const disk=await statfs(tmpdir());
    if(disk.bavail*disk.bsize < body.size*2+64*1048576)
      throw new SessionError(503,"Temporary upload space is busy. Try again later.");
    const id=randomUUID();
    const keys=createMediaKeys(body.mime,event.creatorId!==null?"creator-original":"official");
    await storage.reserveMedia(id,event.id,event.creatorId,body.size+100*1024,keys.storageKey,keys.thumbnailKey,req.user!.isAdmin);
    reserved=id;
    const [row]=await tx.insert(sessions).values({id,actorId:req.user!.id,requestKey:body.requestKey,requestFingerprint,eventId:event.id,
      ownerId:event.creatorId,size:body.size,mime:body.mime,sha256:body.sha256,
      metadata:native?{...body.metadata,nativeTransport:NATIVE_JPEG_TRANSPORT}:body.metadata,
      expiresAt:new Date(Date.now()+TTL)}).returning();
    return row;
  }); } catch(error){
    // On an ambiguous insert response never abandon an extant session.
    if(reserved){
      const [exists]=await db.select().from(sessions).where(eq(sessions.id,reserved));
      if(!exists) await storage.abandonMedia(reserved);
    }
    throw error;
  }
}
async function discard(row:Session,state:"failed"|"cancelled") {
  await db.transaction(async tx=>{
    await tx.select().from(mediaReservations).where(eq(mediaReservations.id,row.id)).for("update");
    const [current]=await tx.select().from(sessions).where(eq(sessions.id,row.id)).for("update");
    if(await nativeUploadOwnsSession(row.id,tx))
      throw new SessionError(409,"Upload reconciliation is pending. Its files and storage reservation have been retained.");
    if(current.state==="completed" || current.state==="finalizing" && state==="cancelled")
      throw new SessionError(409,"Saving has started. Check saved status before cancelling.");
    await tx.update(sessions).set({state,metadata:{}}).where(eq(sessions.id,row.id));
  });
  await rm(folder(row.id),{recursive:true,force:true});
  await storage.abandonMedia(row.id);
  await db.update(sessions).set({cleanedAt:new Date()}).where(eq(sessions.id,row.id));
}
function alive(pid:number|null) {
  if(!pid) return false;
  try { process.kill(pid,0);return true; } catch(error:any){return error.code!=="ESRCH";}
}
const finalizerActive=(row:Session)=>row.workerPid===process.pid?activeFinalizers.has(row.id):alive(row.workerPid);
/** Conservative reconciliation. Never race an active/uncertain finalizer. */
export async function cleanupUploadSessions() {
  const recovered=await recoverNativeUploadSessions({active:finalizerActive,finalize:row=>finish(row,row.actorId)});
  if(recovered.attempted)console.info("Native upload recovery:",JSON.stringify(recovered));
  if(!(await db.execute(sql`select to_regclass('media_upload_sessions') as name`)).rows[0]?.name) return;
  const native=await nativeUploadFenceAvailable();
  const fence=native?sql`and not exists(select 1 from media_r2_multipart_journals n where n.session_id=${sessions.id})`:sql``;
  const expired=await db.select().from(sessions).where(sql`${sessions.expiresAt}<now() and ${sessions.cleanedAt} is null
    and not (${sessions.metadata} ? 'nativeReceipt') ${fence}`).limit(20);
  for(const row of expired) {
    const active=(current:Session)=>current.workerPid===process.pid?activeFinalizers.has(current.id):alive(current.workerPid);
    if(row.state==="finalizing" && active(row)) continue;
    if(row.state==="completed") {
      await rm(folder(row.id),{recursive:true,force:true});
      await db.update(sessions).set({cleanedAt:new Date()}).where(eq(sessions.id,row.id));
    }
    else await db.transaction(async tx=>{
      // Same reservation-before-session order as atomic media completion.
      await tx.select().from(mediaReservations).where(eq(mediaReservations.id,row.id)).for("update");
      const [current]=await tx.select().from(sessions).where(eq(sessions.id,row.id)).for("update");
      if(!current || current.state==="completed" || current.expiresAt>new Date() ||
         current.state==="finalizing" && active(current)) return;
      if(await nativeUploadOwnsSession(row.id,tx))return;
      await rm(folder(row.id),{recursive:true,force:true});
      // Release durable reservation only after temporary deletion is confirmed.
      await tx.update(sessions).set({state:"failed",metadata:{}}).where(eq(sessions.id,row.id));
    }).then(async()=>{
      const [now]=await db.select().from(sessions).where(eq(sessions.id,row.id));
      if(now?.state==="failed") {
        await storage.abandonMedia(row.id);
        await db.update(sessions).set({cleanedAt:new Date()}).where(eq(sessions.id,row.id));
      }
    });
  }
}

async function finish(row:Session,actorId:number) {
  if(row.state==="completed") return row;
  await gallery(row,actorId);writesAllowed();
  const native=nativeJpegSession(row);
  if(row.state==="finalizing"&&(!native||finalizerActive(row))) return row;
  if(row.expiresAt<new Date() || !["receiving","finalizing"].includes(row.state))
    throw new SessionError(410,"Upload session expired or closed.");
  if(Object.keys(row.parts as Parts).length!==Math.ceil(row.size/UPLOAD_PART_BYTES))
    throw new SessionError(409,"Upload is incomplete. Resume from the next missing part.");
  if(row.size>currentLimit(row.mime,row.ownerId)) throw new SessionError(413,"File exceeds the current gallery limit.");
  let claimed:Session|undefined,ours=false;
  try{
    claimed=await db.transaction(async tx=>{
      await tx.select().from(mediaReservations).where(eq(mediaReservations.id,row.id)).for("update");
      const [current]=await tx.select().from(sessions).where(eq(sessions.id,row.id)).for("update");
      if(!current||current.state==="completed"||current.state==="finalizing"&&(!native||finalizerActive(current)))
        return undefined;
      if(!["receiving","finalizing"].includes(current.state))throw new SessionError(410,"Upload session closed.");
      activeFinalizers.add(row.id);ours=true;
      return (await tx.update(sessions).set({state:"finalizing",workerPid:process.pid})
        .where(eq(sessions.id,row.id)).returning())[0];
    });
  }catch(error){if(ours)activeFinalizers.delete(row.id);throw error;}
  if(!claimed) return (await db.select().from(sessions).where(eq(sessions.id,row.id)))[0];
  let assembly:string|undefined;
  let assembledDirectory:string|undefined;
  try {
    if(native)await pinNativeJpeg(claimed);
    const assembled=await assembleUploadSource(claimed,native).catch(error=>{
      if(!native&&error instanceof MultipartUploadError&&error.code==="integrity")
        throw new SessionError(409,"Upload integrity check failed.");
      throw error;
    });
    assembly=assembled.filename;assembledDirectory=assembled.directory;
    const [reservation]=await db.select().from(mediaReservations).where(eq(mediaReservations.id,row.id));
    if(!reservation) throw new SessionError(410,"Upload reservation expired.");
    await gallery(row,actorId);writesAllowed();
    const {nativeTransport,nativeRecovery,...storedDetails}=row.metadata as Record<string,unknown>;
    const metadata=details.parse(storedDetails);
    if(native){
      const item=await saveNativeJpeg(claimed,assembly,metadata,row.ownerId!==null||metadata.autoTag);
      if(row.ownerId!==null)await reviewMediaSafety(item.id,row.ownerId).catch(()=>{});
      void kickAnalysisWorker();
      await cleanupNativeJpeg(claimed).catch(()=>{});
      return (await db.select().from(sessions).where(eq(sessions.id,row.id)))[0];
    }
    const saved=await uploadMedia({path:assembly,size:row.size,mimetype:row.mime} as Express.Multer.File,metadata.type,
      {storageKey:reservation.storageKey,thumbnailKey:reservation.thumbnailKey},
      async (bytes,keys)=>{
        if(bytes>reservation.reservedBytes) throw new MediaLimitError("Processed upload exceeds its reservation.");
        // Legacy non-JPEG processing may keep PNG/GIF instead of WebP.
        // Record its final key BEFORE any write so failed uploads cannot leave
        // an unaccounted object under an extension the reservation did not know.
        const updated=await db.update(mediaReservations).set({
          storageKey:keys.storageKey,thumbnailKey:keys.thumbnailKey,
        }).where(eq(mediaReservations.id,row.id)).returning({id:mediaReservations.id});
        if(!updated.length) throw new SessionError(410,"Upload reservation expired.");
      },
      row.ownerId!==null?"creator-original":"official");
    await gallery(row,actorId);writesAllowed();
    const item=await storage.finishMedia(row.id,insertMediaItemSchema.parse({eventId:row.eventId,type:saved.mediaType,
      url:saved.url,thumbnail:saved.thumbnail,storedBytes:saved.storedBytes,highBytes:saved.highBytes,
      lowBytes:saved.lowBytes,objectCount:saved.objectCount,caption:metadata.caption,photographer:metadata.photographer,tags:metadata.tags,isPremium:false}),
      undefined,undefined,row.ownerId!==null || metadata.type==="video" || metadata.autoTag,row.ownerId!==null,
      async(tx,item)=>{
        writesAllowed();
        const [committed]=await tx.update(sessions).set({state:"completed",mediaId:item.id,metadata:{}})
          .where(and(eq(sessions.id,row.id),eq(sessions.state,"finalizing"),eq(sessions.workerPid,process.pid))).returning();
        if(!committed) throw new Error("Upload finalization was superseded.");
      });
    // Safety failure must not make a confirmed save ambiguous or duplicate it.
    if(row.ownerId!==null) await reviewMediaSafety(item.id,row.ownerId).catch(()=>{});
    void kickAnalysisWorker();
    await rm(folder(row.id),{recursive:true,force:true}).then(async()=>{
      await db.update(sessions).set({cleanedAt:new Date()}).where(eq(sessions.id,row.id));
    }).catch(()=>{});
    return (await db.select().from(sessions).where(eq(sessions.id,row.id)))[0];
  } catch(error) {
    // Resolve ambiguous COMMIT by locking the reservation first. If the
    // database is unavailable, retain state/reservation for reconciliation.
    const current=await db.transaction(async tx=>{
      await tx.select().from(mediaReservations).where(eq(mediaReservations.id,row.id)).for("update");
      return (await tx.select().from(sessions).where(eq(sessions.id,row.id)).for("update"))[0];
    });
    if(current?.state==="completed"){
      if(native&&current.mediaId){
        if(row.ownerId!==null)await reviewMediaSafety(current.mediaId,row.ownerId).catch(()=>{});
        void kickAnalysisWorker();await cleanupNativeJpeg(claimed).catch(()=>{});
      }
      return current;
    }
    if(current&&native){
      // Never turn an uncertain provider write into legacy abandonment/unlink.
      await cleanupNativeJpeg(claimed).catch(()=>{});
      await db.update(sessions).set({workerPid:null}).where(and(eq(sessions.id,row.id),eq(sessions.state,"finalizing")));
    }else if(current) await discard(current,"failed");
    throw error;
  } finally {
    if(assembledDirectory&&!native) await rm(assembledDirectory,{recursive:true,force:true}).catch(()=>{});
    activeFinalizers.delete(row.id);
  }
}

export function registerResumableUploadRoutes(app:Express) {
  const response=async(row:Session,req:Request)=>{
    if(!row.mediaId) return view(row);
    await gallery(row,req.user!.id);
    const item=await storage.getMediaItem(row.mediaId);
    return {...view(row),item:item?{...item,analysis:await analysisStatus(item.id)}:null};
  };
  const run=(action:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
    try{
      if(req.get("sec-fetch-site")==="cross-site") throw new SessionError(403,"Cross-site uploads are not allowed.");
      const read=req.method==="GET" || req.method==="DELETE";
      const enabled=read
        ? !!(await db.execute(sql`select to_regclass('media_upload_sessions') as name`)).rows[0]?.name
        : await resumableUploadsAvailable();
      if(!enabled) throw new SessionError(503,"Resumable uploads are not enabled.");
      await action(req,res);
    }catch(error){
      const nativeError=error instanceof MultipartUploadError||error instanceof MultipartJournalError;
      const nativeCode=nativeError?error.code:"";
      const status=nativeError?nativeCode==="denied"?403:nativeCode==="integrity"?400:
        nativeCode==="closed"||nativeCode==="expired"?410:nativeCode==="busy"?503:409:
        error instanceof SessionError?error.status:error instanceof z.ZodError?400:
        error instanceof MediaLimitError?413:error instanceof MediaBusyError?503:502;
      if(!res.headersSent && !res.destroyed) res.status(status).json({error:
        error instanceof SessionError || error instanceof MediaLimitError || error instanceof MediaBusyError
          ?error.message:nativeError?nativeCode==="integrity"?"Upload integrity or photo validation failed.":
            "Upload could not be confirmed. Check saved status; files and storage are retained until recovery is confirmed.":
            status===400?"Invalid upload details.":"Upload not confirmed. Check its saved status before retrying."});
    }
  };
  app.post("/api/events/:eventId/upload-sessions",requireCreator,json({limit:"16kb"}),run(async(req,res)=>{
    const row=await reserveBody(req);res.status(200).json(await response(row,req));
  }));
  app.get("/api/upload-sessions/:sessionId",requireCreator,run(async(req,res)=>{
    const row=await owned(req);
    res.json(await response(row,req));
  }));
  app.get("/api/events/:eventId/upload-sessions/by-request/:requestKey",requireCreator,run(async(req,res)=>{
    const key=z.string().uuid().parse(req.params.requestKey);
    const eventId=z.coerce.number().int().positive().parse(req.params.eventId);
    const [row]=await db.select().from(sessions).where(and(eq(sessions.actorId,req.user!.id),
      eq(sessions.eventId,eventId),eq(sessions.requestKey,key)));
    if(!row) throw new SessionError(404,"Upload session not found.");
    res.json(await response(row,req));
  }));
  app.delete("/api/upload-sessions/:sessionId",requireCreator,run(async(req,res)=>{
    const row=await owned(req);
    if(row.state==="completed") return res.status(409).json({error:"This file is already saved. Delete it through Manage Media."});
    if(nativeJpegSession(row)&&row.state!=="receiving"){
      await gallery(row,req.user!.id);
      if(finalizerActive(row))throw new SessionError(409,"Saving is in progress. Check saved status before cancelling.");
      if(!["cancelled","failed"].includes(row.state))await cancelNativeJpeg(row);
      res.json({success:true});return;
    }
    if(row.state==="finalizing") return res.status(409).json({error:"Saving is in progress. Check saved status before cancelling."});
    await discard(row,"cancelled");res.json({success:true});
  }));
  app.put("/api/upload-sessions/:sessionId/parts/:part",requireCreator,run(async(req,res)=>{
    writesAllowed();
    const row=await owned(req);await gallery(row,req.user!.id);
    if(!req.is("application/octet-stream")) throw new SessionError(415,"A binary upload part is required.");
    const index=z.coerce.number().int().nonnegative().parse(req.params.part);
    const expected=Math.min(UPLOAD_PART_BYTES,row.size-index*UPLOAD_PART_BYTES);
    if(expected<=0) throw new SessionError(400,"Unexpected upload part.");
    const digest=z.string().regex(/^[a-f0-9]{64}$/).parse(req.get("x-part-sha256"));
    const uploaded=await withMediaWorkBudget(()=>db.transaction(async tx=>{
      const [locked]=await tx.select().from(sessions).where(eq(sessions.id,row.id)).for("update");
      if(locked.state!=="receiving" || locked.expiresAt<new Date()) throw new SessionError(410,"Upload session expired or closed.");
      const parts=locked.parts as Parts;
      if(index>Object.keys(parts).length) throw new SessionError(409,"Resume from the next missing part.");
      await mkdir(folder(row.id),{recursive:true,mode:0o700});
      const temporary=path.join(folder(row.id),`${index}.tmp`);
      await rm(temporary,{force:true});
      let size=0;const hash=createHash("sha256");
      const limit=new Transform({transform(chunk,_encoding,callback){
        size+=chunk.length;
        if(size>expected) return callback(new SessionError(413,"Upload part exceeds its byte limit."));
        hash.update(chunk);callback(null,chunk);
      }});
      const timer=setTimeout(()=>req.destroy(),30_000);
      try{
        await pipeline(req,limit,createWriteStream(temporary,{flags:"wx",mode:0o600}));
        if(size!==expected || hash.digest("hex")!==digest) throw new SessionError(409,"Upload part checksum or length does not match.");
        if(parts[String(index)] && parts[String(index)].sha256!==digest)
          throw new SessionError(409,"An accepted upload part cannot be replaced.");
        await rename(temporary,path.join(folder(row.id),`${index}.part`));
        parts[String(index)]={size,sha256:digest};
        const [updated]=await tx.update(sessions).set({parts}).where(eq(sessions.id,row.id)).returning();
        return view(updated);
      }finally{clearTimeout(timer);await rm(temporary,{force:true});}
    }));
    res.json(uploaded);
  }));
  app.post("/api/upload-sessions/:sessionId/complete",requireCreator,run(async(req,res)=>{
    const row=await finish(await owned(req),req.user!.id);
    res.status(row.state==="completed"?200:202).json(await response(row,req));
  }));
}
