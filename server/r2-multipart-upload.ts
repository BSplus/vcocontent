import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { ObjectStoreError } from "./media-storage-config";
import { withMediaWorkBudget } from "./media-work-budget";
import type { NativePart, R2MultipartDriver } from "./r2-multipart-driver";

export const R2_MULTIPART_TEST_MAX_BYTES=250*1048576;
export const R2_MULTIPART_PART_BYTES=8*1048576;
export type MultipartPlan={
  sessionId:string;actorId:number;eventId:number;
  owner:{kind:"official"|"creator";creatorId:number|null;revision:string};
  key:string;mime:string;size:number;sha256:string;expiresAt:number;
};
type Part=NativePart&{sha256:string};
export type MultipartCheckpoint={
  binding:string;phase:"initiating"|"uploading"|"completing"|"verified"|"aborting"|"aborted";
  uploadId?:string;parts:Part[];version?:string;
};
/** Integration must provide a durable journal AND exclusive destination-key lease.
 * The lease fences all writers, not just one session. Never supply an in-memory
 * journal in an application endpoint. Checkpoints/reservations survive errors.
 */
export interface MultipartJournal {
  exclusive<T>(scope:string,key:string,sessionId:string,
    work:(saved:unknown,save:(state:MultipartCheckpoint)=>Promise<void>)=>Promise<T>):Promise<T>;
}
type Context={
  driver:R2MultipartDriver;journal:MultipartJournal;
  /** Fresh gallery/owner/revision/quota/permission check, not cached initiation auth. */
  authorize(plan:MultipartPlan,stage:"upload"|"verify"|"cancel"):Promise<void>;
  signal?:AbortSignal;
};
export class MultipartUploadError extends Error {
  constructor(public code:"invalid_plan"|"integrity"|"uncertain"|"cleanup_pending"|"expired"|"closed"){
    super(`Multipart upload ${code}`);this.name="MultipartUploadError";
  }
}
const fail=(code:ConstructorParameters<typeof MultipartUploadError>[0]):never=>{throw new MultipartUploadError(code);};
const sha=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
const md5=(value:Buffer)=>createHash("md5").update(value).digest("hex");
const etag=(value:unknown)=>{
  if(typeof value!=="string"||!/^("[a-f0-9]{32}"|[a-f0-9]{32})$/.test(value))return fail("integrity");
  return value.replaceAll('"',"");
};
export function multipartPlanBinding(plan:MultipartPlan,driver:R2MultipartDriver) {
  if(!plan||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(plan.sessionId)||
    !Number.isSafeInteger(plan.actorId)||plan.actorId<=0||!Number.isSafeInteger(plan.eventId)||plan.eventId<=0||
    !plan.owner||!["official","creator"].includes(plan.owner.kind)||
    (plan.owner.kind==="official"?plan.owner.creatorId!==null:
      !Number.isSafeInteger(plan.owner.creatorId)||(plan.owner.creatorId??0)<=0)||
    typeof plan.owner.revision!=="string"||!plan.owner.revision||plan.owner.revision.length>128||
    !Number.isSafeInteger(plan.size)||plan.size<1||plan.size>R2_MULTIPART_TEST_MAX_BYTES||
    !/^[a-f0-9]{64}$/.test(plan.sha256)||!Number.isSafeInteger(plan.expiresAt)||plan.expiresAt>Date.now()+3600000)
    return fail("invalid_plan");
  driver.validate(plan.key,plan.mime);
  return sha(JSON.stringify([driver.scope,plan.sessionId,plan.actorId,plan.eventId,
    plan.owner.kind,plan.owner.creatorId,plan.owner.revision,plan.key,plan.mime,plan.size,plan.sha256,plan.expiresAt]));
}
export function restoreMultipartCheckpoint(raw:unknown,expected:string,plan:MultipartPlan):MultipartCheckpoint|null {
  if(raw==null)return null;
  const state=raw as MultipartCheckpoint;
  if(state.binding!==expected||!["initiating","uploading","completing","verified","aborting","aborted"].includes(state.phase)||
    !Array.isArray(state.parts)||state.parts.length>Math.ceil(plan.size/R2_MULTIPART_PART_BYTES)||
    (state.uploadId!==undefined&&(typeof state.uploadId!=="string"||!state.uploadId||state.uploadId.length>1024))||
    (["uploading","completing","verified","aborting"].includes(state.phase)&&!state.uploadId))
    return fail("integrity");
  state.parts.forEach((part,index)=>{
    if(part.number!==index+1||part.size!==Math.min(R2_MULTIPART_PART_BYTES,plan.size-index*R2_MULTIPART_PART_BYTES)||
      !/^[a-f0-9]{64}$/.test(part.sha256))fail("integrity");
    etag(part.etag);
  });
  if(["completing","verified"].includes(state.phase)&&state.parts.length!==Math.ceil(plan.size/R2_MULTIPART_PART_BYTES))
    fail("integrity");
  return state;
}
const missing=(error:unknown)=>error instanceof ObjectStoreError&&error.code==="missing";
async function absent(driver:R2MultipartDriver,plan:MultipartPlan,signal:AbortSignal) {
  try {await driver.head(plan.key,signal);}
  catch(error){if(missing(error))return;throw error;}
  fail("integrity"); // Never treat a colliding/previously committed key as free.
}
async function readPart(file:FileHandle,buffer:Buffer,position:number,length:number,signal:AbortSignal) {
  let count=0;
  while(count<length){
    signal.throwIfAborted();
    const result=await file.read(buffer,count,length-count,position+count);
    if(!result.bytesRead)fail("integrity");
    count+=result.bytesRead;
  }
  return buffer.subarray(0,length);
}
async function verifyRemote(plan:MultipartPlan,state:MultipartCheckpoint,context:Context,
  signal:AbortSignal,save:(state:MultipartCheckpoint)=>Promise<void>){
  const {driver}=context;
  await context.authorize(plan,"verify");
  let head;
  try {head=await driver.head(plan.key,signal);}
  catch(error){if(missing(error))return fail("uncertain");throw error;}
  if(head.size!==plan.size||head.mime!==plan.mime||head.token!==plan.sessionId||head.sha256!==plan.sha256||
    state.version!==undefined&&state.version!==head.version)
    fail("integrity");
  const source=await driver.open(plan.key,head.version,signal),hash=createHash("sha256");
  let size=0;
  try {
    for await(const chunk of source){
      signal.throwIfAborted();size+=chunk.length;
      if(size>plan.size)fail("integrity");
      hash.update(chunk);
    }
  }finally{source.destroy();}
  if(size!==plan.size||hash.digest("hex")!==plan.sha256)fail("integrity");
  await context.authorize(plan,"verify");
  state.phase="verified";state.version=head.version;await save(state);
  return {key:plan.key,size:plan.size,sha256:plan.sha256,version:head.version};
}

/** Prepared private file-backed native R2 transport; NOT wired to normal intake.
 * Caller owns staging, content/safety validation, reservations and atomic media
 * registration. Verified transport bytes alone are never publication approval.
 */
export async function uploadR2MultipartFile(plan:MultipartPlan,filename:string,context:Context){
  const expected=multipartPlanBinding(plan,context.driver);
  const signal=AbortSignal.any([context.signal??new AbortController().signal,AbortSignal.timeout(600_000)]);
  return withMediaWorkBudget(()=>context.journal.exclusive(context.driver.scope,plan.key,plan.sessionId,async(raw,save)=>{
    signal.throwIfAborted();
    let state=restoreMultipartCheckpoint(raw,expected,plan);
    if(state&&["verified","completing"].includes(state.phase))return verifyRemote(plan,state,context,signal,save);
    if(state?.phase==="initiating")return fail("uncertain"); // Create response may have been lost; never create again.
    if(state&&state.phase!=="uploading")return fail("closed");
    if(plan.expiresAt<=Date.now())return fail("expired");
    await context.authorize(plan,"upload");context.driver.writable();
    let file:FileHandle;
    try {file=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
    catch{return fail("integrity");}
    try{
      const start=await file.stat({bigint:true});
      if(!start.isFile()||start.size!==BigInt(plan.size))fail("integrity");
      const buffer=Buffer.allocUnsafe(Math.min(R2_MULTIPART_PART_BYTES,plan.size));
      const initialHash=createHash("sha256");
      for(let offset=0;offset<plan.size;offset+=buffer.length)
        initialHash.update(await readPart(file,buffer,offset,Math.min(buffer.length,plan.size-offset),signal));
      if(initialHash.digest("hex")!==plan.sha256)fail("integrity");
      if(!state){
        await absent(context.driver,plan,signal);
        await context.authorize(plan,"upload");context.driver.writable();
        state={binding:expected,phase:"initiating",parts:[]};await save(state);
        state.uploadId=await context.driver.create(plan.key,plan.mime,plan.sessionId,plan.sha256,signal);
        state.phase="uploading";await save(state);
      }
      const remote=await context.driver.parts(plan.key,state.uploadId!,signal);
      if(remote.length>Math.ceil(plan.size/R2_MULTIPART_PART_BYTES))fail("integrity");
      remote.forEach((part,index)=>{
        if(part.number!==index+1||part.size!==Math.min(R2_MULTIPART_PART_BYTES,plan.size-index*R2_MULTIPART_PART_BYTES))
          fail("integrity");
        etag(part.etag);
      });
      if(remote.length<state.parts.length)fail("integrity"); // Never overwrite an acknowledged missing/corrupt part.
      const uploadedHash=createHash("sha256");
      for(let offset=0,number=1;offset<plan.size;offset+=R2_MULTIPART_PART_BYTES,number++){
        signal.throwIfAborted();
        if(plan.expiresAt<=Date.now())fail("expired");
        await context.authorize(plan,"upload");
        const body=await readPart(file,buffer,offset,Math.min(buffer.length,plan.size-offset),signal);
        uploadedHash.update(body);
        const checksum=sha(body),wireMd5=md5(body),known=state.parts[number-1],stored=remote[number-1];
        if(known&&(known.sha256!==checksum||etag(known.etag)!==wireMd5))fail("integrity");
        if(stored){
          if(etag(stored.etag)!==wireMd5)fail("integrity");
          if(!known){state.parts.push({...stored,sha256:checksum});await save(state);}
          continue;
        }
        context.driver.writable();
        const response=await context.driver.part(plan.key,state.uploadId!,number,body,
          Buffer.from(wireMd5,"hex").toString("base64"),signal);
        if(etag(response)!==wireMd5)fail("integrity");
        state.parts.push({number,size:body.length,etag:response,sha256:checksum});await save(state);
      }
      const end=await file.stat({bigint:true});
      if(end.size!==start.size||end.mtimeNs!==start.mtimeNs||end.ctimeNs!==start.ctimeNs||
        uploadedHash.digest("hex")!==plan.sha256)fail("integrity");
      await absent(context.driver,plan,signal);
      await context.authorize(plan,"upload");context.driver.writable();
      if(plan.expiresAt<=Date.now())fail("expired");
      state.phase="completing";await save(state);
      // No automatic completion replay on ambiguous failure. Retry verifies the
      // pinned completed object instead, retaining accounted state if missing.
      await context.driver.complete(plan.key,state.uploadId!,state.parts,signal);
      return await verifyRemote(plan,state,context,signal,save);
    }finally{await file.close();}
  }),signal);
}

export async function cancelR2Multipart(plan:MultipartPlan,context:Context){
  const expected=multipartPlanBinding(plan,context.driver);
  const signal=AbortSignal.any([context.signal??new AbortController().signal,AbortSignal.timeout(60_000)]);
  return context.journal.exclusive(context.driver.scope,plan.key,plan.sessionId,async(raw,save)=>{
    await context.authorize(plan,"cancel");
    const state=restoreMultipartCheckpoint(raw,expected,plan);
    if(!state||state.phase==="aborted")return;
    if(!state.uploadId||["verified","completing","initiating"].includes(state.phase))return fail("uncertain");
    state.phase="aborting";await save(state);
    try {await context.driver.abort(plan.key,state.uploadId,signal);}
    catch(error){if(!missing(error))throw error;}
    try {await context.driver.parts(plan.key,state.uploadId,signal);}
    catch(error){
      if(missing(error)){
        await absent(context.driver,plan,signal);
        state.phase="aborted";await save(state);return;
      }
      throw error;
    }
    fail("cleanup_pending");
  });
}
