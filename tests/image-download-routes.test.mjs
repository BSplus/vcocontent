// Real route/database ledger, isolated synthetic accounts, local storage and
// provider mocks. Never requires credentials for a live account or Nextcloud.
import "./helpers/beta-provider-preload.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import { users, events, mediaItems, mediaCleanup, mediaReservations, betaRateLimits } from "../shared/schema.ts";
import { registerRoutes } from "../server/routes.ts";
import { creatorUsage } from "../server/beta-policy.ts";
import { createMediaKeys } from "../server/media-storage.ts";
import { isCreatorOriginal } from "../shared/image-provenance.ts";
import { recognitionImageInput } from "../server/image-analysis.ts";
import { startImport, importStatus, stopImportWorker } from "../server/nextcloud.ts";
import { mockMediaStorage } from "./helpers/memory-media-storage.mjs";
import { withMediaWorkBudget } from "../server/media-work-budget.ts";

const store=mockMediaStorage();
test.after(async()=>{store.restore();await stopImportWorker();await pool.end();});
const hash=data=>createHash("sha256").update(data).digest("hex");
const tiny=()=>sharp({create:{width:48,height:32,channels:3,background:"#aa5566"}});
function form(bytes,mime,type="image"){
  const body=new FormData();
  body.set("type",type);body.set("autoTag","false");
  // Client cannot choose storage strategy or override target ownership.
  body.set("strategy","official");
  body.set("file",new Blob([bytes],{type:mime}),"source."+mime.split("/")[1]);
  return body;
}

test("owner/admin upload originals through actual routes, boundaries, ledger, cleanup and offline Nextcloud downloads", {timeout:120000},async()=>{
  const suffix=randomUUID();
  const people=[],galleries=[];
  const savedCleanup=storage.cleanupObjects;
  let server;
  const transport=globalThis.fetch;
  const previousCloud=process.env.NEXTCLOUD_BASE_URL;
  try {
    for(const role of ["owner","admin"]){
      const [user]=await db.insert(users).values({username:`photo-${role}-${suffix}`,email:`photo-${role}-${suffix}@example.invalid`,
        password:"synthetic-unused-hash",isCreator:true,isAdmin:role==="admin",creatorStatus:"approved",emailVerifiedAt:new Date()}).returning();
      people.push(user);
    }
    storage.cleanupObjects=async()=>savedCleanup.call(storage,people.map(p=>p.id));
    const gallery=await storage.createEvent({title:"Original fixture",description:"Synthetic",date:new Date(),creatorId:people[0].id});
    const official=await storage.createEvent({title:"Official fixture",description:"Synthetic",date:new Date()});
    galleries.push(gallery.id,official.id);
    await db.update(events).set({visibility:"published",safetyStatus:"legacy"}).where(eq(events.id,gallery.id));
    const app=express();
    app.use((req,_res,next)=>{
      req.user=people.find(p=>p.id===Number(req.headers["x-test-user"]));
      req.isAuthenticated=()=>!!req.user;
      next();
    });
    server=await registerRoutes(app,{workers:false});
    server.listen(0,"127.0.0.1");await once(server,"listening");
    const base=`http://127.0.0.1:${server.address().port}`;
    const request=(path,role,options={})=>fetch(base+path,{...options,
      headers:{...options.headers,...(role?{"x-test-user":String(people[role==="admin"?1:0].id)}:{})}});
    const upload=async(bytes,mime,role="owner",expected=201,eventId=gallery.id)=>{
      const response=await request(`/api/events/${eventId}/media/upload`,role,{method:"POST",body:form(bytes,mime)});
      const body=await response.json();assert.equal(response.status,expected,JSON.stringify(body));return body;
    };
    const policy=await (await request(`/api/media/policy?eventId=${gallery.id}`,"admin")).json();
    assert.equal(policy.imageBytes,5_000_000);assert.equal(policy.community,true);assert.equal(policy.videoBytes,0);
    const officialPolicy=await (await request(`/api/media/policy?eventId=${official.id}`,"admin")).json();
    assert.equal(officialPolicy.imageBytes,32*1048576);

    for(const role of ["owner","admin"])for(const [format,mime] of [["jpeg","image/jpeg"],["png","image/png"],["webp","image/webp"],["gif","image/gif"]]){
      const bytes=await tiny()[format]().toBuffer();
      const before=store.writes.length;
      const item=await upload(bytes,mime,role);
      assert.ok(isCreatorOriginal(item.url));
      assert.equal(item.safetyStatus,"approved", "All new supported formats must pass independently mocked safety checks");
      assert.equal(store.writes.length-before,2);
      const low=store.objects.get(item.thumbnail.split("/").at(-1));
      assert.equal(item.storedBytes,bytes.length+low.length);
      assert.equal(item.highBytes,bytes.length);
      assert.ok(item.lowBytes<=100_000);
      assert.equal((await request(item.url)).status,401);
      const authorization=await request(`/api/media/${item.id}/download?quality=high`,role,{method:"POST"});
      assert.equal(authorization.status,200);
      const delivery=await request((await authorization.json()).url,role);
      assert.equal(delivery.status,200);assert.equal(delivery.headers.get("content-type"),mime);
      assert.equal(hash(Buffer.from(await delivery.arrayBuffer())),hash(bytes));
      // The count commits after streaming, not on the authorization request.
      for(let i=0;i<20 && (await storage.getMediaItem(item.id)).downloadCount!==1;i++) await new Promise(r=>setTimeout(r,20));
      assert.equal((await storage.getMediaItem(item.id)).downloadCount,1);
      const writes = store.writes.length;
      assert.equal((await request(`/api/media/${item.id}/download?quality=low`)).status,401);
      const lowDelivery = await request(`/api/media/${item.id}/download?quality=low`,role);
      assert.equal(lowDelivery.status,200);
      assert.equal(lowDelivery.headers.get("content-type"),"image/webp");
      assert.equal(lowDelivery.headers.get("content-disposition"),`attachment; filename="media-${item.id}-low.webp"`);
      const lowBytes=Buffer.from(await lowDelivery.arrayBuffer());
      assert.ok(lowBytes.length<=500_000);
      const lowMeta=await sharp(lowBytes).metadata();
      assert.deepEqual([lowMeta.width,lowMeta.height],[48,32]);
      assert.equal(store.writes.length,writes);
      for(let i=0;i<20 && (await storage.getMediaItem(item.id)).downloadCount!==2;i++) await new Promise(r=>setTimeout(r,20));
      assert.equal((await storage.getMediaItem(item.id)).downloadCount,2);
      const recognition=await recognitionImageInput(item);
      assert.match(recognition,/^data:image\/webp;base64,/);
      assert.ok((await sharp(Buffer.from(recognition.split(",")[1],"base64")).metadata()).width<=1600);
    }
    const png=await tiny().png().toBuffer();
    const exact=Buffer.concat([png,Buffer.alloc(5_000_000-png.length)]);
    for(const role of ["owner","admin"]){
      const item=await upload(exact,"image/png",role);
      const delivered=await request(`/api/media/${item.id}/download?quality=high`,role);
      assert.equal(hash(Buffer.from(await delivered.arrayBuffer())),hash(exact));
      await upload(Buffer.concat([exact,Buffer.from([0])]),"image/png",role,413);
      await upload(png,"image/jpeg",role,400);
      await upload(Buffer.from("corrupt"),"image/png",role,400);
      const frames=Buffer.concat([Buffer.alloc(12,0),Buffer.alloc(12,255)]);
      const animated=await sharp(frames,{raw:{width:2,height:4,channels:3,pageHeight:2}}).gif().toBuffer();
      await upload(animated,"image/gif",role,413);
    }
    let items=await storage.getMediaItems(gallery.id);
    const usage=await creatorUsage(db,people[0].id);
    assert.equal(usage.bytes,items.reduce((sum,m)=>sum+m.highBytes+m.lowBytes,0));
    assert.equal(usage.photos,items.length);
    assert.equal(usage.pendingCleanup,0);

    // Parallel reservations must include previews; admins cannot bypass the
    // target owner's Free 500-MB quota.
    const reserveIds=[randomUUID(),randomUUID()];
    const results=await Promise.allSettled(reserveIds.map(id=>{
      const keys=createMediaKeys("image/png","creator-original");
      return storage.reserveMedia(id,gallery.id,people[0].id,300_000_000,keys.storageKey,keys.thumbnailKey,true);
    }));
    assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
    assert.match(String(results.find(r=>r.status==="rejected").reason),/storage is full/);
    await db.delete(mediaReservations).where(inArray(mediaReservations.id,reserveIds));

    store.failKey=key=>key.startsWith("thumb-");
    store.failDelete=()=>true;
    const failedStart=store.writes.length;
    await upload(png,"image/png","admin",502);
    await new Promise(r=>setTimeout(r,50));
    const pending=await creatorUsage(db,people[0].id);
    assert.ok(pending.pendingCleanup>0);
    assert.ok(pending.bytes>usage.bytes,"Failed uploads remain counted until cleanup succeeds");
    const failedKeys=store.writes.slice(failedStart);
    store.failDelete=null;store.failKey=null;
    await storage.cleanupObjects();
    for(const key of failedKeys)assert.equal(store.objects.has(key),false);
    assert.equal((await creatorUsage(db,people[0].id)).bytes,usage.bytes);

    // Historical creator file keeps v4 provenance, moderation and access;
    // neither metadata edit nor download turns it into an original.
    const legacyBytes=await tiny().webp().toBuffer();
    const keys=createMediaKeys("image/webp");
    store.objects.set(keys.storageKey,legacyBytes);store.objects.set(keys.thumbnailKey,legacyBytes);
    const old=await storage.createMediaItem({eventId:gallery.id,type:"image",url:`/api/media/files/${keys.storageKey}`,
      thumbnail:`/api/media/files/${keys.thumbnailKey}`,tags:["preserved"],caption:"Preserved caption",
      highBytes:legacyBytes.length,lowBytes:legacyBytes.length,storedBytes:legacyBytes.length*2});
    await db.update(mediaItems).set({safetyStatus:"legacy"}).where(eq(mediaItems.id,old.id));
    assert.equal(isCreatorOriginal(old.url),false);
    const oldDownload=await request(`/api/media/${old.id}/download`,"owner");
    assert.equal(hash(Buffer.from(await oldDownload.arrayBuffer())),hash(legacyBytes));
    assert.deepEqual((await storage.getMediaItem(old.id)).tags,["preserved"]);
    await db.update(mediaItems).set({isPremium:true}).where(eq(mediaItems.id,old.id));
    assert.equal((await request(`/api/media/${old.id}/download`,"owner")).status,403);
    assert.equal((await request(`/api/media/${old.id}/download?quality=low`)).status,403);
    await db.update(mediaItems).set({isPremium:false,safetyStatus:"blocked"}).where(eq(mediaItems.id,old.id));
    assert.equal((await request(`/api/media/${old.id}/download`,"owner")).status,404);
    assert.equal((await request(`/api/media/${old.id}/download?quality=low`)).status,404);

    // Historical Base64 derives from the large field, not an unusable thumbnail.
    const historical=await storage.createMediaItem({eventId:official.id,type:"image",
      url:`data:image/webp;base64,${legacyBytes.toString("base64")}`,thumbnail:"broken-thumbnail",tags:["unchanged"],caption:"Unchanged"});
    const legacyLow=await request(`/api/media/${historical.id}/download?quality=low`);
    assert.equal(legacyLow.status,200);
    assert.ok((await legacyLow.arrayBuffer()).byteLength<=500_000);
    for(let i=0;i<20 && (await storage.getMediaItem(historical.id)).downloadCount!==1;i++) await new Promise(r=>setTimeout(r,20));
    assert.equal((await storage.getMediaItem(historical.id)).downloadCount,1);
    const originalUrl=historical.url;
    await db.update(mediaItems).set({url:"data:image/png;base64,Y29ycnVwdA=="}).where(eq(mediaItems.id,historical.id));
    const failedLow=await request(`/api/media/${historical.id}/download?quality=low`);
    assert.ok(failedLow.status>=400);
    assert.equal((await storage.getMediaItem(historical.id)).downloadCount,1);
    await db.update(mediaItems).set({url:originalUrl}).where(eq(mediaItems.id,historical.id));
    let release;
    const held=new Promise(resolve=>{release=resolve;});
    const jobs=Array.from({length:10},()=>withMediaWorkBudget(()=>held));
    try {
      assert.equal((await request(`/api/media/${historical.id}/download?quality=low`)).status,503);
      assert.equal((await storage.getMediaItem(historical.id)).downloadCount,1);
    } finally {release();await Promise.all(jobs);}
    assert.equal((await storage.getMediaItem(historical.id)).url,originalUrl);
    assert.deepEqual((await storage.getMediaItem(historical.id)).tags,["unchanged"]);
    assert.equal((await storage.getMediaItem(historical.id)).caption,"Unchanged");

    // Genuine >5-MB authorized source, mocked DAV only. Sources remain remote;
    // downloads read App Storage after the cloud becomes unreachable.
    const source=await readFile("attached_assets/#89_3.png");
    process.env.NEXTCLOUD_BASE_URL="https://image-cloud.example.invalid";
    let cloudUp=true,gets=0;
    globalThis.fetch=(url,options)=>{
      if(new URL(url).origin!=="https://image-cloud.example.invalid")return transport(url,options);
      if(!cloudUp)throw new Error("Synthetic cloud outage");
      if(options.method==="PROPFIND")return Promise.resolve(new Response(`<d:multistatus xmlns:d="DAV:">
        <d:response><d:href>/public.php/dav/files/SYNTHETIC/large.png</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status>
        <d:prop><d:getcontentlength>${source.length}</d:getcontentlength><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>`,{status:207}));
      assert.equal(options.method,"GET","No modifying DAV operations");
      gets++;return Promise.resolve(new Response(source,{headers:{"content-length":String(source.length)}}));
    };
    const beforeCloud=store.writes.length;
    await startImport(official.id,[{link:"https://image-cloud.example.invalid/s/SYNTHETIC"}]);
    let status;
    for(let i=0;i<150;i++){
      status=await importStatus(official.id);
      if(["completed","partial","error"].includes(status.status))break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert.equal(status.status,"completed",JSON.stringify(status));
    assert.equal(gets,1);
    assert.equal(store.writes.length-beforeCloud,2);
    cloudUp=false;
    const imported=(await storage.getMediaItems(official.id)).find(m=>m.id!==historical.id);
    assert.ok(imported.highBytes<=5_000_000);
    const offline=await request(`/api/media/${imported.id}/download`,"admin");
    assert.equal(offline.status,200);
    const m=await sharp(Buffer.from(await offline.arrayBuffer())).metadata();
    assert.deepEqual([m.width,m.height],[2160,2700]);
    const importedLow=await request(`/api/media/${imported.id}/download?quality=low`);
    assert.equal(importedLow.status,200);
    const importedLowBytes=Buffer.from(await importedLow.arrayBuffer());
    assert.ok(importedLowBytes.length<=500_000);
    const importedLowMeta=await sharp(importedLowBytes).metadata();
    assert.deepEqual([importedLowMeta.width,importedLowMeta.height],[1280,1600]);
    assert.equal((await request(`/api/media/${imported.id}/download?quality=high`)).status,401);
  } finally {
    await stopImportWorker();
    globalThis.fetch=transport;
    if(previousCloud===undefined)delete process.env.NEXTCLOUD_BASE_URL;else process.env.NEXTCLOUD_BASE_URL=previousCloud;
    store.failKey=null;store.failDelete=null;
    if(server){server.close();await once(server,"close");}
    for(const id of galleries) {await storage.deleteEvent(id);}
    await storage.cleanupObjects();
    // Official fixtures have no creator ID; remove only this test's keys from
    // the cleanup ledger, never run a global cleanup against another database.
    if(store.writes.length) await db.delete(mediaCleanup).where(inArray(mediaCleanup.key,store.writes));
    await db.delete(mediaCleanup).where(inArray(mediaCleanup.creatorId,people.map(p=>p.id)));
    await db.delete(users).where(inArray(users.id,people.map(p=>p.id)));
    for(const p of people)for(const prefix of ["safety","upload"])
      await db.delete(betaRateLimits).where(eq(betaRateLimits.key,`${prefix}:${p.id}`));
    storage.cleanupObjects=savedCleanup;
  }
});
