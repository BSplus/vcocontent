import "./helpers/beta-provider-preload.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {randomUUID,createHash} from "node:crypto";
import {readFile,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import sharp from "sharp";
import {eq,inArray,sql} from "drizzle-orm";
import {db,pool} from "../server/db.ts";
import {storage} from "../server/storage.ts";
import {users,events,mediaItems,mediaReservations,mediaUploadSessions as sessions,mediaAnalysisJobs,mediaAssetObjects,
  mediaAssetVariants,mediaAssetRecords,mediaObjectRoutes,mediaCleanup,betaRateLimits}
  from "../shared/schema.ts";
import {registerRoutes} from "../server/routes.ts";
import {stopAnalysisWorker} from "../server/analysis-jobs.ts";
import {UPLOAD_PART_BYTES} from "../server/resumable-uploads.ts";
import {mediaDatabaseFingerprint} from "../server/media-storage-config.ts";
import {multipartFixture} from "./helpers/r2-multipart-fixture.mjs";
import {nativeR2HttpFixture} from "./helpers/native-r2-http-fixture.mjs";
import {R2Store,ObjectStoreError} from "../server/object-store.ts";
import {retainedStorageUsage} from "../server/retained-storage.ts";
import {linkAssetObject} from "../server/media-asset-store.ts";
import {resolveGalleryOwnership} from "../shared/gallery-ownership.ts";
import {mockMediaStorage} from "./helpers/memory-media-storage.mjs";

const hash=b=>createHash("sha256").update(b).digest("hex");
test("authenticated native JPEG intake stays isolated and gated",{timeout:150000},async t=>{
  assert.ok(process.env.VCO_TEST_PG_PROXY&&process.env.VCO_TEST_OBJECTS);
  assert.equal(new URL(process.env.DATABASE_URL).hostname,"127.0.0.1");
  // Only known synthetic provider configuration, inside this disposable child.
  const synthetic=await multipartFixture(1024),database=process.env.DATABASE_URL;
  Object.assign(process.env,synthetic.env,{DATABASE_URL:database,
    MEDIA_STORAGE_DATABASE_FINGERPRINT:mediaDatabaseFingerprint(database),
    MEDIA_RESUMABLE_UPLOADS_ENABLED:"true"});
  await synthetic.close();
  const {fixtureRoots,restoreR2Fixture}=await import("./helpers/r2-cli-preload.mjs");
  const native=nativeR2HttpFixture(fixtureRoots.r2),memory=mockMediaStorage(),accounts=[];
  let server;
  try{
    await db.execute(sql`create table media_r2_multipart_journals(
      session_id text primary key references media_upload_sessions(id) on delete restrict,
      reservation_id text not null unique references media_reservations(id) on delete restrict,
      scope text not null,object_key text not null,binding text not null,revision integer not null default 0,
      checkpoint jsonb,updated_at timestamptz not null default now(),unique(scope,object_key),
      check(session_id=reservation_id),check(checkpoint is null or jsonb_typeof(checkpoint)='object'))`);
    for(let i=0;i<3;i++){
      const [user]=await db.insert(users).values({username:`native-${randomUUID()}`,email:`${randomUUID()}@example.invalid`,
        password:"unused-fixture",isCreator:true,isAdmin:i===2,creatorStatus:"approved",emailVerifiedAt:new Date()}).returning();
      accounts.push(user);
    }
    const app=express();
    app.use((req,_res,next)=>{req.user=accounts[Number(req.get("x-actor")??0)];req.isAuthenticated=()=>!!req.user;next();});
    server=await registerRoutes(app,{workers:false});server.listen(0,"127.0.0.1");await once(server,"listening");
    const base=`http://127.0.0.1:${server.address().port}`;
    const request=(url,options={},actor=0)=>fetch(base+url,{...options,headers:{"x-actor":String(actor),...options.headers}});
    const jpeg=await sharp({create:{width:96,height:48,channels:3,background:"blue"}}).withMetadata({orientation:6}).jpeg().toBuffer();
    const bytes=Buffer.concat([jpeg,Buffer.alloc(UPLOAD_PART_BYTES+81-jpeg.length)]);
    const using=async(options,work)=>{
      const gallery=await storage.createEvent({title:"Native isolated fixture",description:"Private test",date:new Date(),
        creatorId:options.official?null:accounts[0].id});
      const actor=options.admin?2:0;
      const body={requestKey:randomUUID(),size:bytes.length,mime:"image/jpeg",sha256:hash(bytes),
        metadata:{type:"image",caption:"Creator-written caption",photographer:"Fixture credit",tags:["Day"],autoTag:false}};
      const f={gallery,body,bytes,actor,request,session:null,
        init:async(extra={})=>request(`/api/events/${gallery.id}/upload-sessions`,{method:"POST",
          headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,...extra})},actor),
        complete:()=>request(`/api/upload-sessions/${f.session.id}/complete`,{method:"POST"},actor),
        status:async()=> (await request(`/api/upload-sessions/${f.session.id}`,{},actor)).json(),
        cancel:()=>request(`/api/upload-sessions/${f.session.id}`,{method:"DELETE"},actor),
        async stage(){
          const init=await this.init();assert.equal(init.status,200);this.session=await init.json();
          for(let i=0;i<Math.ceil(this.bytes.length/UPLOAD_PART_BYTES);i++){
            const part=this.bytes.subarray(i*UPLOAD_PART_BYTES,(i+1)*UPLOAD_PART_BYTES);
            const response=await request(`/api/upload-sessions/${this.session.id}/parts/${i}`,{method:"PUT",
              headers:{"Content-Type":"application/octet-stream","X-Part-SHA256":hash(part)},body:part},actor);
            assert.equal(response.status,200);
          }
        }};
      try{await work(f);}
      finally{
        native.failAfter=null;
        process.env.MEDIA_R2_MULTIPART_ENABLED="true";process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="true";
        await stopAnalysisWorker();
        // Exact fixture IDs only. Unknown remote state is an in-memory fake,
        // never a reason to weaken the application's production cleanup.
        const rows=await db.select().from(sessions).where(eq(sessions.eventId,gallery.id));
        for(const row of rows){
          await db.execute(sql`delete from media_r2_multipart_journals where session_id=${row.id}`);
          await db.delete(sessions).where(eq(sessions.id,row.id));await storage.abandonMedia(row.id);
          await rm(path.join(tmpdir(),"vco-upload-sessions",row.id),{recursive:true,force:true});
        }
        // Use application inventory handoff, not manual variant/object removal.
        if((await db.select().from(events).where(eq(events.id,gallery.id))).length){
          const deleted=await storage.deleteEvent(gallery.id);assert.equal(deleted.success,true,deleted.message);
        }
        for(let attempt=0;attempt<8;attempt++){
          await storage.cleanupObjects();
          if(!(await db.select({key:mediaCleanup.key}).from(mediaCleanup).limit(1)).length)break;
        }
      }
    };
    await t.test("native selection requires explicit flag/schema and cannot be supplied by a browser",async()=>using({},async f=>{
      assert.equal((await f.init({metadata:{...f.body.metadata,nativeTransport:"r2-jpeg-v1"}})).status,400);
      assert.equal((await f.init({storageKey:"media-untrusted.jpg"})).status,400);
      await db.execute(sql`alter table media_r2_multipart_journals rename to native_hidden_fixture`);
      try{assert.equal((await f.init()).status,502);}
      finally{await db.execute(sql`alter table native_hidden_fixture rename to media_r2_multipart_journals`);}
      process.env.MEDIA_R2_MULTIPART_ENABLED="false";
      const response=await f.init();assert.equal(response.status,200);
      const row=await response.json();
      assert.equal((await db.select().from(sessions).where(eq(sessions.id,row.id)))[0].metadata.nativeTransport,undefined);
    }));
    for(const options of [{},{official:true,admin:true},{admin:true}])await t.test(
      options.official?"official source and stripped visitor export remain protected":
        options.admin?"admin-to-Creator ownership remains charged to the Creator":"Creator JPEG saves once with ordinary preview and source delivery",
      async()=>using(options,async f=>{
        await f.stage();
        const responses=await Promise.all([f.complete(),f.complete()]);
        assert.ok(responses.every(r=>[200,202].includes(r.status)));
        const final=await f.complete();assert.equal(final.status,200);const done=await final.json();
        assert.equal(done.state,"completed");assert.equal(done.item.caption,"Creator-written caption");
        assert.deepEqual(done.item.manualTags,["Day"]);assert.equal(done.item.photographer,"Fixture credit");
        const row=(await db.select().from(sessions).where(eq(sessions.id,f.session.id)))[0];
        assert.ok(row.cleanedAt);assert.equal(row.metadata.nativeReceipt.kind,"registered");
        const sourceKey=done.item.url.split("/").at(-1);
        assert.deepEqual(await readFile(path.join(fixtureRoots.r2,sourceKey)),bytes);
        await assert.rejects(readFile(path.join(fixtureRoots.replit,sourceKey)),e=>e.code==="ENOENT");
        const original=await request(done.item.url,{},f.actor);
        assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
        assert.equal((await request(done.item.thumbnail,{},f.actor)).status,200);
        assert.equal((await request(`/api/upload-sessions/${f.session.id}`,{},1)).status,404);
        assert.equal((await f.cancel()).status,409);
        const objects=await db.select().from(mediaAssetObjects).where(eq(mediaAssetObjects.eventId,f.gallery.id));
        assert.equal(objects.length,2);assert.ok(objects.every(o=>o.ownerId===(options.official?null:accounts[0].id)));
        assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,f.session.id))).length,0);
        assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,done.mediaId))).length,
          options.official?0:1);
        if(options.official){
          const exported=await request(done.item.url,{},0);assert.equal(exported.status,200);
          assert.equal((await sharp(Buffer.from(await exported.arrayBuffer())).metadata()).exif,undefined);
        }
      }));
    await t.test("lost part acknowledgement resumes without repeating its write or growing assembly staging",async()=>using({},async f=>{
      await f.stage();let lost=false;
      native.failAfter=name=>{if(name==="UploadPartCommand"&&!lost){lost=true;throw Error("lost fixture response");}};
      const writes=()=>native.calls.filter(n=>n==="UploadPartCommand").length;
      const before=writes();assert.ok((await f.complete()).status>=400);
      assert.equal((await f.status()).canResumeFinalization,true);
      native.failAfter=null;
      const response=await f.complete();assert.equal(response.status,200);
      assert.equal(writes()-before,1);
    }));
    await t.test("known incomplete upload can be cancelled with both write gates closed",async()=>using({},async f=>{
      await f.stage();native.failAfter=name=>{if(name==="UploadPartCommand")throw Error("pause fixture");};
      assert.ok((await f.complete()).status>=400);native.failAfter=null;
      process.env.MEDIA_R2_MULTIPART_ENABLED="false";process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";
      assert.equal((await f.complete()).status,502);assert.equal((await f.status()).state,"finalizing");
      assert.equal((await f.cancel()).status,200);
      assert.equal((await f.status()).state,"cancelled");assert.equal((await f.cancel()).status,200);
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,f.session.id))).length,0);
    }));
    await t.test("unknown Create reply never repeats Create, discards staging or releases capacity",async()=>using({},async f=>{
      await f.stage();native.failAfter=name=>{if(name==="CreateMultipartUploadCommand")throw Error("unknown fixture");};
      const count=()=>native.calls.filter(n=>n==="CreateMultipartUploadCommand").length;
      const before=count();assert.ok((await f.complete()).status>=400);native.failAfter=null;
      assert.equal((await f.complete()).status,409);assert.equal(count()-before,1);
      assert.equal((await f.cancel()).status,409);
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,f.session.id))).length,1);
      await readFile(path.join(tmpdir(),"vco-upload-sessions",f.session.id,"assembled-native","source"));
      assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.eventId,f.gallery.id))).length,0);
    }));
    await t.test("lost Complete reply recovers the same source without repeating Complete",async()=>using({},async f=>{
      await f.stage();let lost=false;
      const count=()=>native.calls.filter(n=>n==="CompleteMultipartUploadCommand").length,before=count();
      native.failAfter=name=>{if(name==="CompleteMultipartUploadCommand"&&!lost){lost=true;throw Error("lost complete");}};
      assert.ok((await f.complete()).status>=400);native.failAfter=null;
      const response=await f.complete();assert.equal(response.status,200);assert.equal(count()-before,1);
      assert.equal((await response.json()).state,"completed");
    }));
    await t.test("lost database commit reply still finishes safety, staging cleanup and one asset",async()=>using({},async f=>{
      await f.stage();const finish=storage.finishMedia;
      storage.finishMedia=async function(...args){await finish.apply(this,args);throw Error("lost commit reply");};
      try{
        const response=await f.complete();assert.equal(response.status,200);
        const done=await response.json();assert.equal(done.state,"completed");
        assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.eventId,f.gallery.id))).length,1);
        assert.ok((await db.select().from(sessions).where(eq(sessions.id,f.session.id)))[0].cleanedAt);
      }finally{storage.finishMedia=finish;}
    }));
    await t.test("gate closure after source upload prevents publication; reopening resumes without another source upload",async()=>using({},async f=>{
      await f.stage();
      const count=()=>native.calls.filter(n=>n==="CreateMultipartUploadCommand").length,before=count();
      native.failAfter=name=>{if(name==="CompleteMultipartUploadCommand")process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";};
      assert.ok((await f.complete()).status>=400);native.failAfter=null;
      assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.eventId,f.gallery.id))).length,0);
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,f.session.id))).length,1);
      process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="true";
      assert.equal((await f.complete()).status,200);assert.equal(count()-before,1);
    }));
    await t.test("invalid JPEG never starts a provider upload and can be retried as a new explicit session",async()=>using({},async f=>{
      f.bytes=Buffer.alloc(bytes.length,23);f.body.sha256=hash(f.bytes);
      await f.stage();const before=native.calls.filter(n=>n==="CreateMultipartUploadCommand").length;
      assert.equal((await f.complete()).status,400);
      assert.equal(native.calls.filter(n=>n==="CreateMultipartUploadCommand").length,before);
      assert.equal((await f.status()).state,"cancelled");assert.equal((await f.cancel()).status,200);
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,f.session.id))).length,0);
    }));
    const saved=async f=>{
      await f.stage();const response=await f.complete();assert.equal(response.status,200);
      await stopAnalysisWorker();return (await response.json()).item;
    };
    const remove=(f,item,actor=f.actor)=>request(`/api/media/${item.id}`,{method:"DELETE"},actor);
    const removeGallery=(f,actor=f.actor)=>request(`/api/events/${f.gallery.id}`,{method:"DELETE"},actor);
    const usage=()=>retainedStorageUsage(db,accounts[0].id);
    await t.test("normal owner deletion retires native inventory; another Creator cannot delete it",async()=>using({},async f=>{
      const item=await saved(f);
      assert.equal((await remove(f,item,1)).status,403);
      assert.equal((await remove(f,item)).status,204);await storage.cleanupObjects();
      assert.equal((await db.select().from(mediaAssetObjects).where(eq(mediaAssetObjects.eventId,f.gallery.id))).length,0);
      assert.equal((await db.select().from(mediaAssetRecords).where(eq(mediaAssetRecords.mediaId,item.id))).length,0);
      for(const key of [item.url,item.thumbnail].map(url=>url.split("/").at(-1))){
        assert.equal((await db.select().from(mediaObjectRoutes).where(eq(mediaObjectRoutes.key,key)))[0].state,"deleted");
        await assert.rejects(readFile(path.join(fixtureRoots.r2,key)),e=>e.code==="ENOENT");
      }
      assert.equal((await removeGallery(f,1)).status,403);
      assert.equal((await removeGallery(f)).status,200);
    }));
    await t.test("official native gallery deletion remains admin-only",async()=>using({official:true,admin:true},async f=>{
      const item=await saved(f);
      assert.equal((await removeGallery(f,0)).status,403);
      assert.equal((await removeGallery(f)).status,200);await storage.cleanupObjects();
      for(const url of [item.url,item.thumbnail])
        await assert.rejects(readFile(path.join(fixtureRoots.r2,url.split("/").at(-1))),e=>e.code==="ENOENT");
    }));
    await t.test("failed, false-positive and lost deletion replies retain bytes until absence is confirmed",async()=>using({},async f=>{
      const item=await saved(f),before=(await usage()).bytes,original=R2Store.prototype.delete;
      const keys=[item.url,item.thumbnail].map(url=>url.split("/").at(-1));
      try{
        R2Store.prototype.delete=async()=>{throw new ObjectStoreError("upstream");};
        process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";process.env.MEDIA_R2_MULTIPART_ENABLED="false";
        assert.equal((await removeGallery(f)).status,200);await storage.cleanupObjects();
        assert.equal((await usage()).bytes,before);
        assert.equal((await request(item.url,{},f.actor)).status,404,"Logical deletion revokes delivery before physical cleanup");
        assert.equal((await db.select().from(events).where(eq(events.id,f.gallery.id))).length,0);
        for(const key of keys)await readFile(path.join(fixtureRoots.r2,key));
        R2Store.prototype.delete=async()=>{}; // provider acceptance is not absence
        await storage.cleanupObjects();assert.equal((await usage()).bytes,before);
        R2Store.prototype.delete=async function(key){
          await original.call(this,key);throw new ObjectStoreError("upstream");
        };
        await storage.cleanupObjects();assert.equal((await usage()).bytes,before);
        for(const key of keys)await assert.rejects(readFile(path.join(fixtureRoots.r2,key)),e=>e.code==="ENOENT");
        R2Store.prototype.delete=original;await storage.cleanupObjects();
        assert.equal((await usage()).bytes,0);
      }finally{R2Store.prototype.delete=original;}
    }));
    await t.test("shared native source and thumbnail survive until their final media reference is removed",async()=>using({},async f=>{
      const item=await saved(f),before=(await usage()).bytes;
      const [copy]=await db.insert(mediaItems).values({eventId:f.gallery.id,type:"image",url:item.url,thumbnail:item.thumbnail,
        highBytes:item.highBytes,lowBytes:item.lowBytes,storedBytes:item.storedBytes}).returning();
      const ownership=resolveGalleryOwnership(f.gallery),source=item.url.split("/").at(-1);
      for(const [url,purpose] of [[item.url,"original"],[item.thumbnail,"thumbnail"]]){
        const key=url.split("/").at(-1),[route]=await db.select().from(mediaObjectRoutes).where(eq(mediaObjectRoutes.key,key));
        await linkAssetObject({mediaId:copy.id,ownership,key,purpose,sourceVersion:1,
          ...(purpose==="original"?{}:{sourceKey:source}),sha256:route.sha256,objectVersion:route.objectVersion});
      }
      assert.equal((await remove(f,item)).status,204);await storage.cleanupObjects();
      assert.equal((await usage()).bytes,before);
      assert.equal((await db.select().from(mediaAssetObjects).where(eq(mediaAssetObjects.eventId,f.gallery.id))).length,2);
      assert.equal((await remove(f,copy)).status,204);await storage.cleanupObjects();
      assert.equal((await usage()).bytes,0);
    }));
    await t.test("registered derivatives outside legacy URLs also enter cleanup",async()=>using({},async f=>{
      const item=await saved(f),key=`thumb-${randomUUID()}.webp`,bytes=Buffer.from("isolated object fixture");
      await writeFile(path.join(fixtureRoots.r2,key),bytes);
      await db.insert(mediaObjectRoutes).values({key,provider:"r2",state:"verified",sha256:hash(bytes),
        size:bytes.length,mime:"image/webp",objectVersion:"fixture"});
      await linkAssetObject({mediaId:item.id,ownership:resolveGalleryOwnership(f.gallery),key,purpose:"preview",
        sourceVersion:1,sourceKey:item.url.split("/").at(-1),sha256:hash(bytes),objectVersion:"fixture"});
      assert.equal((await usage()).bytes,item.storedBytes+bytes.length);
      assert.equal((await removeGallery(f)).status,200);await storage.cleanupObjects();
      await assert.rejects(readFile(path.join(fixtureRoots.r2,key)),e=>e.code==="ENOENT");
      assert.equal((await usage()).bytes,0);
    }));
    await t.test("changed provider version cannot be deleted or released",async()=>using({},async f=>{
      const item=await saved(f),key=item.url.split("/").at(-1),metadata=R2Store.prototype.metadata,del=R2Store.prototype.delete;
      let attempts=0;
      try{
        R2Store.prototype.metadata=async function(k){const result=await metadata.call(this,k);
          return k===key?{...result,version:"unexpected replacement"}:result;};
        R2Store.prototype.delete=async function(k){if(k===key)attempts++;await del.call(this,k);};
        assert.equal((await removeGallery(f)).status,200);await storage.cleanupObjects();
        assert.equal(attempts,0);await readFile(path.join(fixtureRoots.r2,key));
        assert.equal((await usage()).bytes,item.highBytes);
      }finally{R2Store.prototype.metadata=metadata;R2Store.prototype.delete=del;await storage.cleanupObjects();}
    }));
    await t.test("unverified inventory or unfinished native staging blocks deletion without partial handoff",async()=>using({},async f=>{
      const item=await saved(f),key=item.url.split("/").at(-1);
      const [route]=await db.select().from(mediaObjectRoutes).where(eq(mediaObjectRoutes.key,key));
      try{
        await db.update(mediaObjectRoutes).set({sha256:null}).where(eq(mediaObjectRoutes.key,key));
        assert.equal((await removeGallery(f)).status,500);
        assert.equal((await db.select().from(mediaAssetObjects).where(eq(mediaAssetObjects.eventId,f.gallery.id))).length,2);
        assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.id,item.id))).length,1);
      }finally{await db.update(mediaObjectRoutes).set({sha256:route.sha256}).where(eq(mediaObjectRoutes.key,key));}
      await db.update(sessions).set({cleanedAt:null}).where(eq(sessions.id,f.session.id));
      assert.equal((await removeGallery(f)).status,500);
      assert.equal((await remove(f,item)).status,500);
      await db.update(sessions).set({cleanedAt:new Date()}).where(eq(sessions.id,f.session.id));
    }));
    await t.test("a reference from another gallery prevents partial gallery deletion",async()=>using({},async f=>{
      const item=await saved(f),other=await storage.createEvent({title:"Scoped referencing fixture",description:"Isolated",
        date:new Date(),creatorId:accounts[1].id});
      const [reference]=await db.insert(mediaItems).values({eventId:other.id,type:"image",url:item.url,thumbnail:item.thumbnail,
        storedBytes:item.storedBytes,highBytes:item.highBytes,lowBytes:item.lowBytes}).returning();
      try{
        assert.equal((await removeGallery(f)).status,500);
        assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.id,item.id))).length,1);
        assert.equal((await db.select().from(mediaAssetVariants).where(eq(mediaAssetVariants.mediaId,item.id))).length,2);
        await readFile(path.join(fixtureRoots.r2,item.url.split("/").at(-1)));
      }finally{
        await db.delete(mediaItems).where(eq(mediaItems.id,reference.id));
        assert.equal((await storage.deleteEvent(other.id)).success,true);
      }
    }));
    await t.test("concurrent media and gallery deletion cannot duplicate cleanup or lose accounting",async()=>using({},async f=>{
      const item=await saved(f);
      const [media,gallery]=await Promise.all([remove(f,item),removeGallery(f)]);
      assert.ok([204,404].includes(media.status));assert.ok([200,404].includes(gallery.status));
      await storage.cleanupObjects();
      assert.equal((await usage()).bytes,0);
      assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.id,item.id))).length,0);
      assert.equal((await db.select().from(events).where(eq(events.id,f.gallery.id))).length,0);
    }));
    await t.test("large inventory handoff uses bounded batches and retains every byte without a provider call",async()=>using({},async f=>{
      const item=await saved(f),extra=Array.from({length:513},()=>({key:`thumb-${randomUUID()}.webp`,provider:"r2",
        state:"verified",sha256:"a".repeat(64),size:1,mime:"image/webp",objectVersion:"fixture"}));
      await db.insert(mediaObjectRoutes).values(extra);
      await db.insert(mediaAssetObjects).values(extra.map(object=>({key:object.key,eventId:f.gallery.id,
        ownerId:accounts[0].id,category:"CREATOR"})));
      const before=(await usage()).bytes,cleanup=storage.cleanupObjects,calls=native.calls.length;
      storage.cleanupObjects=async()=>{}; // Observe durable handoff before the worker runs.
      try{
        assert.equal((await removeGallery(f)).status,200);
        assert.equal((await usage()).bytes,before);assert.equal(before,item.storedBytes+513);
        assert.equal((await db.select().from(mediaCleanup)).length,515);
        assert.equal((await db.select().from(mediaAssetObjects).where(eq(mediaAssetObjects.eventId,f.gallery.id))).length,0);
        assert.equal(native.calls.length,calls);
      }finally{storage.cleanupObjects=cleanup;}
    }));
  }finally{
    await stopAnalysisWorker();if(server){server.close();await once(server,"close");}
    native.restore();restoreR2Fixture();memory.restore();
    if(accounts.length){
      await db.delete(mediaCleanup).where(inArray(mediaCleanup.creatorId,accounts.map(u=>u.id)));
      for(const account of accounts)await db.delete(betaRateLimits).where(sql`${betaRateLimits.key} like ${`%:${account.id}`}`);
      await db.delete(users).where(inArray(users.id,accounts.map(u=>u.id)));
    }
    await db.execute(sql`drop table if exists media_r2_multipart_journals`);await pool.end();
  }
});
