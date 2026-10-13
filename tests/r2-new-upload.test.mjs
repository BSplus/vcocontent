// Disposable local PostgreSQL + disk-backed providers ONLY; never live R2.
import "./helpers/beta-provider-preload.mjs";
import { fixtureRoots,restoreR2Fixture } from "./helpers/r2-cli-preload.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID,randomBytes,scrypt,createHash } from "node:crypto";
import { writeFile,readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import express from "express";
import session from "express-session";
import sharp from "sharp";
import { db,pool } from "../server/db.ts";
import { mediaItems,events,users,mediaObjectRoutes } from "../shared/schema.ts";
import { eq,sql } from "drizzle-orm";
import { storage } from "../server/storage.ts";
import { creatorUsage } from "../server/beta-policy.ts";
import { registerRoutes } from "../server/routes.ts";
import { uploadMedia } from "../server/media-storage.ts";
import { mediaDatabaseFingerprint } from "../server/media-storage-config.ts";
import { putMediaObject,openMediaObject } from "../server/media-object-routing.ts";
import { recognitionImageInput } from "../server/image-analysis.ts";
import { recordDownload } from "../server/community.ts";
import { setupAuth } from "../server/auth.ts";
import { inspectDummyContentReset } from "../server/dummy-content-reset-plan.ts";
import { eventPublic } from "../server/beta-access.ts";

Object.assign(process.env,{NODE_ENV:"development",MEDIA_STORAGE_ENVIRONMENT:"development",
  MEDIA_STORAGE_DATABASE_FINGERPRINT:mediaDatabaseFingerprint(process.env.DATABASE_URL),
  MEDIA_STORAGE_ROUTING:"enabled",MEDIA_STORAGE_PROVIDER:"r2",MEDIA_STORAGE_NEW_UPLOADS_ENABLED:"true",
  R2_ACCOUNT_ID:"a".repeat(32),R2_BUCKET:"vco-fixture-test",R2_JURISDICTION:"eu",
  R2_STORAGE_CLASS:"Standard",R2_DEV_ACCESS_KEY_ID:"synthetic",R2_DEV_SECRET_ACCESS_KEY:"synthetic"});
test.after(async()=>{restoreR2Fixture();await pool.end();});
const bytes=async s=>{const out=[];for await(const b of s)out.push(b);return Buffer.concat(out);};
test("new photo/video R2 routing, private Range, AI input, counters and owned cleanup", {timeout:120000},async()=>{
  const created=await storage.createUser({username:`r2-new-${randomUUID()}`,email:`fixture-${randomUUID()}@example.invalid`,password:"synthetic"});
  await db.update(users).set({isAdmin:true}).where(eq(users.id,created.id));
  const actor={...created,isAdmin:true};
  const event=await storage.createEvent({title:"Owned isolated fixture",description:"Synthetic",date:new Date(),creatorId:actor.id});
  const png=await sharp({create:{width:100,height:70,channels:3,background:"green"}}).png().toBuffer();
  const filename=path.join(fixtureRoots.replit,`input-${randomUUID()}.png`);
  await writeFile(filename,png);
  const photo=await uploadMedia({path:filename,mimetype:"image/png",size:png.length,originalname:"input.png"},"image",undefined,undefined,"creator-original");
  const p=await storage.createMediaItem({eventId:event.id,type:"image",url:photo.url,thumbnail:photo.thumbnail,
    highBytes:photo.highBytes,lowBytes:photo.lowBytes,storedBytes:photo.highBytes+photo.lowBytes,tags:["manual-preserved"]});
  const videoFile=path.join(fixtureRoots.replit,`input-${randomUUID()}.mp4`);
  await promisify(execFile)("ffmpeg",["-y","-f","lavfi","-i","testsrc2=size=160x120:rate=5","-t","1","-c:v","libx264","-pix_fmt","yuv420p",videoFile]);
  const clip=await readFile(videoFile);
  const video=await uploadMedia({path:videoFile,mimetype:"video/mp4",size:clip.length,originalname:"input.mp4"},"video");
  const v=await storage.createMediaItem({eventId:event.id,type:"video",url:video.url,thumbnail:video.thumbnail,
    highBytes:video.highBytes,lowBytes:video.lowBytes,storedBytes:video.highBytes+video.lowBytes,tags:[]});
  const keys=[photo.storageKey,photo.thumbnailKey,video.storageKey,video.thumbnailKey];
  let server,anonymous;
  try {
    for(const key of keys){
      const [route]=await db.select().from(mediaObjectRoutes).where(eq(mediaObjectRoutes.key,key));
      assert.equal(route.provider,"r2");assert.equal(route.state,"verified");
      assert.deepEqual(await bytes(openMediaObject(key)),await readFile(path.join(fixtureRoots.r2,key)));
    }
    assert.deepEqual(await bytes(openMediaObject(photo.storageKey)),png);
    assert.deepEqual(await bytes(openMediaObject(video.storageKey)),clip);
    assert.ok(photo.lowBytes<100000);
    assert.match(await recognitionImageInput(p),/^data:image\/webp;base64,/);
    assert.ok((await creatorUsage(db,actor.id)).bytes>0);
    const app=express();
    app.use((req,_res,next)=>{req.user=actor;req.isAuthenticated=()=>true;next();});
    server=await registerRoutes(app,{workers:false});server.listen(0,"127.0.0.1");await once(server,"listening");
    const base=`http://127.0.0.1:${server.address().port}`;
    const range=await fetch(base+v.url,{headers:{Range:"bytes=0-511"}});
    assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),clip.subarray(0,512));
    assert.equal((await fetch(base+p.thumbnail)).status,200);
    let stranger=false;
    const anon=express();anon.use((req,_res,next)=>{
      req.isAuthenticated=()=>stranger;
      if(stranger)req.user={id:actor.id+999,isAdmin:false,suspended:false};
      next();
    });
    anonymous=await registerRoutes(anon,{workers:false});anonymous.listen(0,"127.0.0.1");await once(anonymous,"listening");
    assert.equal((await fetch(`http://127.0.0.1:${anonymous.address().port}`+p.url)).status,404);
    stranger=true;
    assert.equal((await fetch(`http://127.0.0.1:${anonymous.address().port}`+p.url)).status,404);
    stranger=false;
    const op=randomUUID();await recordDownload(actor.id,p.id,"high",op);await recordDownload(actor.id,p.id,"high",op);
    assert.equal((await storage.getMediaItem(p.id)).downloadCount,1);
    await db.update(events).set({customThumbnail:p.thumbnail}).where(eq(events.id,event.id));
    assert.deepEqual((await storage.getMediaItem(p.id)).tags,["manual-preserved"]);
    const planningClient=await pool.connect();
    try {
      await planningClient.query("BEGIN READ ONLY");
      const plan=await inspectDummyContentReset(planningClient);
      assert.ok(plan.blockers.some(b=>b.startsWith("media_object_routes:")));
      assert.ok(plan.media.includes(p.id));
      await planningClient.query("ROLLBACK");
    } finally {await planningClient.query("ROLLBACK").catch(()=>{});planningClient.release();}
    await assert.rejects(putMediaObject(photo.storageKey,png),/integrity/);
    process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="false";
    await assert.rejects(putMediaObject(`media-${randomUUID()}.png`,png),/configuration/);
    process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="true";
  } finally {
    if(server)await new Promise(r=>server.close(r));if(anonymous)await new Promise(r=>anonymous.close(r));
    for(const id of [p.id,v.id])await storage.deleteMediaItem(id);
    await storage.cleanupObjects();
    for(const key of keys)await assert.rejects(readFile(path.join(fixtureRoots.r2,key)),/ENOENT/);
    await db.delete(events).where(eq(events.id,event.id));await db.delete(users).where(eq(users.id,actor.id));
  }
});

test("real owner session delivers photo; retired video poster is 404 until authorized metadata refresh", {timeout:30000},async()=>{
  // A retained official configuration container needs adminHidden: draft alone
  // does not hide owner-less events under the existing public-access contract.
  assert.equal(await eventPublic({creatorId:null,visibility:"draft",adminHidden:false}),true);
  assert.equal(await eventPublic({creatorId:null,visibility:"draft",adminHidden:true}),false);
  // Entirely disposable PG/disk transport: no live Development upload or R2 call.
  const run=randomUUID(),password="synthetic-local-only",salt=randomBytes(16).toString("hex");
  const hashed=(await promisify(scrypt)(password,salt,64)).toString("hex")+"."+salt;
  const [owner]=await db.insert(users).values({username:`poster-owner-${run}`,email:`poster-${run}@example.invalid`,
    password:hashed,isCreator:true,creatorStatus:"approved",emailVerifiedAt:new Date()}).returning();
  const event=await storage.createEvent({title:"Private poster fixture",description:"Synthetic",date:new Date(),creatorId:owner.id});
  const png=await sharp({create:{width:64,height:32,channels:3,background:"green"}}).png().toBuffer();
  const preview=await sharp(png).webp().toBuffer();
  const keys=[`media-${randomUUID()}.png`,`thumb-${randomUUID()}.webp`,
    `media-${randomUUID()}.mp4`,`thumb-${randomUUID()}.webp`,`thumb-${randomUUID()}.webp`];
  const url=k=>`/api/media/files/${k}`;
  const data=[png,preview,Buffer.from("synthetic-video-not-played"),preview,preview];
  for(let i=0;i<keys.length;i++){
    await writeFile(path.join(fixtureRoots.r2,keys[i]),data[i]);
    await db.insert(mediaObjectRoutes).values({key:keys[i],provider:"r2",state:"verified",
      sha256:createHash("sha256").update(data[i]).digest("hex"),size:data[i].length,
      mime:i===0?"image/png":i===2?"video/mp4":"image/webp",objectVersion:"fixture"});
  }
  const p=await storage.createMediaItem({eventId:event.id,type:"image",url:url(keys[0]),thumbnail:url(keys[1]),tags:[]});
  const v=await storage.createMediaItem({eventId:event.id,type:"video",url:url(keys[2]),thumbnail:url(keys[3]),tags:[]});
  let server;
  try {
    const app=express();app.use(express.json());
    app.use(session({name:"vco.sid",secret:"synthetic-local-session-secret",resave:false,
      saveUninitialized:false,store:storage.sessionStore}));
    setupAuth(app);
    server=await registerRoutes(app,{workers:false});server.listen(0,"127.0.0.1");await once(server,"listening");
    const base=`http://127.0.0.1:${server.address().port}`;
    const login=await fetch(base+"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:owner.username,password})});
    assert.equal(login.status,200);
    assert.equal((await login.json()).id,owner.id);
    const cookie=login.headers.get("set-cookie").split(";")[0];
    const request=path=>fetch(base+path,{headers:{Cookie:cookie}});
    assert.equal((await request(p.url)).status,200,"authenticated photo original");
    assert.equal((await request(p.thumbnail)).status,200,"authenticated photo preview");
    assert.equal((await request(v.thumbnail)).status,200,"initial video poster");
    // This is exactly the mapping change committed by video AI. The retired
    // object is still physically present; no live storage or model is involved.
    await db.update(mediaItems).set({thumbnail:url(keys[4])}).where(eq(mediaItems.id,v.id));
    assert.deepEqual(await readFile(path.join(fixtureRoots.r2,keys[3])),preview);
    assert.equal((await request(v.thumbnail)).status,404,"cached upload-response poster must not bypass ownership mapping");
    assert.equal((await request(p.url)).status,200,"poster replacement does not break the photo");
    assert.equal((await request(p.thumbnail)).status,200);
    const list=await request(`/api/events/${event.id}/media`);
    assert.equal(list.status,200);
    const body=await list.json();
    const fresh=body.find(m=>m.id===v.id);
    assert.equal(fresh.thumbnail,url(keys[4]));
    assert.equal((await request(fresh.thumbnail)).status,200,"refreshed authenticated poster");
    assert.equal((await fetch(base+fresh.thumbnail)).status,404,"private poster remains denied anonymously");
  } finally {
    if(server)await new Promise(r=>server.close(r));
    await db.delete(mediaItems).where(sql`${mediaItems.id}=any(${`{${p.id},${v.id}}`}::int[])`);
    await db.delete(mediaObjectRoutes).where(sql`${mediaObjectRoutes.key}=any(${`{${keys.join(",")}}`}::text[])`);
    await db.delete(events).where(eq(events.id,event.id));
    await pool.query("delete from session where sess->'passport'->>'user'=$1",[String(owner.id)]);
    await db.delete(users).where(eq(users.id,owner.id));
  }
});
