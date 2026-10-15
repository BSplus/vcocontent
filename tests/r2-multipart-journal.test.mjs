import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {rm,mkdir,rename,readFile,writeFile,stat} from "node:fs/promises";
import path from "node:path";

test("native multipart PostgreSQL journal uses a disposable database only",{
  skip:!process.env.VCO_TEST_PG_PROXY||!process.env.VCO_TEST_OBJECTS,timeout:90000,
},async t=>{
  assert.equal(new URL(process.env.DATABASE_URL).hostname,"127.0.0.1");
  await import("./helpers/beta-provider-preload.mjs");
  const {db,pool}=await import("../server/db.ts");
  const {storage}=await import("../server/storage.ts");
  const {users,events,mediaReservations,mediaUploadSessions:sessions,mediaCleanup,
    mediaItems,mediaAssetVariants,mediaAssetObjects,mediaAssetRecords,mediaObjectRoutes:routes,mediaAnalysisJobs}=
    await import("../shared/schema.ts");
  const {r2MultipartJournals:journals}=await import("../shared/r2-multipart-schema.ts");
  const {databaseMultipartContext}=await import("../server/r2-multipart-journal.ts");
  const {uploadR2MultipartFile,cancelR2Multipart,multipartPlanBinding}=await import("../server/r2-multipart-upload.ts");
  const {multipartFixture}=await import("./helpers/r2-multipart-fixture.mjs");
  const {mediaDatabaseFingerprint}=await import("../server/media-storage-config.ts");
  const {creatorUsage}=await import("../server/beta-policy.ts");
  const {registerValidatedMultipart,cleanupMultipartStaging}=await import("../server/r2-multipart-lifecycle.ts");
  const {uploadSessionDirectory}=await import("../server/upload-session-staging.ts");
  const {cleanupUploadSessions}=await import("../server/resumable-uploads.ts");
  const {prepareMultipartJpeg}=await import("../server/r2-multipart-jpeg.ts");
  const {createMediaKeys}=await import("../server/media-storage.ts");
  const {default:sharp}=await import("sharp");
  const {eq,inArray,sql}=await import("drizzle-orm");
  assert.equal((await pool.query("select to_regclass('media_r2_multipart_journals') as name")).rows[0].name,null);
  // Test-only DDL. This schema is NOT part of the connected app schema entry.
  await db.execute(sql`create table media_r2_multipart_journals (
    session_id text primary key references media_upload_sessions(id) on delete restrict,
    reservation_id text not null unique references media_reservations(id) on delete restrict,
    scope text not null check(scope ~ '^[a-f0-9]{64}$'),
    object_key text not null, binding text not null check(binding ~ '^[a-f0-9]{64}$'),
    revision integer not null default 0 check(revision >= 0), checkpoint jsonb,
    updated_at timestamptz not null default now(),
    unique(scope,object_key),check(session_id=reservation_id),
    check(checkpoint is null or jsonb_typeof(checkpoint)='object'))`);
  const accounts=await db.insert(users).values([false,false,true].map(isAdmin=>({
    username:`multipart-${randomUUID()}`,email:`${randomUUID()}@example.invalid`,password:"unused-fixture",
    isCreator:true,isAdmin,creatorStatus:"approved",emailVerifiedAt:new Date(),
  }))).returning();
  const isCode=code=>error=>error.code===code;
  const using=async(options,work)=>{
    const f=await multipartFixture(options.size??1048576);
    let gallery;
    try{
      [gallery]=await db.insert(events).values({title:"Private multipart fixture",description:"Isolated",
        date:new Date(),creatorId:options.official?null:accounts[0].id}).returning();
      f.env.DATABASE_URL=process.env.DATABASE_URL;
      f.env.MEDIA_STORAGE_DATABASE_FINGERPRINT=mediaDatabaseFingerprint(process.env.DATABASE_URL);
      Object.assign(f.plan,{
        actorId:accounts[options.admin?2:0].id,eventId:gallery.id,
        owner:{kind:options.official?"official":"creator",creatorId:gallery.creatorId,revision:randomUUID()},
        key:options.key??f.plan.key.replace(/mp4$/,"jpg"),mime:options.video?"video/mp4":"image/jpeg",
      });
      if(options.video)f.plan.key=f.plan.key.replace(/jpg$/,"mp4");
      if(!options.video&&!options.key)f.plan.key=createMediaKeys("image/jpeg",
        gallery.creatorId===null?"official":"creator-original").storageKey;
      const directory=uploadSessionDirectory(f.plan.sessionId);
      await mkdir(directory,{recursive:true});
      const local=path.join(directory,"assembled-source");
      await rename(f.source,local);f.source=local;
      if(options.realPhoto){
        const jpeg=await sharp({create:{width:96,height:48,channels:3,background:"blue"}})
          .withMetadata({orientation:6}).jpeg().toBuffer();
        const source=Buffer.concat([jpeg,Buffer.alloc(f.plan.size-jpeg.length)]);
        await writeFile(f.source,source);
        f.plan.sha256=createHash("sha256").update(source).digest("hex");
      }
      f.thumbnailKey=`thumb-${randomUUID()}.webp`;
      await storage.reserveMedia(f.plan.sessionId,gallery.id,gallery.creatorId,f.plan.size+102400,
        f.plan.key,f.thumbnailKey,options.admin??false);
      await db.insert(sessions).values({id:f.plan.sessionId,actorId:f.plan.actorId,eventId:gallery.id,
        ownerId:gallery.creatorId,requestKey:randomUUID(),requestFingerprint:f.plan.owner.revision,
        size:f.plan.size,mime:f.plan.mime,sha256:f.plan.sha256,metadata:{},state:"finalizing",
        expiresAt:new Date(f.plan.expiresAt)});
      // Simulated output of the existing validated thumbnail pipeline. Native
      // lifecycle does not replace the actual content/derivative processors.
      if(!options.realPhoto)await db.insert(routes).values({key:f.thumbnailKey,provider:"r2",state:"verified",size:100,
        sha256:"a".repeat(64),objectVersion:'"fixture-thumb"',mime:"image/webp"});
      f.ctx=()=>databaseMultipartContext(f.plan,f.context().driver);
      f.send=()=>uploadR2MultipartFile(f.plan,f.source,f.ctx());
      f.read=async()=>(await db.select().from(journals).where(eq(journals.sessionId,f.plan.sessionId)))[0];
      f.intent=()=>({binding:multipartPlanBinding(f.plan,f.context().driver),phase:"initiating",parts:[]});
      f.media=()=>({eventId:f.plan.eventId,type:f.plan.mime.startsWith("image/")?"image":"video",
        url:`/api/media/files/${f.plan.key}`,thumbnail:`/api/media/files/${f.thumbnailKey}`,
        highBytes:f.plan.size,lowBytes:100,storedBytes:f.plan.size+100,objectCount:2,isPremium:false,
        caption:"Creator-edited caption",photographer:"Fixture credit",tags:["Day"]});
      f.register=(input=f.media(),analysis=false)=>registerValidatedMultipart(f.plan,input,f.driver(),analysis);
      f.cleanup=()=>cleanupMultipartStaging(f.plan,f.driver());
      await work(f);
    }finally{
      await db.delete(journals).where(eq(journals.sessionId,f.plan.sessionId));
      if(gallery){
        const items=await db.select({id:mediaItems.id}).from(mediaItems).where(eq(mediaItems.eventId,gallery.id));
        const ids=items.map(item=>item.id);
        if(ids.length){
          await db.delete(mediaAssetVariants).where(inArray(mediaAssetVariants.mediaId,ids));
          await db.delete(mediaAssetRecords).where(inArray(mediaAssetRecords.mediaId,ids));
          await db.delete(mediaAnalysisJobs).where(inArray(mediaAnalysisJobs.mediaId,ids));
        }
        await db.delete(mediaAssetObjects).where(eq(mediaAssetObjects.eventId,gallery.id));
        await db.delete(mediaItems).where(eq(mediaItems.eventId,gallery.id));
      }
      await db.delete(routes).where(inArray(routes.key,[f.plan.key,f.thumbnailKey??"no-fixture"]));
      await db.delete(sessions).where(eq(sessions.id,f.plan.sessionId));
      await db.delete(mediaReservations).where(eq(mediaReservations.id,f.plan.sessionId));
      if(gallery)await db.delete(events).where(eq(events.id,gallery.id));
      await rm(uploadSessionDirectory(f.plan.sessionId),{recursive:true,force:true});
      await f.close();
    }
  };
  try{
    await t.test("verified bytes and fresh-engine replay retain one original reservation",async()=>using({},async f=>{
      const result=await f.send();
      assert.equal(result.sha256,f.plan.sha256);
      assert.equal((await f.read()).checkpoint.phase,"verified");
      await rm(f.source);
      f.env.MEDIA_R2_MULTIPART_ENABLED="false";f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";
      assert.deepEqual(await f.send(),result);
      assert.equal(f.state.calls.filter(c=>c==="CreateMultipartUploadCommand").length,1);
      const usage=await creatorUsage(db,accounts[0].id);
      assert.equal(usage.reservedBytes,f.plan.size+102400);
      assert.equal(usage.retainedBytes,0);
    }));
    await t.test("independent connections exclude concurrent session and destination writers",async()=>using({},async f=>{
      let release,entered;
      const ready=new Promise(resolve=>{entered=resolve;});
      const hold=new Promise(resolve=>{release=resolve;});
      const ctx=f.ctx();
      const first=ctx.journal.exclusive(ctx.driver.scope,f.plan.key,f.plan.sessionId,async(_raw,save)=>{
        await save(f.intent());entered();await hold;
      });
      try{
        await ready;
        const second=f.ctx();
        await assert.rejects(second.journal.exclusive(second.driver.scope,f.plan.key,f.plan.sessionId,async()=>{}),isCode("busy"));
        await using({key:f.plan.key},async other=>{
          const next=other.ctx();
          await assert.rejects(next.journal.exclusive(next.driver.scope,other.plan.key,other.plan.sessionId,async()=>{}),isCode("busy"));
        });
      }finally{release();await first;}
      await using({key:f.plan.key},async other=>{
        const next=other.ctx();
        await assert.rejects(next.journal.exclusive(next.driver.scope,other.plan.key,other.plan.sessionId,async()=>{}),isCode("conflict"));
      });
    }));
    await t.test("a real killed process leaves committed write intent and releases its database lease",async()=>using({},async f=>{
      const scope=f.context().driver.scope;
      const script=`
        await import("./tests/helpers/beta-provider-preload.mjs");
        const {databaseMultipartContext}=await import("./server/r2-multipart-journal.ts");
        const {multipartPlanBinding}=await import("./server/r2-multipart-upload.ts");
        const plan=JSON.parse(process.env.VCO_MULTIPART_FIXTURE_PLAN);
        const driver={scope:process.env.VCO_MULTIPART_FIXTURE_SCOPE,validate(){},writable(){}};
        const ctx=databaseMultipartContext(plan,driver);
        await ctx.journal.exclusive(driver.scope,plan.key,plan.sessionId,async(_raw,save)=>{
          await save({binding:multipartPlanBinding(plan,driver),phase:"initiating",parts:[]});
          process.kill(process.pid,"SIGKILL");
        });
      `;
      await assert.rejects(promisify(execFile)(process.execPath,["--import","tsx","--input-type=module","-e",script],{
        env:{...process.env,VCO_MULTIPART_FIXTURE_PLAN:JSON.stringify(f.plan),VCO_MULTIPART_FIXTURE_SCOPE:scope},
        timeout:15000,
      }),error=>error.signal==="SIGKILL");
      assert.equal((await f.read()).checkpoint.phase,"initiating");
      for(let attempt=0;;attempt++){
        try{await f.send();assert.fail("Unknown initiation cannot be replayed");}
        catch(error){
          if(error.code==="busy"&&attempt<30){await new Promise(r=>setTimeout(r,30));continue;}
          assert.equal(error.code,"uncertain");break;
        }
      }
      assert.equal(f.state.calls.length,0);
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,f.plan.sessionId))).length,1);
    }));
    await t.test("lost provider response cannot be abandoned by legacy cleanup or free quota",async()=>using({},async f=>{
      f.state.after=async name=>{if(name==="CreateMultipartUploadCommand")throw Error("lost fixture reply");};
      await assert.rejects(f.send());
      assert.equal(f.state.uploads.size,1);
      assert.equal((await f.read()).checkpoint.phase,"initiating");
      await assert.rejects(storage.abandonMedia(f.plan.sessionId));
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,f.plan.sessionId))).length,1);
      assert.equal((await db.select().from(mediaCleanup).where(eq(mediaCleanup.key,f.plan.key))).length,0);
      f.state.after=undefined;
      await assert.rejects(f.send(),isCode("uncertain"));
      assert.equal(f.state.uploads.size,1);
    }));
    await t.test("lost part response resumes from PostgreSQL without retransmission",async()=>using({},async f=>{
      f.state.after=async name=>{if(name==="UploadPartCommand")throw Error("lost part reply");};
      await assert.rejects(f.send());
      assert.equal((await f.read()).checkpoint.phase,"uploading");
      assert.equal((await f.read()).checkpoint.parts.length,0);
      f.state.after=undefined;
      await f.send();
      assert.deepEqual(f.state.writes,[1]);
      assert.equal((await f.read()).checkpoint.phase,"verified");
    }));
    await t.test("lost completion recovers without local bytes or open upload gates",async()=>using({},async f=>{
      f.state.after=async name=>{if(name==="CompleteMultipartUploadCommand")throw Error("lost complete reply");};
      await assert.rejects(f.send());
      assert.equal((await f.read()).checkpoint.phase,"completing");
      await rm(f.source);f.state.after=undefined;
      f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";f.env.MEDIA_R2_MULTIPART_ENABLED="false";
      await f.send();
      assert.equal(f.state.calls.filter(c=>c==="CompleteMultipartUploadCommand").length,1);
      assert.equal((await f.read()).checkpoint.phase,"verified");
    }));
    await t.test("known provider abort works with closed gates; staging capacity remains held",async()=>using({},async f=>{
      f.state.after=async name=>{if(name==="UploadPartCommand")throw Error("pause");};
      await assert.rejects(f.send());f.state.after=undefined;
      f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";f.env.MEDIA_R2_MULTIPART_ENABLED="false";
      await cancelR2Multipart(f.plan,f.ctx());
      assert.equal((await f.read()).checkpoint.phase,"aborted");
      assert.equal(f.state.uploads.size,0);
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,f.plan.sessionId))).length,1);
    }));
    await t.test("ownership, actor and server-created session revision are freshly enforced",async()=>using({},async f=>{
      const ctx=f.ctx();
      await ctx.journal.exclusive(ctx.driver.scope,f.plan.key,f.plan.sessionId,async(_raw,save)=>{
        await save(f.intent());
        await db.update(events).set({creatorId:accounts[1].id}).where(eq(events.id,f.plan.eventId));
        await assert.rejects(ctx.authorize(f.plan,"upload"),isCode("denied"));
      });
      await assert.rejects(f.send(),isCode("denied"));
      assert.equal(f.state.calls.length,0);
      await db.update(events).set({creatorId:accounts[0].id}).where(eq(events.id,f.plan.eventId));
      const wrong={...f.plan,actorId:accounts[1].id};
      const other=databaseMultipartContext(wrong,f.context().driver);
      await assert.rejects(uploadR2MultipartFile(wrong,f.source,other),isCode("conflict"));
      await db.update(sessions).set({requestFingerprint:"changed-server-revision"}).where(eq(sessions.id,f.plan.sessionId));
      await assert.rejects(f.send(),isCode("denied"));
    }));
    await t.test("admin-to-Creator uploads still charge the Creator and enforce capacity",async()=>using({admin:true},async f=>{
      await f.send();
      assert.equal((await creatorUsage(db,accounts[0].id)).reservedBytes,f.plan.size+102400);
      await db.update(mediaReservations).set({reservedBytes:10_000_000_000}).where(eq(mediaReservations.id,f.plan.sessionId));
      await db.update(users).set({isAdmin:true}).where(eq(users.id,accounts[0].id));
      try{
        const ctx=f.ctx();
        await assert.rejects(ctx.journal.exclusive(ctx.driver.scope,f.plan.key,f.plan.sessionId,
          async()=>ctx.authorize(f.plan,"upload")));
      }finally{await db.update(users).set({isAdmin:false}).where(eq(users.id,accounts[0].id));}
      assert.equal((await f.read()).checkpoint.phase,"verified");
    }));
    await t.test("closed gates create no journal and no-intent cancellation stays read-only",async()=>using({},async f=>{
      f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";f.env.MEDIA_R2_MULTIPART_ENABLED="false";
      await assert.rejects(f.send(),isCode("configuration"));
      await cancelR2Multipart(f.plan,f.ctx());
      assert.equal(await f.read(),undefined);
      assert.equal(f.state.calls.length,0);
    }));
    await t.test("current limits and Creator video prohibition remain unchanged",async()=>{
      await using({video:true},async f=>{
        await assert.rejects(f.send(),isCode("denied"));assert.equal(f.state.calls.length,0);
      });
      await using({size:6*1048576},async f=>{
        await assert.rejects(f.send(),isCode("denied"));assert.equal(f.state.calls.length,0);
      });
      await using({official:true,admin:true,video:true},async f=>assert.equal((await f.send()).size,f.plan.size));
    });
    await t.test("checkpoint CAS rejects stale writers and illegal phase rollback",async()=>using({},async f=>{
      const ctx=f.ctx();
      await assert.rejects(ctx.journal.exclusive(ctx.driver.scope,f.plan.key,f.plan.sessionId,async(_raw,save)=>{
        const intent=f.intent();await save(intent);
        await assert.rejects(save({...intent,phase:"aborted"}),isCode("conflict"));
        await db.update(journals).set({revision:100}).where(eq(journals.sessionId,f.plan.sessionId));
        await save(intent);
      }),isCode("lease_lost"));
      assert.equal(ctx.signal.aborted,true);
      assert.equal((await f.read()).revision,100);
    }));
    await t.test("changing immutable journal bindings fences an already-running writer",async()=>using({},async f=>{
      const ctx=f.ctx();
      await assert.rejects(ctx.journal.exclusive(ctx.driver.scope,f.plan.key,f.plan.sessionId,async(_raw,save)=>{
        await save(f.intent());
        await db.update(journals).set({binding:"e".repeat(64)}).where(eq(journals.sessionId,f.plan.sessionId));
        await save(f.intent());
      }),isCode("lease_lost"));
      assert.equal((await f.read()).checkpoint.phase,"initiating");
      assert.equal(f.state.calls.length,0);
    }));
    await t.test("a stalled checkpoint query has a bounded deadline and cannot start a provider write",async()=>using({},async f=>{
      await db.execute(sql`create function multipart_fixture_wait() returns trigger language plpgsql as $$
        begin perform pg_sleep(12); return new; end $$`);
      await db.execute(sql`create trigger multipart_fixture_wait before insert on media_r2_multipart_journals
        for each row execute function multipart_fixture_wait()`);
      try{
        const start=performance.now();
        await assert.rejects(f.send(),error=>["unavailable","lease_lost"].includes(error.code));
        assert.ok(performance.now()-start<10000,"Checkpoint deadline must not wait for the full stalled statement");
        assert.equal(f.state.calls.filter(name=>["CreateMultipartUploadCommand","UploadPartCommand",
          "CompleteMultipartUploadCommand"].includes(name)).length,0);
        assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,f.plan.sessionId))).length,1);
      }finally{
        await db.execute(sql`drop trigger multipart_fixture_wait on media_r2_multipart_journals`);
        await db.execute(sql`drop function multipart_fixture_wait()`);
      }
    }));
    await t.test("terminated PostgreSQL lease aborts the worker instead of allowing further provider writes",async()=>using({},async f=>{
      const ctx=f.ctx();
      await assert.rejects(ctx.journal.exclusive(ctx.driver.scope,f.plan.key,f.plan.sessionId,async(_raw,save)=>{
        await save(f.intent());
        const aborted=new Promise(resolve=>ctx.signal.addEventListener("abort",resolve,{once:true}));
        const {rows}=await pool.query("select pid from pg_stat_activity where application_name='vco-r2-multipart-journal' and datname=current_database()");
        assert.equal(rows.length,1);
        await pool.query("select pg_terminate_backend($1)",[rows[0].pid]);
        await aborted;
        await save(f.intent());
      }),isCode("lease_lost"));
      assert.equal(f.state.calls.length,0);
      assert.equal((await f.read()).checkpoint.phase,"initiating");
    }));
    await t.test("atomic registration transfers reservation to retained bytes and admits analysis only once",async()=>using({},async f=>{
      await f.send();
      const item=await f.register(f.media(),true);
      assert.equal(item.caption,"Creator-edited caption");assert.deepEqual(item.manualTags,["Day"]);
      assert.equal(item.photographer,"Fixture credit");assert.equal(item.safetyStatus,"error");
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,f.plan.sessionId))).length,0);
      assert.equal(await f.read(),undefined);
      const usage=await creatorUsage(db,accounts[0].id);
      assert.equal(usage.retainedBytes,f.plan.size+100);assert.equal(usage.reservedBytes,0);
      const jobs=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,item.id));
      assert.equal(jobs.length,1);
      f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";f.env.MEDIA_R2_MULTIPART_ENABLED="false";
      assert.equal((await f.register(f.media(),true)).id,item.id);
      assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,item.id))).length,1);
      assert.equal(await f.cleanup(),"registered");await assert.rejects(stat(f.source),e=>e.code==="ENOENT");
      assert.ok(f.state.objects.has(f.plan.key),"Staging cleanup must not delete a committed R2 object");
      assert.equal(await f.cleanup(),"registered");
    }));
    await t.test("source and generated thumbnail count once with their asset relationship",async()=>using({},async f=>{
      await f.send();
      await db.insert(routes).values({key:f.thumbnailKey,provider:"r2",state:"verified",size:100,
        sha256:"a".repeat(64),objectVersion:'"fixture-thumb"',mime:"image/webp"}).onConflictDoNothing();
      const media={...f.media(),thumbnail:`/api/media/files/${f.thumbnailKey}`,
        storedBytes:f.plan.size+100,lowBytes:100,objectCount:2};
      const item=await f.register(media);
      const variants=await db.select().from(mediaAssetVariants).where(eq(mediaAssetVariants.mediaId,item.id));
      assert.equal(variants.length,2);
      assert.equal(variants.find(v=>v.purpose==="thumbnail").sourceKey,f.plan.key);
      assert.equal((await creatorUsage(db,accounts[0].id)).retainedBytes,f.plan.size+100);
    }));
    await t.test("transaction failure after journal unpin rolls back media, route and reservation handoff",async()=>using({},async f=>{
      await f.send();
      const finish=storage.finishMedia;
      storage.finishMedia=function(...args){
        const hook=args[7];
        args[7]=async(tx,item)=>{await hook(tx,item);throw Error("fixture rollback after unpin");};
        return finish.apply(this,args);
      };
      try{await assert.rejects(f.register(f.media(),true));}finally{storage.finishMedia=finish;}
      assert.equal((await f.read()).checkpoint.phase,"verified");
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,f.plan.sessionId))).length,1);
      assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.eventId,f.plan.eventId))).length,0);
      assert.equal((await db.select().from(routes).where(eq(routes.key,f.plan.key))).length,0);
      await f.register();
    }));
    await t.test("lost database completion reply recovers the committed asset without duplicate registration",async()=>using({},async f=>{
      await f.send();
      const finish=storage.finishMedia;
      let calls=0;
      storage.finishMedia=async function(...args){calls++;await finish.apply(this,args);throw Error("lost fixture commit reply");};
      try{await assert.rejects(f.register(f.media(),true));}finally{storage.finishMedia=finish;}
      const saved=await f.register(f.media(),true);
      assert.equal(calls,1);
      assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.eventId,f.plan.eventId))).length,1);
      assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,saved.id))).length,1);
    }));
    await t.test("invalid routing or byte totals never release the verified reservation",async()=>using({},async f=>{
      await f.send();
      await assert.rejects(f.register({...f.media(),storedBytes:f.plan.size-1}),isCode("conflict"));
      await db.insert(routes).values({key:f.plan.key,provider:"r2",state:"verified",size:f.plan.size,
        sha256:"c".repeat(64),objectVersion:'"wrong-source"',mime:f.plan.mime});
      await assert.rejects(f.register(),isCode("conflict"));
      assert.equal((await f.read()).checkpoint.phase,"verified");
      assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.eventId,f.plan.eventId))).length,0);
    }));
    await t.test("known abort removes actual staging before releasing capacity; replay is read-only",async()=>using({},async f=>{
      f.state.after=async name=>{if(name==="UploadPartCommand")throw Error("pause");};
      await assert.rejects(f.send());f.state.after=undefined;
      await cancelR2Multipart(f.plan,f.ctx());
      f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";f.env.MEDIA_R2_MULTIPART_ENABLED="false";
      assert.equal(await f.cleanup(),"released");
      await assert.rejects(stat(f.source),e=>e.code==="ENOENT");
      assert.equal((await creatorUsage(db,accounts[0].id)).reservedBytes,0);
      assert.equal((await f.cleanup()),"released");
      assert.equal(await f.read(),undefined);
      await assert.rejects(f.register(),isCode("closed"));
    }));
    await t.test("uncertain outcomes cannot delete staging or release quota",async()=>using({},async f=>{
      f.state.after=async name=>{if(name==="CreateMultipartUploadCommand")throw Error("lost reply");};
      await assert.rejects(f.send());f.state.after=undefined;
      await assert.rejects(f.cleanup(),isCode("uncertain"));
      assert.equal((await stat(f.source)).size,f.plan.size);
      assert.equal((await f.read()).checkpoint.phase,"initiating");
      assert.equal((await creatorUsage(db,accounts[0].id)).reservedBytes,f.plan.size+102400);
    }));
    await t.test("legacy expiry cleanup preserves native source files and reservations",async()=>using({},async f=>{
      const ctx=f.ctx();
      await ctx.journal.exclusive(ctx.driver.scope,f.plan.key,f.plan.sessionId,async(_raw,save)=>save(f.intent()));
      await db.update(sessions).set({expiresAt:new Date(Date.now()-1000),workerPid:null}).where(eq(sessions.id,f.plan.sessionId));
      await cleanupUploadSessions();
      assert.equal((await stat(f.source)).size,f.plan.size);
      assert.equal((await f.read()).checkpoint.phase,"initiating");
      assert.equal((await db.select().from(sessions).where(eq(sessions.id,f.plan.sessionId)))[0].state,"finalizing");
    }));
    await t.test("legacy cleanup also respects native terminal receipts after journal handoff",async()=>using({},async f=>{
      await f.send();await f.register();
      assert.equal(await f.read(),undefined);
      await db.update(sessions).set({expiresAt:new Date(Date.now()-1000)}).where(eq(sessions.id,f.plan.sessionId));
      await cleanupUploadSessions();
      assert.equal((await stat(f.source)).size,f.plan.size);
      assert.equal((await db.select().from(sessions).where(eq(sessions.id,f.plan.sessionId)))[0].cleanedAt,null);
    }));
    await t.test("first intent insertion and legacy expiry cannot race staging deletion",async()=>using({},async f=>{
      f.plan.expiresAt=Date.now()+2000;
      await db.update(sessions).set({expiresAt:new Date(f.plan.expiresAt)}).where(eq(sessions.id,f.plan.sessionId));
      await db.execute(sql`create function multipart_fixture_hold() returns trigger language plpgsql as $$
        begin perform pg_sleep(3); return new; end $$`);
      await db.execute(sql`create trigger multipart_fixture_hold before insert on media_r2_multipart_journals
        for each row execute function multipart_fixture_hold()`);
      let first;
      try{
        const ctx=f.ctx();
        first=ctx.journal.exclusive(ctx.driver.scope,f.plan.key,f.plan.sessionId,async(_raw,save)=>save(f.intent()))
          .then(()=>null,error=>error);
        await new Promise(resolve=>setTimeout(resolve,2200));
        await cleanupUploadSessions();
        assert.equal(await first,null);
        assert.equal((await stat(f.source)).size,f.plan.size);
        assert.equal((await f.read()).checkpoint.phase,"initiating");
      }finally{
        if(first)await first;
        await db.execute(sql`drop trigger multipart_fixture_hold on media_r2_multipart_journals`);
        await db.execute(sql`drop function multipart_fixture_hold()`);
      }
    }));
    await t.test("concurrent registration cannot duplicate assets or analysis jobs",async()=>using({},async f=>{
      await f.send();
      const outcomes=await Promise.allSettled([f.register(f.media(),true),f.register(f.media(),true)]);
      assert.ok(outcomes.some(result=>result.status==="fulfilled"));
      for(const result of outcomes)if(result.status==="rejected")assert.equal(result.reason.code,"busy");
      const item=await f.register(f.media(),true);
      assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.eventId,f.plan.eventId))).length,1);
      assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,item.id))).length,1);
    }));
    await t.test("a missing generated derivative blocks handoff without freeing capacity",async()=>using({},async f=>{
      await f.send();
      await db.delete(routes).where(eq(routes.key,f.thumbnailKey));
      await assert.rejects(f.register(),isCode("conflict"));
      assert.equal((await f.read()).checkpoint.phase,"verified");
      assert.equal((await creatorUsage(db,accounts[0].id)).reservedBytes,f.plan.size+102400);
    }));
    for(const official of [false,true])await t.test(`real ${official?"official":"Creator"} JPEG bridge preserves bytes and reuses bounded validation`,async()=>
      using({realPhoto:true,official,admin:official},async f=>{
        const before=await readFile(f.source);
        const prepared=await prepareMultipartJpeg(f.plan,f.source,f.driver());
        assert.deepEqual(await readFile(f.source),before);
        assert.equal((await f.read()).checkpoint,null,"Preparation is not an ambiguous provider initiation");
        assert.equal(f.state.calls.length,0);
        const preview=await readFile(prepared.thumbnail.path),metadata=await sharp(preview).metadata();
        assert.equal(metadata.format,"webp");assert.equal(metadata.exif,undefined);
        assert.equal(metadata.width,48);assert.equal(metadata.height,96);
        assert.ok(preview.length<=100000);assert.ok(Math.max(metadata.width,metadata.height)<=640);
        assert.equal(prepared.media.storedBytes,before.length+preview.length);
        assert.equal((await prepareMultipartJpeg(f.plan,f.source,f.driver())).thumbnail.sha256,prepared.thumbnail.sha256);
        await f.send();
        // Thumbnail persistence belongs to the existing small-object pipeline;
        // this fixture supplies its verified route, not an extra JPEG analysis.
        await db.insert(routes).values({key:f.thumbnailKey,provider:"r2",state:"verified",
          size:preview.length,sha256:prepared.thumbnail.sha256,objectVersion:'"prepared-thumb"',mime:"image/webp"});
        const item=await f.register({...f.media(),...prepared.media},true);
        assert.equal(item.highBytes,before.length);
        assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,item.id))).length,1);
        await f.cleanup();
        assert.ok(f.state.objects.has(f.plan.key));
      }));
    await t.test("malformed JPEG has zero provider writes and its no-write staging fence can be cleaned",async()=>
      using({realPhoto:true},async f=>{
        const malformed=Buffer.alloc(f.plan.size,23);
        await writeFile(f.source,malformed);
        f.plan.sha256=createHash("sha256").update(malformed).digest("hex");
        await db.update(sessions).set({sha256:f.plan.sha256}).where(eq(sessions.id,f.plan.sessionId));
        await assert.rejects(prepareMultipartJpeg(f.plan,f.source,f.driver()),isCode("integrity"));
        assert.equal(f.state.calls.length,0);
        assert.equal((await f.read()).checkpoint,null);
        f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";f.env.MEDIA_R2_MULTIPART_ENABLED="false";
        assert.equal(await f.cleanup(),"released");
        await assert.rejects(stat(f.source),error=>error.code==="ENOENT");
        assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,f.plan.sessionId))).length,0);
      }));
    await t.test("changed original checksum or immutable preview cannot pass JPEG preparation",async()=>
      using({realPhoto:true},async f=>{
        const prepared=await prepareMultipartJpeg(f.plan,f.source,f.driver());
        await writeFile(prepared.thumbnail.path,Buffer.alloc(prepared.thumbnail.size,1));
        await assert.rejects(prepareMultipartJpeg(f.plan,f.source,f.driver()),isCode("integrity"));
        await rm(prepared.thumbnail.path);
        const source=await readFile(f.source);source[source.length-1]=1;await writeFile(f.source,source);
        await assert.rejects(prepareMultipartJpeg(f.plan,f.source,f.driver()),isCode("integrity"));
        assert.equal(f.state.calls.length,0);
      }));
    await t.test("closed gates or non-owned source paths cannot enter native JPEG processing",async()=>
      using({realPhoto:true},async f=>{
        f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";
        await assert.rejects(prepareMultipartJpeg(f.plan,f.source,f.driver()),isCode("configuration"));
        assert.equal(await f.read(),undefined);
        f.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="true";
        await assert.rejects(prepareMultipartJpeg(f.plan,path.join(f.root,"source"),f.driver()),isCode("integrity"));
        assert.equal(f.state.calls.length,0);
        assert.equal(await f.cleanup(),"released");
      }));
    await t.test("no-write cleanup refuses release when any route shows a persistence attempt",async()=>
      using({realPhoto:true},async f=>{
        const prepared=await prepareMultipartJpeg(f.plan,f.source,f.driver());
        await db.insert(routes).values({key:f.thumbnailKey,provider:"r2",state:"verified",
          size:prepared.thumbnail.size,sha256:prepared.thumbnail.sha256,mime:"image/webp",objectVersion:'"fixture"'});
        await assert.rejects(f.cleanup(),isCode("cleanup_pending"));
        assert.equal((await stat(f.source)).size,f.plan.size);
        assert.equal((await creatorUsage(db,accounts[0].id)).reservedBytes,f.plan.size+102400);
      }));
    await t.test("JPEG preparation never retries an uncertain provider initiation",async()=>
      using({realPhoto:true},async f=>{
        f.state.after=async name=>{if(name==="CreateMultipartUploadCommand")throw Error("lost reply");};
        await assert.rejects(f.send());f.state.after=undefined;
        const calls=f.state.calls.length;
        await assert.rejects(prepareMultipartJpeg(f.plan,f.source,f.driver()),isCode("uncertain"));
        assert.equal(f.state.calls.length,calls);
        assert.equal((await f.read()).checkpoint.phase,"initiating");
      }));
  }finally{
    for(const account of accounts)await db.delete(users).where(eq(users.id,account.id));
    await pool.end();
  }
});
