import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {rm} from "node:fs/promises";

test("native multipart PostgreSQL journal uses a disposable database only",{
  skip:!process.env.VCO_TEST_PG_PROXY||!process.env.VCO_TEST_OBJECTS,timeout:90000,
},async t=>{
  assert.equal(new URL(process.env.DATABASE_URL).hostname,"127.0.0.1");
  await import("./helpers/beta-provider-preload.mjs");
  const {db,pool}=await import("../server/db.ts");
  const {storage}=await import("../server/storage.ts");
  const {users,events,mediaReservations,mediaUploadSessions:sessions,mediaCleanup}=await import("../shared/schema.ts");
  const {r2MultipartJournals:journals}=await import("../shared/r2-multipart-schema.ts");
  const {databaseMultipartContext}=await import("../server/r2-multipart-journal.ts");
  const {uploadR2MultipartFile,cancelR2Multipart,multipartPlanBinding}=await import("../server/r2-multipart-upload.ts");
  const {multipartFixture}=await import("./helpers/r2-multipart-fixture.mjs");
  const {mediaDatabaseFingerprint}=await import("../server/media-storage-config.ts");
  const {creatorUsage}=await import("../server/beta-policy.ts");
  const {eq,sql}=await import("drizzle-orm");
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
      await storage.reserveMedia(f.plan.sessionId,gallery.id,gallery.creatorId,f.plan.size+102400,
        f.plan.key,`thumb-${randomUUID()}.webp`,options.admin??false);
      await db.insert(sessions).values({id:f.plan.sessionId,actorId:f.plan.actorId,eventId:gallery.id,
        ownerId:gallery.creatorId,requestKey:randomUUID(),requestFingerprint:f.plan.owner.revision,
        size:f.plan.size,mime:f.plan.mime,sha256:f.plan.sha256,metadata:{},state:"finalizing",
        expiresAt:new Date(f.plan.expiresAt)});
      f.ctx=()=>databaseMultipartContext(f.plan,f.context().driver);
      f.send=()=>uploadR2MultipartFile(f.plan,f.source,f.ctx());
      f.read=async()=>(await db.select().from(journals).where(eq(journals.sessionId,f.plan.sessionId)))[0];
      f.intent=()=>({binding:multipartPlanBinding(f.plan,f.context().driver),phase:"initiating",parts:[]});
      await work(f);
    }finally{
      await db.delete(journals).where(eq(journals.sessionId,f.plan.sessionId));
      await db.delete(sessions).where(eq(sessions.id,f.plan.sessionId));
      await db.delete(mediaReservations).where(eq(mediaReservations.id,f.plan.sessionId));
      if(gallery)await db.delete(events).where(eq(events.id,gallery.id));
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
  }finally{
    for(const account of accounts)await db.delete(users).where(eq(users.id,account.id));
    await pool.end();
  }
});
