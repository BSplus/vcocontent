import type { MediaItem } from "@shared/schema";

type Metadata={type:"image"|"video";caption:string;photographer:string;tags:string[];autoTag:boolean};
type Receipt={requestKey:string;sha256:string;metadata:Metadata;sessionId?:string};
type Status={id:string;state:string;received:number;partBytes:number;size:number;uploadedBytes:number;
  sha256:string;item?:MediaItem;mediaId:number|null;expiresAt:string};
export class ResumableRejected extends Error {constructor(message:string,public status?:number){super(message);} }
export class UploadPaused extends Error {}
const key=(file:File,userId:number,eventId:number)=>
  `vco-upload:${userId}:${eventId}:${encodeURIComponent(file.name)}:${file.size}:${file.lastModified}`;
function saved(file:File,userId:number,eventId:number):Receipt|null {
  try {const record=JSON.parse(localStorage.getItem(key(file,userId,eventId))||"null");
    return typeof record?.requestKey==="string" && /^[a-f0-9]{64}$/.test(record?.sha256) && record.metadata?record:null;
  }catch{return null;}
}
export function hasResumableUploadRecord(file:File,userId:number,eventId:number) {return !!saved(file,userId,eventId);}
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
const digest=async(blob:Blob)=>hex(await crypto.subtle.digest("SHA-256",await blob.arrayBuffer()));
async function response(res:Response):Promise<Status>{
  const data=await res.json().catch(()=>null);
  if(!res.ok){
    if(res.status>=400 && res.status<500) throw new ResumableRejected(data?.error||"Upload rejected.",res.status);
    throw new Error("Upload not confirmed. Resume/check saved status before uploading this file again.");
  }
  if(!data || typeof data.id!=="string" || !Number.isSafeInteger(data.size) || data.size<1 ||
    !["receiving","finalizing","completed","failed","cancelled"].includes(data.state) ||
    !Number.isSafeInteger(data.uploadedBytes) || data.uploadedBytes<0 || data.uploadedBytes>data.size)
    throw new Error("Upload status not confirmed.");
  return data;
}
export async function cancelResumableUpload(file:File,userId:number,eventId:number) {
  const record=saved(file,userId,eventId);if(!record)return;
  if(!record.sessionId){
    const lookup=await fetch(`/api/events/${eventId}/upload-sessions/by-request/${record.requestKey}`,{credentials:"include"});
    if(lookup.status===404){localStorage.removeItem(key(file,userId,eventId));return;}
    record.sessionId=(await response(lookup)).id;
  }
  const res=await fetch(`/api/upload-sessions/${record.sessionId}`,{method:"DELETE",credentials:"include"});
  if(!res.ok)throw new Error((await res.json().catch(()=>null))?.error||"Cancellation not confirmed. Check saved status.");
  localStorage.removeItem(key(file,userId,eventId));
}

/** Same cookie authentication as normal uploads; session IDs are not bearer credentials. */
export async function resumableUpload(options:{file:File;userId:number;eventId:number;metadata:Metadata;
  signal:AbortSignal;onProgress:(percentage:number)=>void}):Promise<MediaItem> {
  const {file,userId,eventId,signal,onProgress}=options;
  const storageKey=key(file,userId,eventId);
  let receipt=saved(file,userId,eventId);
  let phase="parts";
  try{
    signal.throwIfAborted();
    const sha256=await digest(file);signal.throwIfAborted();
    if(receipt && receipt.sha256!==sha256)throw new ResumableRejected("This is not the original selected file. Cancel the previous upload first.");
    receipt??={requestKey:crypto.randomUUID(),sha256,metadata:options.metadata};
    // Fail before initiation if browser recovery storage is unavailable.
    localStorage.setItem(storageKey,JSON.stringify(receipt));
    let state:Status|undefined;
    const recovered=await fetch(`/api/events/${eventId}/upload-sessions/by-request/${receipt.requestKey}`,{credentials:"include",signal});
    if(recovered.status!==404)state=await response(recovered);
    if(!state)state=await response(await fetch(`/api/events/${eventId}/upload-sessions`,{method:"POST",
      credentials:"include",signal,headers:{"Content-Type":"application/json"},
      body:JSON.stringify({requestKey:receipt.requestKey,size:file.size,mime:file.type,sha256,metadata:receipt.metadata})}));
    receipt.sessionId=state.id;localStorage.setItem(storageKey,JSON.stringify(receipt));
    if(state.sha256!==sha256 || state.size!==file.size) throw new Error("Upload source does not match its session.");
    if(state.state==="completed"){
      if(!state.item || state.item.eventId!==eventId || state.item.id!==state.mediaId)
        throw new ResumableRejected("This file was saved but is no longer available. Check Manage Media.");
      localStorage.removeItem(storageKey);onProgress(100);return state.item;
    }
    if(state.state==="finalizing")throw new Error("Saving is still being checked. Use Resume / check status; do not upload another copy.");
    if(state.state!=="receiving") {
      await cancelResumableUpload(file,userId,eventId);
      throw new ResumableRejected("This upload expired or failed. Retry explicitly to start a new upload.");
    }
    if(new Date(state.expiresAt).getTime()<=Date.now()) {
      await cancelResumableUpload(file,userId,eventId);
      throw new ResumableRejected("This upload expired. Retry explicitly to start a new upload.");
    }
    if(!Number.isSafeInteger(state.partBytes)||state.partBytes<1||state.partBytes>1024*1024||
       !Number.isSafeInteger(state.received)||state.received<0)throw new Error("Invalid upload part plan.");
    onProgress(Math.min(99,Math.floor(state.uploadedBytes/file.size*100)));
    const sessionId=state.id;
    for(let i=state.received;i<Math.ceil(file.size/state.partBytes);i++){
      signal.throwIfAborted();
      const part=file.slice(i*state.partBytes,(i+1)*state.partBytes);
      const sha=await digest(part);signal.throwIfAborted();
      const next=await response(await fetch(`/api/upload-sessions/${sessionId}/parts/${i}`,{
        method:"PUT",credentials:"include",signal,
        headers:{"Content-Type":"application/octet-stream","X-Part-SHA256":sha},body:part}));
      onProgress(Math.min(99,Math.floor(next.uploadedBytes/file.size*100)));
    }
    signal.throwIfAborted();phase="finalizing";
    const complete=await response(await fetch(`/api/upload-sessions/${sessionId}/complete`,{method:"POST",credentials:"include",signal}));
    if(complete.state!=="completed" || !complete.item || complete.item.eventId!==eventId || complete.item.id!==complete.mediaId)
      throw new Error("Save not confirmed yet. Resume / check status before uploading another copy.");
    localStorage.removeItem(storageKey);onProgress(100);return complete.item;
  }catch(error){
    if(signal.aborted && phase!=="finalizing")
      throw new UploadPaused("Paused. Reselect the same file after reopening, then Resume. Saved caption and tags stay unchanged.");
    if(signal.aborted)throw new Error("Saving may still be running. Resume / check status before uploading another copy.");
    if(error instanceof ResumableRejected && error.status===410)
      await cancelResumableUpload(file,userId,eventId);
    throw error;
  }
}
