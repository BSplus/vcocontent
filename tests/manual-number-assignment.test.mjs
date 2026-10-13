import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import sharp from "sharp";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../server/db.ts";
import { users, events, series, mediaItems, eventEntries, referenceDocuments, mediaAnalysisJobs } from "../shared/schema.ts";
import { registerManualNumberRoutes } from "../server/manual-number-routes.ts";
import { manualNumberOptions, assignedIdentifications } from "../server/manual-number-options.ts";
import { matchedPhotoCaption } from "../server/caption-proposal.ts";
import { drainAnalysisQueue, setAnalysisQueueTestScope, itemAnalysisFingerprint } from "../server/analysis-jobs.ts";
import { storage } from "../server/storage.ts";
import { mediaPublic } from "../server/beta-access.ts";

const fixture = randomUUID();
const eventIds=[], userIds=[], seriesIds=[];
const row = (number="007",team="Apex",extra={}) => ({number,team,car:"Prototype",drivers:"One; Two",
  manufacturer:"Maker",racingClass:"GTP",discipline:"Endurance",...extra});
const ident = (number="99") => ({number,team:"Keep team",vehicle:"Keep car",drivers:"Keep lineup",
  manufacturer:"",racingClass:"",discipline:"",source:"manual"});
let server,base,admin,owner,other;
const realFetch=globalThis.fetch;
let providerEntered,releaseProvider,providerCalls=0;
const image="data:image/webp;base64,"+(await sharp({create:{width:32,height:32,channels:3,background:"green"}}).webp().toBuffer()).toString("base64");
const request = (id,body,role="admin",suffix=body ? "assign-number" : "number-options") => fetch(`${base}/api/media/${id}/${suffix}`,{
  method:body ? "POST" : "GET",headers:{"Content-Type":"application/json","x-fixture-role":role},
  ...(body ? {body:JSON.stringify(body)} : {})});
async function album(creatorId=null,extra={}) {
  const [s]=await db.insert(series).values({name:`Fixture series ${fixture}`,creatorId}).returning();
  seriesIds.push(s.id);
  const [e]=await db.insert(events).values({title:"Fixture race",description:"Disposable test only",date:new Date("2026-08-03"),
    seriesId:s.id,creatorId,platform:"Fixture platform",track:"Fixture track",round:"2",...extra}).returning();
  eventIds.push(e.id); return e;
}
async function photo(event,extra={}) {
  const [m]=await db.insert(mediaItems).values({eventId:event.id,type:"image",url:"/fixture/photo.webp",
    thumbnail:"/fixture/thumb.webp",caption:"",captionSource:"auto_pending",tags:["Keep tag"],
    photographer:"Keep credit",...extra}).returning(); return m;
}
async function doc(event,rows,extra={}) {
  const key=randomUUID();
  return (await db.insert(referenceDocuments).values({eventId:event.id,seriesId:event.seriesId,
    ownerId:event.creatorId,seasonYear:2026,scope:"event",kind:"entry",session:null,title:"Saved entries",
    fingerprint:key,identityKey:key,rows,...extra}).returning())[0];
}
async function options(m,role="admin",suffix) {
  const response=await request(m.id,undefined,role,suffix);
  assert.equal(response.status,200); return response.json();
}
async function assign(m,listed,extra={},role="admin") {
  return request(m.id,{snapshot:listed.snapshot,selectionId:listed.options[0]?.id,replaceCaption:false,...extra},role);
}
test.before(async()=>{
  // Never query or mutate the connected database if invoked outside the runner.
  assert.ok(process.env.VCO_TEST_PG_PROXY,"Run with node scripts/test-image-downloads.mjs tests/manual-number-assignment.test.mjs");
  // Static fake process-local configuration; no real secret is read or stored.
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL="https://assignment-fixture.example.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY="fixture-only";
  globalThis.fetch=async(url,init)=>{
    if(String(url).startsWith("http://127.0.0.1:"))return realFetch(url,init);
    providerCalls++;
    if(providerEntered)providerEntered();
    if(releaseProvider)await releaseProvider;
    return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
      tags:["Race Car"],vehicles:[{...ident(""),source:"visual",vehicle:"Other visual car",team:"Other visual team",numberReadable:false}],
    })}}]}),{headers:{"Content-Type":"application/json"}});
  };
  for(const role of ["admin","owner","other"]){
    const [u]=await db.insert(users).values({username:`assign-${role}-${fixture}`,email:`${role}-${fixture}@example.invalid`,
      password:"not-a-login",isAdmin:role==="admin",isCreator:false,creatorStatus:role==="admin"?"none":"approved"}).returning();
    userIds.push(u.id);if(role==="admin")admin=u;else if(role==="owner")owner=u;else other=u;
  }
  const app=express();app.use(express.json());app.use((req,_res,next)=>{
    req.user={admin,owner,other}[req.headers["x-fixture-role"]];req.isAuthenticated=()=>!!req.user;next();
  });
  registerManualNumberRoutes(app);
  server=app.listen(0,"127.0.0.1");await once(server,"listening");base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async()=>{
  if(server){const closed=once(server,"close");server.close();await closed;}
  if(eventIds.length){
    await db.delete(mediaItems).where(inArray(mediaItems.eventId,eventIds));
    await db.delete(events).where(inArray(events.id,eventIds));
    await db.delete(referenceDocuments).where(inArray(referenceDocuments.seriesId,seriesIds));
    await db.delete(series).where(inArray(series.id,seriesIds));
    await db.delete(users).where(inArray(users.id,userIds));
  }
  globalThis.fetch=realFetch;await pool.end();
});

test("admin and approved owner (without role flag), foreign, anonymous and suspended permissions",async()=>{
  const e=await album(owner.id),m=await photo(e);await doc(e,[row()]);
  assert.equal((await request(m.id,undefined,"anonymous")).status,401);
  assert.equal((await request(m.id,undefined,"other")).status,403);
  assert.equal((await options(m,"owner")).options.length,1);
  assert.equal((await options(m)).options.length,1);
  const list=await options(m);
  assert.equal((await assign(m,list,{},"other")).status,403);
  owner.suspended=true;
  assert.equal((await request(m.id,undefined,"owner")).status,403);
  owner.suspended=false;
  assert.equal((await assign(m,list,{},"owner")).status,200);
});
test("absence and invalid numbered rows do not invent choices; legacy entries are available",async()=>{
  const e=await album(),m=await photo(e);
  assert.deepEqual((await options(m)).options,[]);
  await doc(e,[row(""),row("not-a-number")]);
  assert.deepEqual((await options(m)).options,[]);
  await db.insert(eventEntries).values({...row("0042"),eventId:e.id});
  const listed=await options(m);
  assert.equal(listed.options[0].number,"0042");
  assert.match(listed.options[0].contexts[0],/Historical/);
  assert.equal((await assign(m,listed)).status,200);
});
test("season, year, owner, event name and document/row session boundaries plus override priority",async()=>{
  const e=await album(owner.id),m=await photo(e,{recognitionSession:"Race 1"});
  await doc(e,[row("01","Season"),row("2","Wrong race",{eventName:"Other race"}),
    row("3","Wrong row session",{session:"Race 2"}),row("4","Correct row session",{session:"Race 1"})],
  {scope:"season",eventId:null,title:"Season sheet"});
  await doc(e,[row("5","Foreign owner")],{scope:"season",eventId:null,ownerId:other.id});
  await doc(e,[row("6","Wrong year")],{scope:"season",eventId:null,seasonYear:2025});
  await doc(e,[row("7","Wrong document session")],{session:"Race 2"});
  await doc(e,[row("1","Event winner",{drivers:"Event lineup"})]);
  const listed=await options(m,"owner");
  assert.deepEqual(listed.options.map(o=>o.number),["1","4"]);
  assert.equal(listed.options[0].identification.team,"Event winner");
  assert.equal(listed.options[0].identification.drivers,"Event lineup");
  assert.equal((await assign(m,listed,{},"owner")).status,200);
});
test("leading zero conflicts require selecting a real explicit row; complementary duplicate rows merge",async()=>{
  const e=await album(),m=await photo(e);
  await doc(e,[row("7","A"),row("007","B",{car:"GT",drivers:"B only",manufacturer:"B maker"})]);
  let listed=await options(m);
  assert.equal(listed.options.length,2);
  assert.ok(listed.options.every(o=>o.conflict));
  assert.equal((await assign(m,listed,{selectionId:"7"})).status,409);
  const selected=listed.options.find(o=>o.identification.team==="B");
  const saved=await (await assign(m,listed,{selectionId:selected.id})).json();
  assert.equal(saved.identification[0].drivers,"B only");
  assert.equal(saved.identification[0].manufacturer,"B maker");
  assert.equal(saved.identification[0].number,"007");
  const d=await doc(e,[row("12","Same",{drivers:"",manufacturer:""}),row("012","Same",{car:"",drivers:"Registered"})]);
  listed=await options(m);
  const twelve=listed.options.filter(o=>Number(o.number)===12);
  assert.equal(twelve.length,1);assert.equal(twelve[0].conflict,false);
  assert.equal(twelve[0].identification.drivers,"Registered");
});
test("protected manual, imported/editorial and intentionally cleared captions require confirmation",async()=>{
  for(const source of ["manual","preserved","unknown-import"]){
    const e=await album(),m=await photo(e,{caption:source==="manual"?"":"Editorial caption",captionSource:source});
    await doc(e,[row()]);const listed=await options(m);
    assert.equal(listed.replaceCaptionRequired,true);
    assert.equal((await assign(m,listed)).status,409);
    assert.equal((await storage.getMediaItem(m.id)).caption,m.caption);
    const response=await assign(m,listed,{replaceCaption:true});
    assert.equal(response.status,200);const saved=await response.json();
    assert.equal(saved.captionSource,"manual");assert.equal(saved.identificationManual,true);
    assert.equal(saved.caption,listed.options[0].caption);
    assert.match(saved.caption,/#007 Apex — Prototype — One; Two$/);
    assert.doesNotMatch(saved.caption,/Registered lineup:|registered Line-up/i);
    assert.ok(saved.caption.startsWith(`Fixture series ${fixture} · Round 2 · Fixture track · Fixture platform · 3 August 2026 | `));
    assert.ok(!saved.caption.includes("Fixture race"));
  }
});
test("photos/videos correct a single vehicle and preserve other entries, tags and credits; search sees stored identity",async()=>{
  for(const type of ["image","video"]){
    const e=await album(),keep=ident(),m=await photo(e,{type,identification:[ident("10"),keep]});
    await doc(e,[row()]);const listed=await options(m,"admin","number-options?replaceIndex=0");
    const response=await assign(m,listed,{replaceIndex:0});
    assert.equal(response.status,200);const saved=await response.json();
    assert.deepEqual(saved.identification[1],keep);assert.equal(saved.identification[0].source,"manual");
    assert.deepEqual(saved.tags,["Keep tag"]);assert.equal(saved.photographer,"Keep credit");
    assert.match(saved.caption,/#007 Apex/);assert.match(saved.caption,/#99 Keep team/);
    const search=await storage.listPublicMedia(1,48,"Apex",undefined,["identification"]);
    assert.ok(search.some(item=>item.id===m.id));
    assert.equal((await storage.getMediaItems(e.id))[0].caption,saved.caption);
    assert.equal(saved.caption,listed.options[0].caption);
    assert.match(saved.caption,/#007 Apex — Prototype — One; Two/);
    assert.match(saved.caption,/#99 Keep team — Keep car — Keep lineup$/);
  }
});
test("assignment previews and saved captions omit missing drivers and never truncate a complete lineup",async()=>{
  for(const kind of ["missing","overflow"]){
    const e=await album(null,kind==="overflow"?{title:"x".repeat(990),seriesId:null}:{}),m=await photo(e);
    await doc(e,[row("007","Apex",{drivers:kind==="missing"?"":"Complete driver / ".repeat(29)})]);
    const listed=await options(m),preview=listed.options[0].caption;
    if(kind==="missing")assert.match(preview,/#007 Apex — Prototype$/);
    else assert.doesNotMatch(preview,/#007|Complete driver/);
    assert.ok(preview.length<=1000);
    const response=await assign(m,listed);
    assert.equal(response.status,200);
    assert.equal((await response.json()).caption,preview);
    assert.equal((await storage.getMediaItem(m.id)).caption,preview);
  }
});
test("assignment preview and save use title fallback when series is absent or unusable",async()=>{
  for (const mode of ["no-series","blank-series"]) {
    const e=await album(null,{round:"Round 2",track:null,platform:null});
    if(mode==="no-series") {
      await db.update(events).set({seriesId:null}).where(eq(events.id,e.id));e.seriesId=null;
    } else {
      await db.update(series).set({name:"   "}).where(eq(series.id,e.seriesId));
    }
    const m=await photo(e);await doc(e,[row()]);
    const listed=await options(m);
    const expected="Fixture race · Round 2 · 3 August 2026 | #007 Apex — Prototype — One; Two";
    assert.equal(listed.options[0].caption,expected);
    const response=await assign(m,listed);
    assert.equal(response.status,200);
    assert.equal((await response.json()).caption,expected);
  }
});

test("reference edits, deletion, session/context changes and concurrent editor edits reject stale saves",async()=>{
  for(const change of ["reference","delete","session","caption","event","target"]){
    const e=await album(),m=await photo(e,{identification:[ident()]});const d=await doc(e,[row()]);
    const listed=await options(m,"admin","number-options?replaceIndex=0");
    if(change==="reference")await db.update(referenceDocuments).set({rows:[row("007","Changed")]}).where(eq(referenceDocuments.id,d.id));
    if(change==="delete")await db.delete(referenceDocuments).where(eq(referenceDocuments.id,d.id));
    if(change==="session")await db.update(mediaItems).set({recognitionSession:"Different"}).where(eq(mediaItems.id,m.id));
    if(change==="caption")await db.update(mediaItems).set({caption:"Concurrent"}).where(eq(mediaItems.id,m.id));
    if(change==="event")await db.update(events).set({platform:"Changed platform"}).where(eq(events.id,e.id));
    if(change==="target")await db.update(mediaItems).set({identification:[]}).where(eq(mediaItems.id,m.id));
    assert.equal((await assign(m,listed,{replaceIndex:0})).status,409,change);
    assert.equal((await storage.getMediaItem(m.id)).identificationManual,false);
  }
});
test("concurrent assignments do not duplicate a vehicle and reading/cancelling changes nothing",async()=>{
  const e=await album(),m=await photo(e);await doc(e,[row()]);
  const listed=await options(m);
  assert.deepEqual(await storage.getMediaItem(m.id),m);
  const results=await Promise.all([assign(m,listed),assign(m,listed)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await storage.getMediaItem(m.id)).identification.length,1);
});
test("manual assignment works without AI or opt-in, retains creator publication protection",async()=>{
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL="";
  const e=await album(owner.id,{photoMatchingEnabled:false,visibility:"published",safetyStatus:"legacy"});
  const m=await photo(e,{safetyStatus:"legacy"});await doc(e,[row()]);
  const listed=await options(m,"owner");
  const response=await assign(m,listed,{},"owner");assert.equal(response.status,200);
  const saved=await storage.getMediaItem(m.id);
  assert.equal(saved.safetyStatus,"error");assert.equal(saved.contentVersion,m.contentVersion+1);
  assert.equal(await mediaPublic(saved,e),false);
  assert.equal((await storage.getEvent(e.id)).photoMatchingEnabled,false);
  assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,m.id))).length,0);
  assert.equal(providerCalls,0);
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL="https://assignment-fixture.example.invalid/v1";
});
test("a provider result already in flight cannot overwrite a newly assigned number/caption",async()=>{
  const e=await album(null,{photoMatchingEnabled:true}),m=await photo(e,{thumbnail:image,url:image});
  await doc(e,[row()]);setAnalysisQueueTestScope([],[m.id]);
  await db.insert(mediaAnalysisJobs).values({mediaId:m.id,fingerprint:itemAnalysisFingerprint(m,true),status:"queued",
    photoWorkflow:true,photoMatchingRevision:e.photoMatchingRevision});
  const entered=new Promise(resolve=>{providerEntered=resolve;});
  let release;releaseProvider=new Promise(resolve=>{release=resolve;});
  const worker=drainAnalysisQueue();
  try {
    await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Mock provider not reached")),5000).unref())]);
    assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,m.id)))[0].status,"running");
    const listed=await options(m);assert.equal((await assign(m,listed)).status,200);
    const saved=await storage.getMediaItem(m.id);release();await worker;
    const current=await storage.getMediaItem(m.id);
    assert.deepEqual(current.identification,saved.identification);assert.equal(current.caption,saved.caption);
    assert.equal(current.captionSource,"manual");assert.equal(current.identificationManual,true);
    assert.ok(current.tags.includes("Keep tag"));
  } finally {release();await worker;providerEntered=undefined;releaseProvider=undefined;}
});
test("queued/stale photo worker and later reference rematching cannot overwrite manual caption/identification",async()=>{
  const e=await album(null,{photoMatchingEnabled:true}),m=await photo(e);await doc(e,[row()]);
  setAnalysisQueueTestScope([], [m.id]);
  await db.insert(mediaAnalysisJobs).values({mediaId:m.id,fingerprint:itemAnalysisFingerprint(m,true),status:"queued",
    referenceOnly:true,recognition:[{...ident("007"),source:"visual"}],generatedTags:["Day"],photoWorkflow:true,
    photoMatchingRevision:e.photoMatchingRevision});
  const listed=await options(m);assert.equal((await assign(m,listed)).status,200);
  const assigned=await storage.getMediaItem(m.id);
  assert.equal(await drainAnalysisQueue(),true);
  let current=await storage.getMediaItem(m.id);
  assert.deepEqual(current.identification,assigned.identification);assert.equal(current.caption,assigned.caption);
  await db.update(events).set({referenceRevision:sql`${events.referenceRevision}+1`}).where(eq(events.id,e.id));
  assert.equal(await drainAnalysisQueue(),true);
  current=await storage.getMediaItem(m.id);
  assert.deepEqual(current.identification,assigned.identification);assert.equal(current.caption,assigned.caption);
});
test("manual caption omits missing values and visual-only identities, respects text limits",()=>{
  const e={title:"Race",date:new Date("2026-01-01"),round:null,track:null,platform:null};
  const selected={...ident("007"),team:"",vehicle:"",drivers:""};
  const result=matchedPhotoCaption(e,null,[selected,{...ident("88"),source:"visual"}],true);
  assert.match(result.caption,/#007/);assert.doesNotMatch(result.caption,/88|Registered|undefined|null/);
  assert.ok(matchedPhotoCaption({...e,title:"x".repeat(990)},null,[{...ident(),drivers:"x".repeat(500)}],true).caption.length<=1000);
  assert.throws(()=>assignedIdentifications(Array.from({length:12},()=>ident()),selected));
  assert.throws(()=>assignedIdentifications([],selected,0));
});
test("manual resolver ignores irrelevant rows and has stable explicit conflict identities",()=>{
  const docs=[{scope:"season",kind:"entry",title:"Season",session:null,updatedAt:new Date(0),rows:[row("7"),row("007","Other")]}];
  const first=manualNumberOptions(docs,null,"Race"),second=manualNumberOptions(docs,null,"Race");
  assert.deepEqual(first,second);assert.equal(first.length,2);
  assert.deepEqual(manualNumberOptions([{...docs[0],session:"Final"}],null,"Race"),[]);
});
