import "./helpers/beta-provider-preload.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {randomUUID,createHash} from "node:crypto";
import {readFile,rm,writeFile} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import sharp from "sharp";
import {eq,inArray,sql} from "drizzle-orm";
import {db,pool} from "../server/db.ts";
import {storage} from "../server/storage.ts";
import {users,events,mediaItems,mediaReservations,mediaCleanup,betaRateLimits,mediaUploadSessions as sessions} from "../shared/schema.ts";
import {registerRoutes} from "../server/routes.ts";
import {cleanupUploadSessions,UPLOAD_PART_BYTES} from "../server/resumable-uploads.ts";
import {stopAnalysisWorker} from "../server/analysis-jobs.ts";
import {creatorUsage} from "../server/beta-policy.ts";
import {mockMediaStorage} from "./helpers/memory-media-storage.mjs";

const hash=b=>createHash("sha256").update(b).digest("hex");
test("bounded resumable transport uses disposable DB/files and existing upload security only",{timeout:120000},async t=>{
  assert.ok(process.env.VCO_TEST_PG_PROXY && process.env.VCO_TEST_OBJECTS,"Disposable runner required");
  const store=mockMediaStorage(),accounts=[],galleries=[],ids=[];
  let server;
  process.env.MEDIA_RESUMABLE_UPLOADS_ENABLED="true";
  try{
    for(let i=0;i<3;i++){
      const [u]=await db.insert(users).values({username:`session-${i}-${randomUUID()}`,email:`${randomUUID()}@example.invalid`,
        password:"synthetic-unused",isCreator:true,isAdmin:i===2,creatorStatus:"approved",emailVerifiedAt:new Date()}).returning();
      accounts.push(u);
    }
    for(const creatorId of [accounts[0].id,null]){
      galleries.push(await storage.createEvent({title:"Resumable fixture",description:"Isolated",date:new Date(),creatorId}));
    }
    const app=express();
    app.use((req,_res,next)=>{req.user=accounts[Number(req.get("x-actor")||0)];req.isAuthenticated=()=>!!req.user;next();});
    server=await registerRoutes(app,{workers:false});server.listen(0,"127.0.0.1");await once(server,"listening");
    const base=`http://127.0.0.1:${server.address().port}`;
    const request=(url,options={},actor=0)=>fetch(base+url,{...options,headers:{"x-actor":String(actor),...options.headers}});
    const jpeg=await sharp({create:{width:64,height:32,channels:3,background:"blue"}}).jpeg().toBuffer();
    const source=Buffer.concat([jpeg,Buffer.alloc(UPLOAD_PART_BYTES+81-jpeg.length)]);
    const body=(bytes=source,extra={})=>({requestKey:randomUUID(),size:bytes.length,mime:"image/jpeg",sha256:hash(bytes),
      metadata:{type:"image",caption:"Creator-written caption",photographer:"Fixture photographer",tags:["Day"],autoTag:false},...extra});
    const init=async(b=body(),actor=0,event=galleries[0])=>{
      const r=await request(`/api/events/${event.id}/upload-sessions`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)},actor);
      const value=await r.json();
      if(r.ok){ids.push(value.id);return value;}
      return {status:r.status,...value};
    };
    const part=(s,index,bytes,actor=0,sha=hash(bytes))=>request(`/api/upload-sessions/${s.id}/parts/${index}`,{
      method:"PUT",headers:{"Content-Type":"application/octet-stream","X-Part-SHA256":sha},body:bytes},actor);
    const complete=(s,actor=0)=>request(`/api/upload-sessions/${s.id}/complete`,{method:"POST"},actor);
    const cancel=s=>request(`/api/upload-sessions/${s.id}`,{method:"DELETE"});
    await t.test("feature gate and missing additive schema leave normal uploads available",async()=>{
      process.env.MEDIA_RESUMABLE_UPLOADS_ENABLED="false";
      assert.equal((await init()).status,503);
      process.env.MEDIA_RESUMABLE_UPLOADS_ENABLED="true";
      await db.execute(sql`alter table media_upload_sessions rename to fixture_hidden_upload_sessions`);
      try{
        const policy=await (await request(`/api/media/policy?eventId=${galleries[0].id}`)).json();
        assert.equal(policy.resumableUploads,false);
        assert.equal((await init()).status,503);
      }finally{await db.execute(sql`alter table fixture_hidden_upload_sessions rename to media_upload_sessions`);}
      assert.equal((await request(`/api/events/${galleries[0].id}/upload-sessions`,{method:"POST",
        headers:{"Content-Type":"application/json","Sec-Fetch-Site":"cross-site"},body:JSON.stringify(body())})).status,403);
      assert.equal((await request(`/api/events/${galleries[0].id}/upload-sessions`,{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(body())},99)).status,401);
    });
    await t.test("same initiation key gives one reservation; keys and owner overrides rejected",async()=>{
      const b=body(),first=await init(b),again=await init(b);
      assert.equal(first.id,again.id);
      assert.equal((await init({...b,sha256:"0".repeat(64)})).status,409);
      assert.equal((await init({...body(),storageKey:"media-untrusted.jpg"})).status,400);
      const ledger=await db.select().from(mediaReservations).where(eq(mediaReservations.id,first.id));
      assert.equal(ledger.length,1);assert.equal(ledger[0].reservedBytes,source.length+100*1024);
      assert.equal((await creatorUsage(db,accounts[0].id)).reservedBytes,ledger[0].reservedBytes);
      assert.equal((await cancel(first)).status,200);
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,first.id))).length,0);
    });
    await t.test("bound to actor/gallery and current limits; no writes while disabled",async()=>{
      assert.equal((await init(body(),1)).status,403);
      assert.equal((await init(body(Buffer.alloc(5_000_001)))).status,413);
      assert.equal((await init(body(source,{mime:"video/mp4",metadata:{...body().metadata,type:"video"}}))).status,413);
      const s=await init();
      const oversized=await part(s,0,Buffer.alloc(UPLOAD_PART_BYTES+1)).catch(()=>null);
      assert.ok(!oversized || oversized.status>=400);
      assert.equal((await (await request(`/api/upload-sessions/${s.id}`)).json()).received,0);
      assert.equal((await request(`/api/upload-sessions/${s.id}`,{},1)).status,404);
      assert.equal((await part(s,0,source.subarray(0,UPLOAD_PART_BYTES),1)).status,404);
      process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";
      assert.equal((await init()).status,502);
      assert.equal((await complete(s)).status,502);
      assert.equal((await part(s,0,source.subarray(0,UPLOAD_PART_BYTES))).status,502);
      assert.equal((await request(`/api/upload-sessions/${s.id}`)).status,200);
      assert.equal((await cancel(s)).status,200);
      process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="true";
    });
    await t.test("bounded ordered parts, bad digests and immutable retries",async()=>{
      const s=await init();
      assert.equal((await complete(s)).status,409);
      assert.equal((await part(s,2,Buffer.from("extra"))).status,400);
      assert.equal((await part(s,1,source.subarray(UPLOAD_PART_BYTES))).status,409);
      assert.equal((await part(s,0,source.subarray(0,UPLOAD_PART_BYTES),0,"0".repeat(64))).status,409);
      const chunk=source.subarray(0,UPLOAD_PART_BYTES);
      assert.equal((await part(s,0,chunk)).status,200);
      assert.equal((await part(s,0,chunk)).status,200);
      assert.equal((await part(s,0,Buffer.alloc(chunk.length,7))).status,409);
      const status=await (await request(`/api/upload-sessions/${s.id}`)).json();
      assert.equal(status.received,1);assert.equal(status.uploadedBytes,chunk.length);
      assert.equal((await cancel(s)).status,200);
      assert.equal((await part(s,1,source.subarray(UPLOAD_PART_BYTES))).status,410);
    });
    await t.test("one commit, preserved original/manual text, lost-reply recovery and concurrent completion",async()=>{
      const b=body(),s=await init(b);
      await part(s,0,source.subarray(0,UPLOAD_PART_BYTES));
      await part(s,1,source.subarray(UPLOAD_PART_BYTES));
      const completions=await Promise.all([complete(s),complete(s)]);
      assert.ok(completions.every(r=>[200,202].includes(r.status)));
      const done=await (await complete(s)).json();
      assert.equal(done.state,"completed");assert.equal(done.item.caption,"Creator-written caption");
      assert.deepEqual(done.item.manualTags,["Day"]);
      assert.equal(hash(store.objects.get(done.item.url.split("/").at(-1))),hash(source));
      const retry=await init(b);assert.equal(retry.mediaId,done.mediaId);
      assert.equal((await request(`/api/events/${galleries[0].id}/upload-sessions/by-request/${b.requestKey}`)).status,200);
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,s.id))).length,0);
      assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.id,done.mediaId))).length,1);
      assert.equal((await cancel(s)).status,409);
      process.env.MEDIA_RESUMABLE_UPLOADS_ENABLED="false";
      assert.equal((await request(`/api/upload-sessions/${s.id}`)).status,200);
      process.env.MEDIA_RESUMABLE_UPLOADS_ENABLED="true";
    });
    await t.test("tampered or missing staged bytes cannot publish; expired parts are removed before release",async()=>{
      const s=await init();
      await part(s,0,source.subarray(0,UPLOAD_PART_BYTES));
      await part(s,1,source.subarray(UPLOAD_PART_BYTES));
      await writeFile(path.join(tmpdir(),"vco-upload-sessions",s.id,"0.part"),Buffer.alloc(UPLOAD_PART_BYTES));
      assert.equal((await complete(s)).status,409);
      assert.equal((await (await request(`/api/upload-sessions/${s.id}`)).json()).state,"failed");
      const missing=await init();
      await part(missing,0,source.subarray(0,UPLOAD_PART_BYTES));
      await part(missing,1,source.subarray(UPLOAD_PART_BYTES));
      await rm(path.join(tmpdir(),"vco-upload-sessions",missing.id,"0.part"));
      assert.equal((await complete(missing)).status,502);
      const expired=await init();
      await part(expired,0,source.subarray(0,UPLOAD_PART_BYTES));
      await db.update(sessions).set({expiresAt:new Date(0)}).where(eq(sessions.id,expired.id));
      assert.equal((await part(expired,1,source.subarray(UPLOAD_PART_BYTES))).status,410);
      await cleanupUploadSessions();
      await assert.rejects(readFile(path.join(tmpdir(),"vco-upload-sessions",expired.id,"0.part")),/ENOENT/);
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,expired.id))).length,0);
    });
    await t.test("permission and quota are rechecked at completion; account session slots stay bounded",async()=>{
      const first=await init(),second=await init();
      assert.equal((await init()).status,429);
      await cancel(second);
      await part(first,0,source.subarray(0,UPLOAD_PART_BYTES));
      await part(first,1,source.subarray(UPLOAD_PART_BYTES));
      await db.update(events).set({creatorId:accounts[1].id}).where(eq(events.id,galleries[0].id));
      assert.equal((await complete(first)).status,403);
      assert.equal((await cancel(first)).status,200,"Initiating actor may still release their own abandoned session");
      await db.update(events).set({creatorId:accounts[0].id}).where(eq(events.id,galleries[0].id));
      const s=await init();
      await part(s,0,source.subarray(0,UPLOAD_PART_BYTES));await part(s,1,source.subarray(UPLOAD_PART_BYTES));
      const filler=await storage.createMediaItem({eventId:galleries[0].id,type:"image",url:"data:image/jpeg;base64,YQ==",
        thumbnail:"data:image/jpeg;base64,Yg==",highBytes:500_000_001,lowBytes:1,storedBytes:500_000_002});
      // Distinct physical inline source sizes are decoded, not trusted highBytes.
      const key=`media-${randomUUID()}.jpg`;
      await db.update(mediaItems).set({url:`/api/media/files/${key}`}).where(eq(mediaItems.id,filler.id));
      assert.equal((await complete(s)).status,413);
      await storage.deleteMediaItem(filler.id);
      await storage.cleanupObjects(); // retained pending deletions still consume the allowance
    });
    await t.test("stale finalizers keep accounted reservations until safe reconciliation",async()=>{
      const {spawn}=await import("node:child_process");
      const worker=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
      await once(worker,"spawn");
      let stale;
      try{
        stale=await init();assert.ok(stale.id,JSON.stringify(stale));
        await part(stale,0,source.subarray(0,UPLOAD_PART_BYTES));
        await db.update(sessions).set({state:"finalizing",workerPid:worker.pid,expiresAt:new Date(0)}).where(eq(sessions.id,stale.id));
        await db.update(mediaReservations).set({createdAt:new Date(0)}).where(eq(mediaReservations.id,stale.id));
        assert.equal(worker.exitCode,null);
        await storage.cleanupObjects();
        assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,stale.id))).length,1,
          "Generic cleanup must defer all session-owned reservations");
        await cleanupUploadSessions();
        assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,stale.id))).length,1,
          "A live finalizer must retain its reservation");
      }finally{worker.kill("SIGTERM");await once(worker,"exit");}
      await cleanupUploadSessions();
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,stale.id))).length,0);
      await assert.rejects(readFile(path.join(tmpdir(),"vco-upload-sessions",stale.id,"0.part")),/ENOENT/);
    });
    await t.test("non-JPEG output-key changes remain covered by failure cleanup",async()=>{
      const gif=Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7","base64");
      const s=await init(body(gif,{mime:"image/gif"}),2,galleries[1]);
      assert.ok(s.id,JSON.stringify(s));
      assert.equal((await part(s,0,gif,2)).status,200);
      const before=store.writes.length;
      store.failKey=key=>key.startsWith("thumb-");
      try{assert.equal((await complete(s,2)).status,502);}
      finally{store.failKey=null;}
      const written=store.writes.slice(before);
      assert.ok(written[0]?.endsWith(".gif"),"Fixture must exercise a source-extension change before a partial write");
      await storage.cleanupObjects();
      for(const key of written)assert.equal(store.objects.has(key),false,"No renamed source object may escape cleanup");
    });
    await t.test("official video and photo finalize through existing private R2 routes",async()=>{
      const {fixtureRoots,restoreR2Fixture}=await import("./helpers/r2-cli-preload.mjs");
      const {mediaDatabaseFingerprint}=await import("../server/media-storage-config.ts");
      const {execFile}=await import("node:child_process"),{promisify}=await import("node:util");
      const {mediaObjectRoutes}=await import("../shared/schema.ts");
      Object.assign(process.env,{MEDIA_STORAGE_PROVIDER:"r2",MEDIA_STORAGE_ROUTING:"enabled",
        MEDIA_STORAGE_DATABASE_FINGERPRINT:mediaDatabaseFingerprint(process.env.DATABASE_URL),
        R2_ACCOUNT_ID:"a".repeat(32),R2_BUCKET:"vco-fixture-test",R2_JURISDICTION:"eu",R2_STORAGE_CLASS:"Standard",
        R2_DEV_ACCESS_KEY_ID:"synthetic",R2_DEV_SECRET_ACCESS_KEY:"synthetic"});
      try{
        const filename=path.join(fixtureRoots.replit,`session-${randomUUID()}.mp4`);
        await promisify(execFile)("ffmpeg",["-y","-f","lavfi","-i","testsrc2=size=160x120:rate=5","-t","1","-c:v","libx264","-pix_fmt","yuv420p",filename]);
        const clip=await readFile(filename);await rm(filename);
        for(const [bytes,mime,type] of [[jpeg,"image/jpeg","image"],[clip,"video/mp4","video"]]){
          const s=await init(body(bytes,{mime,metadata:{...body().metadata,type}}),2,galleries[1]);
          assert.equal((await part(s,0,bytes,2)).status,200);
          const done=await (await complete(s,2)).json();assert.equal(done.state,"completed");
          await stopAnalysisWorker();
          const key=done.item.url.split("/").at(-1);
          assert.deepEqual(await readFile(path.join(fixtureRoots.r2,key)),bytes);
          await assert.rejects(readFile(path.join(fixtureRoots.replit,key)),/ENOENT/);
          const [route]=await db.select().from(mediaObjectRoutes).where(eq(mediaObjectRoutes.key,key));
          assert.equal(route.provider,"r2");assert.equal(route.state,"verified");assert.equal(route.sha256,hash(bytes));
          const original=await request(done.item.url,{},2);
          assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
          if(type==="video"){
            const range=await request(done.item.url,{headers:{Range:"bytes=0-63"}},2);
            assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(0,64));
          }
          const current=await storage.getMediaItem(done.mediaId);
          assert.equal((await request(current.thumbnail)).status,200);
          await storage.deleteMediaItem(done.mediaId);await storage.cleanupObjects();
          await assert.rejects(readFile(path.join(fixtureRoots.r2,key)),/ENOENT/);
        }
      }finally{
        await stopAnalysisWorker();
        for(const item of await storage.getMediaItems(galleries[1].id))await storage.deleteMediaItem(item.id);
        await storage.cleanupObjects();
        restoreR2Fixture();process.env.MEDIA_STORAGE_ROUTING="disabled";process.env.MEDIA_STORAGE_PROVIDER="replit";
      }
    });
  }finally{
    await stopAnalysisWorker();
    if(server){server.close();await once(server,"close");}
    for(const id of new Set(ids)){
      await rm(path.join(tmpdir(),"vco-upload-sessions",id),{recursive:true,force:true});
      await storage.abandonMedia(id);
    }
    await db.delete(sessions).where(inArray(sessions.actorId,accounts.map(u=>u.id)));
    for(const gallery of galleries)await storage.deleteEvent(gallery.id);
    await storage.cleanupObjects();
    await db.delete(mediaCleanup).where(inArray(mediaCleanup.creatorId,accounts.map(u=>u.id)));
    for(const u of accounts)await db.delete(betaRateLimits).where(sql`${betaRateLimits.key} like ${`%:${u.id}`}`);
    await db.delete(users).where(inArray(users.id,accounts.map(u=>u.id)));
    store.restore();await pool.end();
  }
});
