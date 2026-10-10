import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { randomUUID,createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Client } from "@replit/object-storage";
import sharp from "sharp";

// Provider transport is fully synthetic and set before SDK import.
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL="https://community-test.invalid";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY="synthetic";
const realFetch=globalThis.fetch;
let holdAnalysis, enteredAnalysis;
globalThis.fetch=async(input,init)=>{
  if (!String(input).startsWith("https://community-test.invalid")) return realFetch(input,init);
  const safety=String(init.body).includes("publication safety reviewer");
  if(safety){
    const payload=JSON.parse(init.body).messages[1].content;
    const text=payload.find(c=>c.type==="text")?.text || "";
    const raw=payload.find(c=>c.type==="image_url")?.image_url?.url?.split(",")[1];
    fingerprints.push(createHash("sha256").update(SAFETY_POLICY).update(TAG_MODEL).update(text).update(raw?Buffer.from(raw,"base64"):"").digest("hex"));
  }
  if (!safety && holdAnalysis) { enteredAnalysis?.(); await holdAnalysis; }
  const content=safety?JSON.stringify({sexualized:String(init.body).includes("Synthetic rejection")?"prohibited":"clear",pornography:"clear",racistOrDehumanizing:"clear",
    hateSymbolsOrGlorification:"clear",visibleTextAndSymbolsReviewed:true}):"Day, Porsche, Fictional Driver";
  return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content}}]}),{headers:{"Content-Type":"application/json"}});
};
const {db,pool}=await import("../server/db.ts");
const {eq,and,sql}=await import("drizzle-orm");
const {users,events,mediaItems,communityLikes,communityFavorites,downloadHistory,mediaAnalysisJobs,safetyResults}=await import("../shared/schema.ts");
const {storage}=await import("../server/storage.ts");
const {registerRoutes}=await import("../server/routes.ts");
const {recordDownload}=await import("../server/community.ts");
const {communityCaption}=await import("../server/caption-proposal.ts");
const {drainAnalysisQueue,setAnalysisQueueTestScope,analysisFingerprint}=await import("../server/analysis-jobs.ts");
const {SAFETY_POLICY}=await import("../server/beta-policy.ts");
const {TAG_MODEL}=await import("../server/utils/ai-tagger.ts");
const token=randomUUID();
const accounts=[],albums=[],fingerprints=[];
let server,base,a,b,album,photo,community;
const image=`data:image/webp;base64,${(await sharp({create:{width:32,height:32,channels:3,background:"green"}}).webp().toBuffer()).toString("base64")}`;
async function request(path,method="GET",user=a,body) {
  return realFetch(base+path,{method,headers:{...(user?{"x-test-user":String(user.id)}:{}),
    ...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
}
const wait=async(check)=>{
  for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}
  throw new Error("Expected fixture state did not settle");
};
test.before(async()=>{
  for(let i=0;i<2;i++){
    const [u]=await db.insert(users).values({username:`community-${token}-${i}`,email:`${token}-${i}@example.test`,
      password:"synthetic-unused",isCreator:true,creatorStatus:"approved"}).returning();
    accounts.push(u); 
  }
  [a,b]=accounts; setAnalysisQueueTestScope(accounts.map(u=>u.username));
  album=await storage.createEvent({title:"Official fixture",description:"Synthetic",date:new Date("2026-10-10")});
  albums.push(album.id);
  photo=await storage.createMediaItem({eventId:album.id,type:"image",url:image,thumbnail:image,tags:[],caption:"Fixture photo"});
  community=await storage.createEvent({title:"Community fixture",description:"Synthetic",date:new Date("2026-10-10"),track:"Fixture circuit",creatorId:a.id});
  albums.push(community.id);
  await db.update(events).set({visibility:"published",safetyStatus:"legacy"}).where(eq(events.id,community.id));
  const app=express();app.use(express.json());
  app.use(async(req,_res,next)=>{
    req.user=accounts.find(u=>u.id===Number(req.headers["x-test-user"]));
    if(req.user) req.user=await storage.getUser(req.user.id);
    req.isAuthenticated=()=>!!req.user;next();
  });
  server=await registerRoutes(app,{workers:false});server.listen(0,"127.0.0.1");await once(server,"listening");
  base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async()=>{
  globalThis.fetch=realFetch;
  if(server){server.close();await once(server,"close");}
  for(const id of albums)await storage.deleteEvent(id);
  for(const u of accounts)await db.delete(users).where(eq(users.id,u.id));
  for(const fp of fingerprints)await db.delete(safetyResults).where(eq(safetyResults.fingerprint,fp));
  await pool.end();
});
test("parallel likes are unique; guest counts and private own state are separate",async()=>{
  const path=`/api/community/media/${photo.id}`;
  assert.equal((await request(path+"/like","PUT",null)).status,401);
  const writes=await Promise.all(Array.from({length:12},()=>request(path+"/like","PUT")));
  assert.ok(writes.every(r=>r.status===200));
  assert.deepEqual(await (await request(path)).json(),{count:1,liked:true,saved:false});
  assert.deepEqual(await (await request(path,"GET",null)).json(),{count:1,liked:false,saved:false});
  assert.deepEqual(await (await request(path,"GET",b)).json(),{count:1,liked:false,saved:false});
  await request(path+"/like","DELETE");await request(path+"/like","DELETE");
  assert.equal((await (await request(path)).json()).count,0);
});
test("favorites are private references and disappear after hide, premium, quarantine or suspension",async()=>{
  await request(`/api/community/media/${photo.id}/favorite`,"PUT");
  await request(`/api/community/event/${community.id}/favorite`,"PUT");
  const own=await request("/api/account/favorites");
  assert.equal(own.headers.get("cache-control"),"private, no-store");
  assert.equal((await own.json()).items.length,2);
  assert.equal((await (await request("/api/account/favorites","GET",b)).json()).items.length,0);
  assert.equal((await request("/api/account/favorites","GET",null)).status,401);
  await db.update(events).set({adminHidden:true}).where(eq(events.id,album.id));
  assert.equal((await request(`/api/community/media/${photo.id}`)).status,404);
  assert.equal((await (await request("/api/account/favorites")).json()).items.length,1);
  await db.update(events).set({adminHidden:false,isPremium:true}).where(eq(events.id,album.id));
  assert.equal((await (await request("/api/account/favorites")).json()).items.length,1);
  await db.update(events).set({isPremium:false}).where(eq(events.id,album.id));
  await db.update(events).set({visibility:"draft"}).where(eq(events.id,community.id));
  assert.equal((await (await request("/api/account/favorites")).json()).items.length,1);
  await db.update(events).set({visibility:"published"}).where(eq(events.id,community.id));
  await db.update(users).set({suspended:true}).where(eq(users.id,a.id));
  assert.equal((await request("/api/account/favorites")).status,403);
  assert.equal((await request(`/api/community/media/${photo.id}/like`,"PUT")).status,403);
  assert.equal((await request(`/api/media/${photo.id}/download`)).status,403);
  await db.update(users).set({suspended:false}).where(eq(users.id,a.id));
});
test("completed authorized delivery alone creates private deduplicated history, later downloads remain possible",async()=>{
  const path=`/api/media/${photo.id}/download`;
  const grant=await (await request(path,"POST")).json();
  assert.equal((await db.select().from(downloadHistory).where(eq(downloadHistory.userId,a.id))).length,0);
  assert.equal((await request(grant.url,"GET",b)).status,400);
  const deliveries=await Promise.all(Array.from({length:3},async()=>{const r=await request(grant.url);assert.equal(r.status,200);await r.arrayBuffer();}));
  await wait(async()=> (await db.select().from(downloadHistory).where(eq(downloadHistory.userId,a.id))).length===1);
  assert.equal((await storage.getMediaItem(photo.id)).downloadCount,1);
  assert.equal((await (await request("/api/account/downloads","GET",b)).json()).items.length,0);
  const next=await (await request(path,"POST")).json();await (await request(next.url)).arrayBuffer();
  await wait(async()=> (await storage.getMediaItem(photo.id)).downloadCount===2);
  assert.equal((await (await request("/api/account/downloads")).json()).items.length,2);
  await (await request(`/api/media/legacy/${photo.id}/thumbnail`)).arrayBuffer();
  await (await request(`/api/media/legacy/${photo.id}/file`)).arrayBuffer();
  assert.equal((await storage.getMediaItem(photo.id)).downloadCount,2);
  await db.update(events).set({adminHidden:true}).where(eq(events.id,album.id));
  assert.equal((await (await request("/api/account/downloads")).json()).items.length,0);
  await db.update(events).set({adminHidden:false}).where(eq(events.id,album.id));
});
test("failed and aborted streams never enter history",async()=>{
  const item=await storage.createMediaItem({eventId:album.id,type:"video",url:`/api/media/files/media-${randomUUID()}.mp4`,thumbnail:image,tags:[]});
  const original=Client.prototype.downloadAsStream;let stream;
  try {
    Client.prototype.downloadAsStream=()=>new Readable({read(){this.destroy(new Error("Synthetic failure"));}});
    // pipeline destroys the destination on source failure; either a 502 or a
    // closed connection is legitimate, but neither may become history.
    try {const failed=await request(`/api/media/${item.id}/download`);assert.equal(failed.status,502);}
    catch(error){assert.match(error.message,/fetch failed/);}
    Client.prototype.downloadAsStream=()=>{stream=Readable.from((async function*(){for(let i=0;i<150;i++){await new Promise(r=>setTimeout(r,10));yield Buffer.alloc(65536);}})());return stream;};
    const r=await request(`/api/media/${item.id}/download`);const reader=r.body.getReader();await reader.read();await reader.cancel();
    await wait(()=>stream.destroyed);
    assert.equal((await db.select().from(downloadHistory).where(eq(downloadHistory.mediaId,item.id))).length,0);
    assert.equal((await storage.getMediaItem(item.id)).downloadCount,0);
  } finally {Client.prototype.downloadAsStream=original;}
});
test("caption dates are English and tags/lineups never become depicted identities",()=>{
  assert.equal(communityCaption(community),"Community fixture · Fixture circuit · 10 October 2026");
});
test("profile editing is moderated and cannot change roles, credits, other accounts or external pictures",async()=>{
  const name=`profile-${token}`;
  assert.equal((await request("/api/account/profile","PATCH",a,{username:name,bio:"Hello",isAdmin:true})).status,400);
  assert.equal((await request("/api/account/profile","PATCH",a,{username:name,bio:"Hello",profileImage:"https://example.test/private.jpg"})).status,400);
  const result=await request("/api/account/profile","PATCH",a,{username:name,bio:"Fixture biography"});
  assert.equal(result.status,200);const updated=await result.json();
  assert.equal(updated.username,name);assert.equal(updated.isAdmin,false);assert.equal(updated.credits,a.credits);
  assert.equal(updated.password,undefined);assert.equal((await storage.getUser(b.id)).username,b.username);
  assert.equal((await request("/api/account/profile","PATCH",null,{username:name,bio:"Hello"})).status,401);
  const blocked=await request("/api/account/profile","PATCH",a,{username:name,bio:`Synthetic rejection ${token}`});
  assert.equal(blocked.status,400);assert.equal((await storage.getUser(a.id)).bio,"Fixture biography");
  const avatar=await request("/api/account/profile","PATCH",a,{username:name,bio:`Photo fixture ${token}`,profileImage:image});
  assert.equal(avatar.status,200);const avatarUser=await avatar.json();
  assert.match(avatarUser.profileImage,/^data:image\/webp;base64,/);assert.equal(avatarUser.profileImagePublic,true);
  const removal=await request("/api/account/profile","PATCH",a,{username:name,bio:`Photo removed ${token}`,profileImage:null});
  assert.equal(removal.status,200);assert.equal((await removal.json()).profileImage,null);
  // Restore the test queue owner name before scoped processing.
  await db.update(users).set({username:a.username,bio:a.bio}).where(eq(users.id,a.id));
});
test("favorites filter quarantined items before pagination, never expose another account's saved list",async()=>{
  const batch=await db.insert(mediaItems).values(Array.from({length:28},(_,i)=>({
    eventId:community.id,type:"image",url:image,thumbnail:image,caption:`Paged fixture ${i}`,
    safetyStatus:i<2?"blocked":"legacy",
  }))).returning();
  await db.insert(communityFavorites).values(batch.map(item=>({userId:b.id,mediaId:item.id})));
  const first=await (await request("/api/account/favorites","GET",b)).json();
  assert.equal(first.items.length,24);assert.equal(first.hasMore,true);
  const next=await (await request("/api/account/favorites?page=2","GET",b)).json();
  assert.equal(next.items.length,2);assert.equal(next.hasMore,false);
  assert.equal(new Set([...first.items,...next.items].map(item=>item.id)).size,26);
  assert.ok([...first.items,...next.items].every(item=>!batch.slice(0,2).some(hidden=>hidden.id===item.id)));
  const other=await (await request("/api/account/favorites","GET",a)).json();
  assert.ok(other.items.every(item=>!batch.some(saved=>saved.id===item.id)));
});
test("new community captions are automatic, safety-versioned; history/import and concurrent empty manual text survive",async()=>{
  async function queued(source,caption=""){
    const item=await storage.createMediaItem({eventId:community.id,type:"image",url:image,thumbnail:image,tags:[],caption});
    await db.update(mediaItems).set({captionSource:source}).where(eq(mediaItems.id,item.id));
    await db.insert(mediaAnalysisJobs).values({mediaId:item.id,fingerprint:"tags:"+analysisFingerprint(item.thumbnail)});
    return item;
  }
  const automatic=await queued("auto_pending");await drainAnalysisQueue();
  const result=await storage.getMediaItem(automatic.id);
  assert.equal(result.caption,communityCaption(community));assert.equal(result.captionSource,"automatic");
  assert.equal(result.safetyStatus,"approved");assert.equal(result.contentVersion,result.safetyVersion);
  assert.doesNotMatch(result.caption,/Porsche|Fictional Driver/);
  // Without verification configuration, even checked metadata cannot publish.
  assert.equal((await request(`/api/community/media/${automatic.id}`)).status,404);
  const historical=await queued("preserved","IPTC text");await drainAnalysisQueue();
  assert.equal((await storage.getMediaItem(historical.id)).caption,"IPTC text");
  const raced=await queued("auto_pending");
  let release;holdAnalysis=new Promise(r=>{release=r;});
  const reached=new Promise(r=>{enteredAnalysis=r;});
  const work=drainAnalysisQueue();await reached;
  await storage.updateMediaItem(raced.id,{caption:""});
  release();await work;holdAnalysis=undefined;
  assert.equal((await storage.getMediaItem(raced.id)).caption,"");
  assert.equal((await storage.getMediaItem(raced.id)).captionSource,"manual");
});
test("deletion cascades references and histories without media copies",async()=>{
  const disposable=await storage.createMediaItem({eventId:album.id,type:"image",url:image,thumbnail:image,tags:[]});
  await request(`/api/community/media/${disposable.id}/like`,"PUT");
  await request(`/api/community/media/${disposable.id}/favorite`,"PUT");
  await recordDownload(a.id,disposable.id,"high",randomUUID());
  await storage.deleteMediaItem(disposable.id);
  for(const table of [communityLikes,communityFavorites,downloadHistory])
    assert.equal((await db.select().from(table).where(eq(table.mediaId,disposable.id))).length,0);
});
