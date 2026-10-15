import test from "node:test";
import assert from "node:assert/strict";
import {open,rm,symlink} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {R2Store} from "../server/object-store.ts";
import {ObjectStoreError} from "../server/media-storage-config.ts";
import {uploadR2MultipartFile,cancelR2Multipart,R2_MULTIPART_PART_BYTES,R2_MULTIPART_TEST_MAX_BYTES} from "../server/r2-multipart-upload.ts";
import {multipartFixture} from "./helpers/r2-multipart-fixture.mjs";
const count=(f,name)=>f.state.calls.filter(n=>n===name).length;
const perform=(f,context=f.context(),plan=f.plan)=>uploadR2MultipartFile(plan,f.source,context);
const code=expected=>error=>{assert.equal(error.code,expected);return true;};

test("250 MiB native multipart transport uses one 8 MiB buffer, verifies full object and replays without source",async t=>{
  const f=await multipartFixture(R2_MULTIPART_TEST_MAX_BYTES);
  try{
    const baseline=process.memoryUsage().rss;
    const sample=setInterval(()=>{f.state.maxRss=Math.max(f.state.maxRss,process.memoryUsage().rss);},5);
    let receipt;
    try{receipt=await perform(f);}finally{clearInterval(sample);}
    assert.equal(receipt.sha256,f.plan.sha256);assert.equal(receipt.size,250*1048576);
    assert.match(receipt.version,/-32"$/);
    assert.equal(f.state.maxBody,R2_MULTIPART_PART_BYTES);assert.equal(f.state.bufferCount,1);
    assert.deepEqual(f.state.writes,Array.from({length:32},(_,i)=>i+1));
    assert.equal((await f.checkpoint()).phase,"verified");assert.equal(f.state.uploads.size,0);
    const rssGrowth=Math.max(0,f.state.maxRss-baseline);
    assert.ok(rssGrowth<96*1048576,"Transport must not buffer the 250 MiB source in RAM");
    t.diagnostic(`250 MiB fixture: max part ${f.state.maxBody}; observed RSS growth ${(rssGrowth/1048576).toFixed(1)} MiB`);
    await rm(f.source);
    f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";f.env.MEDIA_R2_MULTIPART_ENABLED="false";
    assert.deepEqual(await perform(f),receipt);
    assert.equal(count(f,"CreateMultipartUploadCommand"),1);assert.equal(count(f,"CompleteMultipartUploadCommand"),1);
    assert.equal(f.state.writes.length,32);
  }finally{await f.close();}
});

for(const fault of ["lost-part","pause"]){
  test(`${fault}: disk checkpoint/new engine reconciles acknowledged parts without overwriting`,async()=>{
    const f=await multipartFixture(17*1048576),controller=new AbortController();
    try{
      let injected=false;
      f.state.after=async(name)=>{
        if(name==="UploadPartCommand"&&!injected){injected=true;
          if(fault==="pause")controller.abort();
          else throw new Error("synthetic-private-provider-failure");}
      };
      await assert.rejects(perform(f,{...f.context(),signal:controller.signal}));
      assert.equal(count(f,"CompleteMultipartUploadCommand"),0);
      assert.ok(f.state.uploads.size>0);
      f.state.after=undefined;
      const receipt=await perform(f);
      assert.equal(receipt.sha256,f.plan.sha256);assert.deepEqual(f.state.writes,[1,2,3]);
      assert.equal(count(f,"CreateMultipartUploadCommand"),1);
    }finally{await f.close();}
  });
}

test("lost completion response verifies committed bytes; never completes or initializes twice",async()=>{
  const f=await multipartFixture();
  try{
    f.state.after=async name=>{if(name==="CompleteMultipartUploadCommand")throw Error("private failed reply");};
    await assert.rejects(perform(f),ObjectStoreError);assert.equal((await f.checkpoint()).phase,"completing");
    assert.equal(f.state.objects.size,1);f.state.after=undefined;
    assert.equal((await perform(f)).sha256,f.plan.sha256);
    assert.equal(count(f,"CreateMultipartUploadCommand"),1);assert.equal(count(f,"CompleteMultipartUploadCommand"),1);
  }finally{await f.close();}
});

test("lost initiation reply retains uncertain journal and cannot create/abort an unproven upload",async()=>{
  const f=await multipartFixture();
  try{
    f.state.after=async name=>{if(name==="CreateMultipartUploadCommand")throw Error("private reply lost");};
    await assert.rejects(perform(f),ObjectStoreError);f.state.after=undefined;
    assert.equal((await f.checkpoint()).phase,"initiating");
    await assert.rejects(perform(f),code("uncertain"));
    await assert.rejects(cancelR2Multipart(f.plan,f.context()),code("uncertain"));
    assert.equal(count(f,"CreateMultipartUploadCommand"),1);assert.equal(count(f,"AbortMultipartUploadCommand"),0);
    assert.equal(f.state.uploads.size,1);
  }finally{await f.close();}
});

test("missing completion remains uncertain, cannot reinitialize or delete a possibly committed object",async()=>{
  const f=await multipartFixture();
  try{
    f.state.before=async name=>{if(name==="CompleteMultipartUploadCommand")throw Error("RPC not confirmed");};
    await assert.rejects(perform(f));f.state.before=undefined;
    await assert.rejects(perform(f),code("uncertain"));
    await assert.rejects(cancelR2Multipart(f.plan,f.context()),code("uncertain"));
    assert.equal(count(f,"CompleteMultipartUploadCommand"),1);assert.equal(f.state.uploads.size,1);
  }finally{await f.close();}
});

test("closed write gate blocks new writes; known cancellation confirms removal and is replay-safe",async()=>{
  const f=await multipartFixture();
  try{
    f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";f.env.MEDIA_R2_MULTIPART_ENABLED="false";
    await assert.rejects(perform(f),code("configuration"));assert.equal(f.state.calls.length,0);
    f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="true";f.env.MEDIA_R2_MULTIPART_ENABLED="true";
    f.state.before=async(name,input)=>{if(name==="UploadPartCommand"&&input.PartNumber===2)throw Error("stop");};
    await assert.rejects(perform(f));f.state.before=undefined;
    f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";f.env.MEDIA_R2_MULTIPART_ENABLED="false";
    await cancelR2Multipart(f.plan,f.context());
    assert.equal((await f.checkpoint()).phase,"aborted");assert.equal(f.state.uploads.size,0);
    const calls=f.state.calls.length;await cancelR2Multipart(f.plan,f.context());assert.equal(f.state.calls.length,calls);
    await assert.rejects(perform(f),code("closed"));
  }finally{await f.close();}
});

test("uncertain abort keeps cleanup pending until missing upload is confirmed",async()=>{
  const f=await multipartFixture();
  try{
    f.state.before=async name=>{if(name==="UploadPartCommand")throw Error("pause");};
    await assert.rejects(perform(f));f.state.before=undefined;
    f.state.after=async name=>{if(name==="AbortMultipartUploadCommand")throw Error("abort reply lost");};
    await assert.rejects(cancelR2Multipart(f.plan,f.context()));
    assert.equal((await f.checkpoint()).phase,"aborting");
    f.state.after=undefined;await cancelR2Multipart(f.plan,f.context());
    assert.equal((await f.checkpoint()).phase,"aborted");assert.equal(f.state.uploads.size,0);
  }finally{await f.close();}
});

test("binding rejects changed actor, owner, event, key, checksum or provider scope without writes",async()=>{
  const f=await multipartFixture();
  try{
    f.state.before=async name=>{if(name==="UploadPartCommand")throw Error("pause");};
    await assert.rejects(perform(f));f.state.before=undefined;
    const before=f.state.calls.length;
    for(const change of [{actorId:102},{eventId:202},{owner:{...f.plan.owner,revision:"changed"}},
      {owner:{kind:"official",creatorId:null,revision:"changed"}},{sha256:"f".repeat(64)}])
      await assert.rejects(perform(f,f.context(),{...f.plan,...change}),code("integrity"));
    // A changed key would use a different destination lease: durable journal is
    // session-bound as well, and its binding must still reject the mutation.
    await assert.rejects(perform(f,f.context(),{...f.plan,key:`media-${randomUUID()}.mp4`}),code("integrity"));
    const context=f.context();context.driver={...context.driver,scope:"different-provider-scope"};
    await assert.rejects(perform(f,context),code("integrity"));
    assert.equal(f.state.calls.length,before);
  }finally{await f.close();}
});

test("a committed destination blocks cancellation cleanup confirmation even when native parts disappear",async()=>{
  const f=await multipartFixture();
  try{
    f.state.before=async name=>{if(name==="UploadPartCommand")throw Error("pause");};
    await assert.rejects(perform(f));f.state.before=undefined;
    f.state.after=async name=>{
      if(name==="AbortMultipartUploadCommand")f.state.objects.set(f.plan.key,{
        files:[],size:1,mime:f.plan.mime,metadata:{},version:'"unexpected-committed-version"'});
    };
    await assert.rejects(cancelR2Multipart(f.plan,f.context()),code("integrity"));
    assert.equal((await f.checkpoint()).phase,"aborting");
    assert.equal(f.state.objects.size,1);
  }finally{await f.close();}
});

test("permission/quota changes stop finalization and retained checkpoint is not released",async()=>{
  const f=await multipartFixture();
  try{
    let revoked=false;
    f.state.after=async(name,input)=>{if(name==="UploadPartCommand"&&input.PartNumber===2)revoked=true;};
    const context={...f.context(),authorize:async()=>{if(revoked)throw Error("fixture permission revoked");}};
    await assert.rejects(perform(f,context),/permission revoked/);
    assert.equal(count(f,"CompleteMultipartUploadCommand"),0);
    assert.equal((await f.checkpoint()).phase,"uploading");
    assert.equal(f.state.uploads.size,1);await cancelR2Multipart(f.plan,f.context());
  }finally{await f.close();}
});

for(const fault of ["extra","missing","changed-etag","wrong-size"]){
  test(`remote ${fault} part cannot be silently repaired or published`,async()=>{
    const f=await multipartFixture();
    try{
      f.state.before=async(name,input)=>{if(name==="UploadPartCommand"&&input.PartNumber===2)throw Error("pause");};
      await assert.rejects(perform(f));f.state.before=undefined;
      const upload=[...f.state.uploads.values()][0],part=upload.parts.get(1);
      if(fault==="extra")upload.parts.set(3,{...part,number:3});
      if(fault==="missing")upload.parts.delete(1);
      if(fault==="changed-etag")part.etag=`"${"c".repeat(32)}"`;
      if(fault==="wrong-size")part.size--;
      const writes=f.state.writes.length;
      await assert.rejects(perform(f),code("integrity"));assert.equal(f.state.writes.length,writes);
      assert.equal(count(f,"CompleteMultipartUploadCommand"),0);
    }finally{await f.close();}
  });
}

test("completed metadata/ETag is not proof of SHA-256 integrity",async()=>{
  const f=await multipartFixture();
  try{
    await perform(f);const object=f.state.objects.get(f.plan.key);
    const file=await open(object.files[0],"r+");try{await file.write(Buffer.from([99]),0,1,0);}finally{await file.close();}
    await assert.rejects(perform(f),code("integrity"));assert.equal(count(f,"CompleteMultipartUploadCommand"),1);
  }finally{await f.close();}
});

test("new engine honors the destination-key lease across distinct session IDs",async()=>{
  const f=await multipartFixture();
  let release;
  try{
    let entered;
    const ready=new Promise(resolve=>{entered=resolve;});
    const held=new Promise(resolve=>{release=resolve;});
    f.state.before=async name=>{if(name==="CreateMultipartUploadCommand"){entered();await held;}};
    const first=perform(f);
    await ready;
    try{
      await assert.rejects(perform(f,f.context(),{...f.plan,sessionId:randomUUID()}),/destination lease already held/);
    }finally{release();}
    await first;assert.equal(count(f,"CreateMultipartUploadCommand"),1);
    assert.equal(f.state.objects.size,1);
  }finally{release?.();await f.close();}
});

for(const fault of ["truncated-list","wrong-token","wrong-version","changed-source"]){
  test(`${fault} fails closed without releasing the checkpoint`,async()=>{
    const f=await multipartFixture();
    try{
      if(fault==="wrong-version"){
        await perform(f);f.state.objects.get(f.plan.key).version='"unexpected-version"';
      }else{
        f.state.after=async(name,input,result)=>{
          if(fault==="truncated-list"&&name==="ListPartsCommand")result.IsTruncated=true;
          if(fault==="wrong-token"&&name==="CompleteMultipartUploadCommand")
            f.state.objects.get(f.plan.key).metadata["vco-upload"]=randomUUID();
          if(fault==="changed-source"&&name==="UploadPartCommand"&&input.PartNumber===1){
            const file=await open(f.source,"r+");
            try{await file.write(Buffer.from([99]),0,1,R2_MULTIPART_PART_BYTES);}finally{await file.close();}
          }
        };
      }
      await assert.rejects(perform(f),code("integrity"));
      assert.notEqual((await f.checkpoint()).phase,"aborted");
      if(["truncated-list","changed-source"].includes(fault))assert.equal(count(f,"CompleteMultipartUploadCommand"),0);
    }finally{await f.close();}
  });
}

test("invalid sizes, expiry, local checksum and symlink fail without creating native parts",async()=>{
  const f=await multipartFixture();
  try{
    for(const change of [{size:0},{size:R2_MULTIPART_TEST_MAX_BYTES+1},{sha256:"invalid"},
      {expiresAt:Date.now()+7200000},{owner:{kind:"creator",creatorId:null,revision:"invalid"}}])
      await assert.rejects(perform(f,f.context(),{...f.plan,...change}),code("invalid_plan"));
    await assert.rejects(perform(f,f.context(),{...f.plan,expiresAt:Date.now()-1}),code("expired"));
    await assert.rejects(perform(f,f.context(),{...f.plan,sha256:"f".repeat(64)}),code("integrity"));
    await symlink(f.source,f.source+".link");
    await assert.rejects(uploadR2MultipartFile(f.plan,f.source+".link",f.context()),code("integrity"));
    assert.equal(count(f,"CreateMultipartUploadCommand"),0);
  }finally{await f.close();}
});

test("preparation defaults off; database/environment/key gates cannot be bypassed",async()=>{
  const f=await multipartFixture();
  try{
    for(const change of [{MEDIA_R2_MULTIPART_ENABLED:undefined},{MEDIA_R2_MULTIPART_ENABLED:"false"},
      {MEDIA_STORAGE_PROVIDER:"replit"},{MEDIA_STORAGE_ROUTING:"disabled"}])
      assert.throws(()=>new R2Store({...f.env,...change},{send(){throw Error("No real calls");}}).preparedMultipart().writable(),ObjectStoreError);
    for(const change of [{MEDIA_STORAGE_DATABASE_FINGERPRINT:"0".repeat(64)},{MEDIA_STORAGE_ENVIRONMENT:"production"},
      {R2_PROD_ACCESS_KEY_ID:"synthetic-conflicting"}])
      assert.throws(()=>new R2Store({...f.env,...change},{send(){throw Error("No real calls");}}).preparedMultipart(),ObjectStoreError);
    const context=f.context();
    await assert.rejects(perform(f,context,{...f.plan,key:"../not-allowed"}),ObjectStoreError);
    await assert.rejects(perform(f,context,{...f.plan,mime:"application/octet-stream"}),ObjectStoreError);
    const production={...f.env,NODE_ENV:"production",MEDIA_STORAGE_ENVIRONMENT:"production",REPLIT_DEPLOYMENT:"1",
      MEDIA_STORAGE_PRODUCTION_APPROVED:"true",R2_BUCKET:"vco-content-media",
      R2_PROD_ACCESS_KEY_ID:"synthetic-prod",R2_PROD_SECRET_ACCESS_KEY:"synthetic-prod",R2_PROD_WRITE_ENABLED:"true"};
    delete production.R2_DEV_ACCESS_KEY_ID;delete production.R2_DEV_SECRET_ACCESS_KEY;
    assert.throws(()=>new R2Store(production,{send(){throw Error("No Production calls");}}).preparedMultipart(),ObjectStoreError);
    assert.equal(f.state.calls.length,0);
  }finally{await f.close();}
});
