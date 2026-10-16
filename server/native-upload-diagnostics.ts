import type {Pool} from "@neondatabase/serverless";
import {createMediaLeasePool} from "./db";
import {createDiagnosticReader} from "./native-diagnostic-read";
import type {NativeUploadDiagnostics} from "@shared/native-upload-diagnostics";

const SAMPLE_LIMIT=200;
let diagnosticPool:Pool|undefined;
// Separate, lazily acquired connections, using the already verified runtime
// target and existing connection/query limits; never the application queue.
const read=createDiagnosticReader(()=>(diagnosticPool??=createMediaLeasePool()).connect());
const SAFE_REASONS=new Set(["pending","unconfirmed","uploads_paused","unknown_creation",
  "expired_uncertain","integrity","conflict","denied","lease_lost","busy","unavailable",
  "uncertain","cleanup_pending"]);
type DiagnosticRow={
  state:string;expires_at:Date|string;reserved_bytes:string|null;
  recovery_status:unknown;recovery_reason:unknown;retry_at:unknown;
};

/** Bounded sample, not a storage inventory or proof of object integrity. */
export function summarizeNativeUploads(rows:DiagnosticRow[],now:Date):Pick<
NativeUploadDiagnostics,"counts"|"reservedBytes"|"reasons"|"truncated">{
  const counts={sessions:0,receiving:0,finalizing:0,completedAwaitingCleanup:0,
    held:0,retryScheduled:0,due:0,expired:0};
  const reasons=new Map<string,number>();let bytes=BigInt(0);
  for(const row of rows.slice(0,SAMPLE_LIMIT)){
    counts.sessions++;
    if(row.state==="receiving")counts.receiving++;
    if(row.state==="finalizing")counts.finalizing++;
    if(row.state==="completed")counts.completedAwaitingCleanup++;
    if(new Date(row.expires_at).getTime()<=now.getTime())counts.expired++;
    const held=row.recovery_status==="held";
    if(held)counts.held++;
    else if(row.state==="finalizing"||row.state==="completed"){
      const retry=typeof row.retry_at==="string"?Date.parse(row.retry_at):NaN;
      if(Number.isFinite(retry)&&retry>now.getTime())counts.retryScheduled++;
      else counts.due++;
    }
    if(row.recovery_reason!=null){
      const reason=typeof row.recovery_reason==="string"&&SAFE_REASONS.has(row.recovery_reason)
        ?row.recovery_reason:"other";
      reasons.set(reason,(reasons.get(reason)??0)+1);
    }
    if(typeof row.reserved_bytes==="string"&&/^\d+$/.test(row.reserved_bytes))
      bytes+=BigInt(row.reserved_bytes);
  }
  return {counts,reservedBytes:bytes.toString(),truncated:rows.length>SAMPLE_LIMIT,
    reasons:Array.from(reasons).sort(([a],[b])=>a.localeCompare(b)).map(([reason,count])=>({reason,count}))};
}

export async function nativeUploadDiagnostics(signal?:AbortSignal):Promise<NativeUploadDiagnostics>{
  const now=new Date(),base:NativeUploadDiagnostics={
    availability:"not_development",nativeEnabled:false,uploadsEnabled:false,
    sampledAt:now.toISOString(),sampleLimit:SAMPLE_LIMIT,
    ...summarizeNativeUploads([],now),
  };
  // Never inspect Production or infer credential/config readiness from flags.
  if(process.env.MEDIA_STORAGE_ENVIRONMENT!=="development")return base;
  base.nativeEnabled=process.env.MEDIA_STORAGE_PROVIDER==="r2"&&
    process.env.MEDIA_STORAGE_ROUTING==="enabled"&&process.env.MEDIA_RESUMABLE_UPLOADS_ENABLED==="true"&&
    process.env.MEDIA_R2_MULTIPART_ENABLED==="true";
  base.uploadsEnabled=process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED==="true";
  return read(async query=>{
    const ready=await query(`select to_regclass('media_upload_sessions') is not null
      and to_regclass('media_reservations') is not null
      and to_regclass('media_r2_multipart_journals') is not null
      and to_regclass('media_asset_records') is not null
      and to_regclass('media_asset_objects') is not null
      and to_regclass('media_asset_variants') is not null as ready`);
    if(!ready.rows[0]?.ready)return {...base,availability:"schema_unavailable" as const};
    const result=await query(`select s.state,s.expires_at,
      r.reserved_bytes::text as reserved_bytes,
      s.metadata#>>'{nativeRecovery,status}' as recovery_status,
      s.metadata#>>'{nativeRecovery,reason}' as recovery_reason,
      s.metadata#>>'{nativeRecovery,nextAttemptAt}' as retry_at
      from (
        select id,state,expires_at,metadata from media_upload_sessions
        where cleaned_at is null and mime='image/jpeg'
        and state in ('receiving','finalizing','completed')
        and (metadata->>'nativeTransport'='r2-jpeg-v1' or metadata ? 'nativeReceipt')
        order by created_at,id limit $1
      ) s left join media_reservations r on r.id=s.id`,[SAMPLE_LIMIT+1]);
    return {...base,availability:"ready" as const,
      ...summarizeNativeUploads(result.rows as DiagnosticRow[],now)};
  },signal);
}
