import {and,eq,sql} from "drizzle-orm";
import {db} from "./db";
import {mediaUploadSessions as sessions,mediaReservations} from "@shared/schema";
import {r2MultipartJournals as journals} from "@shared/r2-multipart-schema";
import {nativeJpegSession,cleanupNativeJpeg,cancelNativeJpeg} from "./native-jpeg-intake";

type Session=typeof sessions.$inferSelect;
type Recovery={attempts:number;lastAttemptAt:string;nextAttemptAt:string;
  status:"checking"|"retained"|"held";reason:string};
type Metadata=Record<string,unknown>&{nativeRecovery?:Recovery};
export type NativeRecoveryResult={enabled:boolean;busy:boolean;examined:number;attempted:number;
  completed:number;cleaned:number;cancelled:number;retained:number;held:number};
let running=false;
const enabled=()=>process.env.MEDIA_STORAGE_ENVIRONMENT==="development"&&
  process.env.MEDIA_STORAGE_PROVIDER==="r2"&&process.env.MEDIA_STORAGE_ROUTING==="enabled"&&
  process.env.MEDIA_RESUMABLE_UPLOADS_ENABLED==="true"&&process.env.MEDIA_R2_MULTIPART_ENABLED==="true";
const reason=(error:unknown)=>{
  const value=error as {code?:string;status?:number};
  if(["integrity","conflict","lease_lost","busy","unavailable","uncertain","cleanup_pending"].includes(value?.code??""))
    return value.code!;
  return value?.status===403?"denied":"unconfirmed";
};

/** Single-host maintenance integration. No bucket listing, arbitrary keys,
 * request impersonation, new schema or public endpoint. Count/admission bounds
 * are NOT a hard wall-clock kill: admitted I/O retains its slot until settled. */
export async function recoverNativeUploadSessions(options:{
  active:(row:Session)=>boolean;finalize:(row:Session)=>Promise<Session>;
}):Promise<NativeRecoveryResult>{
  const result:NativeRecoveryResult={enabled:false,busy:false,examined:0,attempted:0,
    completed:0,cleaned:0,cancelled:0,retained:0,held:0};
  if(!enabled())return result;
  if(running){result.busy=true;return result;}
  running=true;
  const admissionDeadline=Date.now()+10_000;
  try{
    const ready=await db.execute(sql`select to_regclass('media_upload_sessions') is not null
      and to_regclass('media_r2_multipart_journals') is not null
      and to_regclass('media_asset_records') is not null and to_regclass('media_asset_objects') is not null
      and to_regclass('media_asset_variants') is not null as ready`);
    if(!ready.rows[0]?.ready)return result;
    result.enabled=true;
    // One receiver currently admits at most four sessions. Scan eight to avoid
    // an active upload starving inactive work; perform at most two actions.
    const candidates=await db.select({id:sessions.id}).from(sessions).where(sql`
      ${sessions.cleanedAt} is null and ${sessions.mime}='image/jpeg'
      and ${sessions.state} in ('finalizing','completed')
      and (${sessions.metadata}->>'nativeTransport'='r2-jpeg-v1' or ${sessions.metadata} ? 'nativeReceipt')
      and coalesce(${sessions.metadata}#>>'{nativeRecovery,status}','')<>'held'
      and coalesce(${sessions.metadata}#>>'{nativeRecovery,nextAttemptAt}','')<=${new Date().toISOString()}`)
      .orderBy(sql`coalesce(${sessions.metadata}#>>'{nativeRecovery,lastAttemptAt}',''),${sessions.createdAt},${sessions.id}`)
      .limit(8);
    for(const candidate of candidates){
      if(result.attempted>=2||Date.now()>=admissionDeadline||!enabled())break;
      result.examined++;
      const claimed=await db.transaction(async tx=>{
        await tx.execute(sql`set local lock_timeout='1s'`);
        await tx.execute(sql`set local statement_timeout='3s'`);
        await tx.select().from(mediaReservations).where(eq(mediaReservations.id,candidate.id)).for("update");
        const [row]=await tx.select().from(sessions).where(eq(sessions.id,candidate.id)).for("update");
        if(!row||row.cleanedAt||!nativeJpegSession(row)||!["finalizing","completed"].includes(row.state)||options.active(row))return;
        const metadata=row.metadata as Metadata,previous=metadata.nativeRecovery;
        if(previous?.status==="held"||(previous?.nextAttemptAt??"")>new Date().toISOString())return;
        const attempts=Number.isSafeInteger(previous?.attempts)&&previous!.attempts>=0?Math.min(previous!.attempts+1,31):1;
        const progress:Recovery={attempts,lastAttemptAt:new Date().toISOString(),
          nextAttemptAt:new Date(Date.now()+Math.min(30,2**Math.min(attempts-1,5))*60_000).toISOString(),
          status:"checking",reason:"pending"};
        const [intent]=await tx.select({checkpoint:journals.checkpoint}).from(journals).where(eq(journals.sessionId,row.id));
        const [current]=await tx.update(sessions).set({metadata:{...metadata,nativeRecovery:progress}})
          .where(eq(sessions.id,row.id)).returning();
        return {row:current,progress,phase:intent?.checkpoint?.phase,fenced:!!intent};
      });
      if(!claimed)continue;
      result.attempted++;
      const {row,progress,phase,fenced}=claimed;
      let status:Recovery["status"]="retained",code="unconfirmed";
      try{
        if(row.state==="completed"){
          await cleanupNativeJpeg(row);code="cleaned";
        }else if(phase==="initiating"){
          // No uploadId: neither safe retry nor abort can be inferred.
          status="held";code="unknown_creation";
        }else if(row.expiresAt<=new Date()){
          if(fenced&&(phase===undefined||["uploading","aborting","aborted"].includes(phase))){
            await cancelNativeJpeg(row);code="cancelled";
          }else{status="held";code="expired_uncertain";}
        }else if(process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED!=="true"){
          code="uploads_paused";
        }else{
          await options.finalize(row);code="checked";
        }
      }catch(error){
        code=reason(error);
        if(["integrity","conflict","denied"].includes(code))status="held";
      }
      // Never replace a concurrent terminal receipt with an old metadata copy.
      await db.transaction(async tx=>{
        await tx.execute(sql`set local lock_timeout='1s'`);
        await tx.execute(sql`set local statement_timeout='3s'`);
        await tx.select().from(mediaReservations).where(eq(mediaReservations.id,row.id)).for("update");
        const [current]=await tx.select().from(sessions).where(eq(sessions.id,row.id)).for("update");
        if(!current)return;
        if(current.state==="completed")result.completed++;
        if(current.cleanedAt){
          if(current.state==="cancelled")result.cancelled++;else result.cleaned++;
          await tx.update(sessions).set({metadata:sql`${sessions.metadata}-'nativeRecovery'`}).where(eq(sessions.id,row.id));
          return;
        }
        const metadata=current.metadata as Metadata;
        // Another worker/explicit resume owns any newer attempt.
        if(metadata.nativeRecovery&&metadata.nativeRecovery.lastAttemptAt!==progress.lastAttemptAt)return;
        await tx.update(sessions).set({metadata:{...metadata,nativeRecovery:{...progress,status,reason:code}}})
          .where(and(eq(sessions.id,row.id),sql`${sessions.cleanedAt} is null`));
        result.retained++;if(status==="held")result.held++;
      });
    }
    return result;
  }finally{running=false;}
}
