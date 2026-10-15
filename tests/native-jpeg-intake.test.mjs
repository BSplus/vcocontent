import "./helpers/beta-provider-preload.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {randomUUID,createHash} from "node:crypto";
import {readFile,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import sharp from "sharp";
import {eq,inArray,sql} from "drizzle-orm";
import {db,pool} from "../server/db.ts";
import {storage} from "../server/storage.ts";
import {users,events,mediaItems,mediaReservations,mediaUploadSessions as sessions,mediaAnalysisJobs,mediaAssetObjects,
  mediaAssetVariants,mediaAssetRecords,mediaCleanup,betaRateLimits}
  from "../shared/schema.ts";
import {registerRoutes} from "../server/routes.ts";
import {stopAnalysisWorker} from "../server/analysis-jobs.ts";
import {UPLOAD_PART_BYTES} from "../server/resumable-uploads.ts";
import {mediaDatabaseFingerprint} from "../server/media-storage-config.ts";
import {multipartFixture} from "./helpers/r2-multipart-fixture.mjs";
import {nativeR2HttpFixture} from "./helpers/native-r2-http-fixture.mjs";

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
  const native=nativeR2HttpFixture(fixtureRoots.r2),accounts=[];
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
        // Variant-aware application deletion is the separate P2-8 release
        // gate. Remove this exact fixture's inventory explicitly, never live.
        const items=await db.select({id:mediaItems.id}).from(mediaItems).where(eq(mediaItems.eventId,gallery.id));
        if(items.length){
          const ids=items.map(item=>item.id);
          await db.delete(mediaAssetVariants).where(inArray(mediaAssetVariants.mediaId,ids));
          await db.delete(mediaAssetRecords).where(inArray(mediaAssetRecords.mediaId,ids));
        }
        await db.delete(mediaAssetObjects).where(eq(mediaAssetObjects.eventId,gallery.id));
        const deleted=await storage.deleteEvent(gallery.id);assert.equal(deleted.success,true);
        await storage.cleanupObjects();
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
  }finally{
    await stopAnalysisWorker();if(server){server.close();await once(server,"close");}
    native.restore();restoreR2Fixture();
    if(accounts.length){
      await db.delete(mediaCleanup).where(inArray(mediaCleanup.creatorId,accounts.map(u=>u.id)));
      for(const account of accounts)await db.delete(betaRateLimits).where(sql`${betaRateLimits.key} like ${`%:${account.id}`}`);
      await db.delete(users).where(inArray(users.id,accounts.map(u=>u.id)));
    }
    await db.execute(sql`drop table if exists media_r2_multipart_journals`);await pool.end();
  }
});
