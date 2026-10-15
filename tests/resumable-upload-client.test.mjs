import test from "node:test";
import assert from "node:assert/strict";
import {File} from "node:buffer";
import {webcrypto,randomUUID} from "node:crypto";
import {resumableUpload,cancelResumableUpload,hasResumableUploadRecord,UploadPaused,ResumableRejected}
  from "../client/src/lib/resumable-upload.ts";

const realFetch=globalThis.fetch,oldStorage=globalThis.localStorage;
globalThis.crypto??=webcrypto;
const memory=new Map();
globalThis.localStorage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
test.after(()=>{globalThis.fetch=realFetch;globalThis.localStorage=oldStorage;});
test.beforeEach(()=>memory.clear());
const file=()=>new File([Buffer.alloc(1024*1024+91,7)],"fixture.jpg",{type:"image/jpeg",lastModified:12345});
const metadata={type:"image",caption:"Original caption",photographer:"Fixture credit",tags:["Day"],autoTag:false};
function transport() {
  const records=new Map(),partWrites=[],model={starts:0,commits:0,dropPart:false,dropComplete:false,onPart:null,records,partWrites};
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
  globalThis.fetch=async(url,options={})=>{
    const method=options.method||"GET";
    if(url.includes("/by-request/")){
      const r=records.get(url.split("/").at(-1));return r?reply(r):reply({error:"Not found"},404);
    }
    if(method==="POST" && url.endsWith("/upload-sessions")){
      const body=JSON.parse(options.body);model.starts++;
      const r={id:randomUUID(),state:"receiving",size:body.size,sha256:body.sha256,
        partBytes:1024*1024,received:0,uploadedBytes:0,mediaId:null,expiresAt:new Date(Date.now()+3600000).toISOString(),metadata:body.metadata};
      records.set(body.requestKey,r);return reply(r);
    }
    const sessionId=url.split("/")[3];
    const r=[...records.values()].find(r=>r.id===sessionId);assert.ok(r,"Existing scoped session required");
    if(method==="DELETE"){
      if(r.state==="completed")return reply({error:"Already saved. Check Manage Media."},409);
      r.state="cancelled";return reply({success:true});
    }
    if(method==="PUT"){
      const index=Number(url.split("/").at(-1));
      partWrites.push(index);r.received=index+1;r.uploadedBytes+=options.body.size;
      model.onPart?.();
      if(model.dropPart){model.dropPart=false;throw new TypeError("Synthetic lost part reply");}
      return reply(r);
    }
    if(url.endsWith("/complete")){
      model.commits++;r.state="completed";r.mediaId=53;
      r.item={id:53,eventId:7,type:"image",caption:r.metadata.caption};
      if(model.dropComplete){model.dropComplete=false;throw new TypeError("Synthetic lost commit reply");}
      return reply(r);
    }
    throw new Error(`Unexpected mock request: ${method} ${url}`);
  };
  return model;
}
const options=(f,extra={})=>({file:f,userId:4,eventId:7,metadata,signal:new AbortController().signal,onProgress:()=>{},...extra});

test("lost part response resumes at server-confirmed offset without reinitiating or duplicate parts",async()=>{
  const model=transport(),f=file();model.dropPart=true;
  await assert.rejects(resumableUpload(options(f)),/lost part/);
  assert.equal(hasResumableUploadRecord(f,4,7),true);
  const item=await resumableUpload(options(f));
  assert.equal(item.id,53);assert.equal(model.starts,1);assert.equal(model.commits,1);
  assert.deepEqual(model.partWrites,[0,1]);
  assert.equal(hasResumableUploadRecord(f,4,7),false);
});
test("lost commit response recovers saved item without repeating finalize or upload",async()=>{
  const model=transport(),f=file();model.dropComplete=true;
  await assert.rejects(resumableUpload(options(f)),/lost commit/);
  const writes=[...model.partWrites];
  const item=await resumableUpload(options(f));
  assert.equal(item.id,53);assert.equal(model.commits,1);assert.equal(model.starts,1);
  assert.deepEqual(model.partWrites,writes);
});
test("pause and reselect resumes acknowledged parts and preserves original metadata",async()=>{
  const model=transport(),f=file(),abort=new AbortController(),progress=[];
  model.onPart=()=>abort.abort();
  await assert.rejects(resumableUpload(options(f,{signal:abort.signal,onProgress:p=>progress.push(p)})),UploadPaused);
  model.onPart=null;
  const resumed=new File([await f.arrayBuffer()],f.name,{type:f.type,lastModified:f.lastModified});
  const item=await resumableUpload(options(resumed,{metadata:{...metadata,caption:"Must not replace saved request"},onProgress:p=>progress.push(p)}));
  assert.equal(item.caption,"Original caption");assert.equal(model.starts,1);assert.equal(model.commits,1);
  assert.deepEqual(model.partWrites,[0,1]);assert.equal(progress.at(-1),100);
});
test("cancel clears recoverable receipt; uncertain completion is never retried as a fresh upload",async()=>{
  const model=transport(),f=file();model.dropPart=true;
  await assert.rejects(resumableUpload(options(f)));
  await cancelResumableUpload(f,4,7);
  assert.equal(hasResumableUploadRecord(f,4,7),false);
  assert.equal([...model.records.values()][0].state,"cancelled");
  assert.equal(model.commits,0);
});
test("an active finalizer is checked, never restarted",async()=>{
  const model=transport(),f=file();model.dropPart=true;
  await assert.rejects(resumableUpload(options(f)));
  [...model.records.values()][0].state="finalizing";
  await assert.rejects(resumableUpload(options(f)),/Saving is still/);
  assert.equal(model.starts,1);assert.equal(model.commits,0);
  assert.deepEqual(model.partWrites,[0]);
  await cancelResumableUpload(f,99,7); // another account has no browser receipt
  assert.equal([...model.records.values()][0].state,"finalizing");
  assert.equal(hasResumableUploadRecord(f,4,7),true);
});
test("expired receiving session is cancelled before a new explicit attempt is allowed",async()=>{
  const model=transport(),f=file();model.dropPart=true;
  await assert.rejects(resumableUpload(options(f)));
  [...model.records.values()][0].expiresAt=new Date(0).toISOString();
  await assert.rejects(resumableUpload(options(f)),ResumableRejected);
  assert.equal([...model.records.values()][0].state,"cancelled");
  assert.equal(model.commits,0);assert.equal(hasResumableUploadRecord(f,4,7),false);
});
test("server-approved inactive native finalizer resumes without initiating or resending parts",async()=>{
  const model=transport(),f=file();model.dropPart=true;
  await assert.rejects(resumableUpload(options(f)));
  const status=[...model.records.values()][0];status.state="finalizing";status.canResumeFinalization=true;
  const item=await resumableUpload(options(f));
  assert.equal(item.id,53);assert.equal(model.starts,1);assert.equal(model.commits,1);
  assert.deepEqual(model.partWrites,[0]);assert.equal(hasResumableUploadRecord(f,4,7),false);
});
for(const status of [403,409,410,502])test(`finalization HTTP ${status} retains an uncertain receipt instead of claiming rejection`,async()=>{
  const model=transport(),f=file(),normal=globalThis.fetch;let blocked=true,deletes=0;
  globalThis.fetch=async(url,options={})=>{
    if(options.method==="DELETE")deletes++;
    if(blocked&&url.endsWith("/complete")){
      const record=[...model.records.values()][0];record.state="finalizing";record.canResumeFinalization=true;
      return new Response(JSON.stringify({error:"Saving is not confirmed. Space remains reserved."}),{status});
    }
    return normal(url,options);
  };
  await assert.rejects(resumableUpload(options(f)),error=>!(error instanceof ResumableRejected)&&/not confirmed/.test(error.message));
  assert.equal(hasResumableUploadRecord(f,4,7),true);assert.equal(deletes,0);
  blocked=false;
  const item=await resumableUpload(options(f,{metadata:{...metadata,caption:"Do not replace the original",
    photographer:"Do not replace the credit",tags:["Do not replace the tags"]}}));
  assert.equal(item.caption,"Original caption");assert.equal(model.starts,1);assert.equal(model.commits,1);
  assert.deepEqual([...model.records.values()][0].metadata,metadata);
  assert.deepEqual(model.partWrites,[0,1]);assert.equal(hasResumableUploadRecord(f,4,7),false);
});
