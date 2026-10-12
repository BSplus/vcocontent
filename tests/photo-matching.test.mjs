import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import express from "express";
import sharp from "sharp";
import {eq,inArray,sql} from "drizzle-orm";
import {db,pool} from "../server/db.ts";
import {events,users,series,mediaItems,mediaAnalysisJobs,eventEntries,referenceDocuments,mediaReservations,nextcloudJobs,nextcloudFiles} from "../shared/schema.ts";
import {storage} from "../server/storage.ts";
import {registerRoutes} from "../server/routes.ts";
import {stopImportWorker} from "../server/nextcloud.ts";
import {analysisStatus,enqueueAnalysis,drainAnalysisQueue,setAnalysisQueueTestScope,stopAnalysisWorker,itemAnalysisFingerprint} from "../server/analysis-jobs.ts";
import {matchedPhotoCaption} from "../server/caption-proposal.ts";
import {matchReferences} from "../server/reference-matching.ts";

const realFetch=globalThis.fetch;
const eventIds=[],userIds=[],seriesIds=[];
let server,base,admin,owner,other,calls=0,auditCalls=0,gate,entered,providerFailure=false,visionVehicle="",visionNumber="007",auditNumber="007";
const image="data:image/webp;base64,"+(await sharp({create:{width:32,height:32,channels:3,background:"green"}}).webp().toBuffer()).toString("base64");
const visible={number:"007",vehicleRegion:[0,0,1000,1000],team:"",drivers:"",vehicle:"",manufacturer:"",racingClass:"",discipline:"",source:"visual"};
const entry={number:"7",team:"Apex",car:"Prototype",drivers:"Registered One; Registered Two",manufacturer:"",racingClass:"",discipline:""};
const wait=async fn=>{
  for(let i=0;i<300;i++){if(await fn()) return;await new Promise(r=>setTimeout(r,20));}
  throw new Error("Fixture analysis did not settle");
};
const api=(path,body,role="admin",method=body===undefined?"GET":"POST")=>realFetch(base+path,{
  method,headers:{"Content-Type":"application/json","x-fixture-role":role},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function album(enabled=true,creatorId=null) {
  const [s]=await db.insert(series).values({name:"IMSA Esports Global Championship 2026",creatorId}).returning();seriesIds.push(s.id);
  const [e]=await db.insert(events).values({title:"IMSA Esports Global Championship 2026, Round 2",
    description:"Development-only fixture, not production Event 224",date:new Date("2026-09-20T12:00:00Z"),
    round:"2",track:"Sebring International Raceway",seriesId:s.id,creatorId,photoMatchingEnabled:enabled,platform:"iRacing"}).returning();
  eventIds.push(e.id);
  await db.insert(eventEntries).values(Array.from({length:52},(_,i)=>({...entry,eventId:e.id,number:String(i+1),
    ...(i===6?{}:{team:`Other team ${i+1}`,drivers:"Other lineup"})})));
  return e;
}
async function photo(event,extra={}) {
  const [p]=await db.insert(mediaItems).values({eventId:event.id,type:"image",url:image,thumbnail:image,
    caption:"",captionSource:extra.caption ? "preserved" : "auto_pending",tags:[],...extra}).returning();return p;
}
const settled=async id=>{
  await wait(async()=>{await drainAnalysisQueue();return (await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,id)))[0]?.status==="completed";});
  return storage.getMediaItem(id);
};
test.before(async()=>{
  for(const role of ["admin","owner","other"]){
    const [u]=await db.insert(users).values({username:`photo-fixture-${randomUUID()}`,email:`${randomUUID()}@example.invalid`,
      password:"fixture-not-login",isAdmin:role==="admin",isCreator:role!=="admin",creatorStatus:"approved",quotaException:true}).returning();
    userIds.push(u.id);if(role==="admin")admin=u;else if(role==="owner")owner=u;else other=u;
  }
  setAnalysisQueueTestScope([owner.username,other.username],[]);
  // No real provider request can escape this test process.
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL="https://photo-fixture.example.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY="fixture-only";
  globalThis.fetch=async(url,options)=>{
    if(!String(url).startsWith("https://photo-fixture.example.invalid/"))return realFetch(url,options);
    const body=JSON.parse(options.body);
    if(body.messages[0].content.includes("publication safety reviewer"))return new Response(JSON.stringify({choices:[{finish_reason:"stop",
      message:{content:JSON.stringify({sexualized:"clear",pornography:"clear",racistOrDehumanizing:"clear",hateSymbolsOrGlorification:"clear",visibleTextAndSymbolsReviewed:true})}}]}));
    if(body.messages[0].content.includes("Independently inspect the full image")) {
      auditCalls++;
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        fullImageReadings:auditNumber?[{number:auditNumber,vehicleRegion:[0,0,1000,1000],panelRegion:[250,250,300,300]}]:[],
        vehicleReadings:auditNumber?[{vehicleIndex:0,number:auditNumber}]:[],
      })}}]}),{headers:{"Content-Type":"application/json"}});
    }
    if(body.messages[0].content.includes("Localize complete"))return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
      vehicles:[{number:visionNumber,vehicleRegion:[0,0,1000,1000]}],scene:"Race Action",
    })}}]}),{headers:{"Content-Type":"application/json"}});
    calls++;entered?.();if(gate)await gate;
    if(providerFailure)throw new Error("fixture-private-provider-payload");
    const structured=body.messages[0].content.includes("vehicles:");
    return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:structured
      ?JSON.stringify({tags:["Race Car","Day"],vehicles:[{...visible,number:visionNumber,vehicle:visionVehicle,numberReadable:true}]})
      :"Race Car, Day"}}]}),{headers:{"Content-Type":"application/json"}});
  };
  const app=express();app.use(express.json());app.use((req,_res,next)=>{
    req.user={admin,owner,other}[req.headers["x-fixture-role"]];req.isAuthenticated=()=>!!req.user;next();
  });
  server=await registerRoutes(app,{workers:false});
  server.listen(0,"127.0.0.1");await once(server,"listening");base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async()=>{
  await stopImportWorker();await stopAnalysisWorker();server?.close();if(server?.listening)await once(server,"close");
  await db.delete(mediaItems).where(inArray(mediaItems.eventId,eventIds));
  await db.delete(events).where(inArray(events.id,eventIds));
  await db.delete(referenceDocuments).where(inArray(referenceDocuments.ownerId,userIds));
  await db.delete(series).where(inArray(series.id,seriesIds));
  await db.delete(users).where(inArray(users.id,userIds));
  globalThis.fetch=realFetch;await pool.end();
});
function scope(photos){setAnalysisQueueTestScope([owner.username,other.username],photos.map(p=>p.id));}

test("default off, authorization and opt-in alone never analyse history",async()=>{
  const e=await album(false);const p=await photo(e,{caption:"587.jpg"});
  scope([p]);
  assert.equal(e.photoMatchingEnabled,false);
  assert.equal((await api(`/api/events/${e.id}/photo-matching`,undefined,"other")).status,403);
  assert.equal((await api(`/api/events/${e.id}/photo-matching`,undefined,"anonymous")).status,401);
  assert.equal((await api(`/api/events/${e.id}/photo-matching`,{enabled:true,platform:null},"admin","PATCH")).status,200);
  assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id))).length,0);
  assert.equal((await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:[p.id],confirmed:false})).status,400);
  await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:[p.id],confirmed:true,replacePreservedIds:[p.id]});
  const done=await settled(p.id);
  assert.match(done.caption,/Apex/);assert.doesNotMatch(done.caption,/iRacing/);
});

test("four completed tags-only historical photos upgrade only explicitly selected preserved captions",async()=>{
  const e=await album();const photos=await Promise.all([587,588,589,590].map(i=>photo(e,{caption:`${i}.jpg`,captionSource:"preserved",manualTags:["Helmet"],tags:["Helmet"]})));
  scope(photos);
  for(const p of photos)await db.insert(mediaAnalysisJobs).values({mediaId:p.id,fingerprint:itemAnalysisFingerprint(p),status:"completed",generatedTags:["Day"]});
  const before=calls;
  const response=await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:photos.map(p=>p.id),confirmed:true,
    replacePreservedIds:photos.slice(0,2).map(p=>p.id)});
  assert.equal(response.status,202);
  for(const p of photos)await settled(p.id);
  assert.equal(calls-before,4);
  for(let i=0;i<photos.length;i++){
    const saved=await storage.getMediaItem(photos[i].id);
    assert.equal(saved.identification[0].team,"Apex");assert.ok(saved.tags.includes("Helmet"));
    if(i<2){assert.equal(saved.captionSource,"photo_automatic");assert.match(saved.caption,/#007 Apex/);
      assert.match(saved.caption,/#007 Apex — Prototype — Registered One; Registered Two$/);
      assert.doesNotMatch(saved.caption,/Registered lineup:|registered Line-up/i);
      for(const text of ["iRacing","IMSA","Round 2","Sebring","20 September 2026"])assert.ok(saved.caption.includes(text));}
    else assert.equal(saved.caption,`${587+i}.jpg`);
  }
  await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:photos.map(p=>p.id),confirmed:true,replacePreservedIds:[]});
  for(const p of photos)await settled(p.id);
  assert.equal(calls-before,4,"repeat requests must not send more Vision requests");
  await enqueueAnalysis(photos[0]);await settled(photos[0].id);
  assert.equal(calls-before,4,"duplicate import enqueue must not downgrade structured recognition");
  // Correct references, then revise context; both reuse the recognition.
  await storage.replaceEventEntries(e.id,[{...entry,team:"Corrected Team",drivers:"Corrected Registered Lineup"}]);
  for(const p of photos)await settled(p.id);
  assert.equal(calls-before,4);
  assert.match((await storage.getMediaItem(photos[0].id)).caption,/Corrected Team/);
  assert.equal((await storage.getMediaItem(photos[2].id)).caption,"589.jpg");
  await storage.updateEvent(e.id,{platform:"ACC",track:"Corrected Track",round:"3"});
  for(const p of photos)await settled(p.id);
  assert.match((await storage.getMediaItem(photos[0].id)).caption,/ACC.*Round 3.*Corrected Track/);
  assert.equal(calls-before,4);
  const publicPhotos=await (await api(`/api/events/${e.id}/media`,undefined,"anonymous")).json();
  assert.equal(publicPhotos.find(p=>p.id===photos[0].id).caption,(await storage.getMediaItem(photos[0].id)).caption);
});

test("manual empty/editorial captions and identifications remain protected, even with replacement request",async()=>{
  const e=await album(true,owner.id);
  const ps=await Promise.all([
    photo(e,{caption:"",captionSource:"manual"}),
    photo(e,{caption:"IPTC text",captionSource:"preserved"}),
    photo(e,{caption:"Editorial Registered lineup: original text",captionSource:"manual"}),
    photo(e,{caption:"Manual identity",identificationManual:true,identification:[{...visible,team:"Human team",source:"manual"}]}),
    photo(e,{caption:"",captionSource:"preserved"}),
    photo(e,{caption:"Registered lineup: Original; Lineup",captionSource:"preserved"}),
  ]);
  scope(ps);
  const res=await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:ps.map(p=>p.id),confirmed:true,
    replacePreservedIds:[ps[0].id,ps[2].id,ps[3].id]},"owner");
  assert.equal(res.status,202);assert.equal((await res.json()).results.find(r=>r.id===ps[3].id).status,"skipped");
  for(const p of ps.slice(0,3)){const done=await settled(p.id);assert.equal(done.caption,p.caption);}
  assert.equal((await storage.getMediaItem(ps[3].id)).identification[0].team,"Human team");
  assert.equal((await settled(ps[4].id)).caption,"","historical empty preserved text also requires individual consent");
  assert.equal((await settled(ps[5].id)).caption,ps[5].caption,"stored lineup labels are not cleaned up");
  const before=calls;
  await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:[ps[4].id],confirmed:true,replacePreservedIds:[ps[4].id]},"owner");
  assert.match((await settled(ps[4].id)).caption,/#007 Apex/);
  assert.equal(calls,before,"confirmed historical replacement reuses saved observations");
});

test("reading stored captions never cleans up lineup labels; future caption previews use plain complete names",async()=>{
  const e=await album(),p=await photo(e);scope([p]);
  await enqueueAnalysis(p);const generated=await settled(p.id);
  const before=calls,audits=auditCalls;
  for(const captionSource of ["photo_automatic","preserved","manual"]){
    const caption="Historical Registered lineup: Original One / Original Two";
    await db.update(mediaItems).set({caption,captionSource}).where(eq(mediaItems.id,p.id));
    const gallery=await (await api(`/api/events/${e.id}/media`,undefined,"anonymous")).json();
    assert.equal(gallery.find(row=>row.id===p.id).caption,caption);
    const detail=await (await api(`/api/media/${p.id}`,undefined,"anonymous")).json();
    assert.equal(detail.caption,caption);
    const preview=await api(`/api/media/${p.id}/caption-preview`,{});
    assert.equal(preview.status,200);
    assert.match((await preview.json()).suggestion,/#007 Apex — Prototype — Registered One; Registered Two$/);
    assert.equal((await storage.getMediaItem(p.id)).caption,caption,"suggestions do not save or clean up history");
  }
  assert.match(generated.caption,/#007 Apex — Prototype — Registered One; Registered Two$/);
  assert.equal(calls,before);assert.equal(auditCalls,audits);
});

test("upload and Nextcloud initial jobs honour opt-in, placeholders and upload AI decision",async()=>{
  for(const enabled of [false,true]){
    const e=await album(enabled);
    const token=randomUUID();
    await db.insert(nextcloudJobs).values({eventId:e.id,status:"running",workerToken:token});
    const [file]=await db.insert(nextcloudFiles).values({eventId:e.id,name:"new.jpg",sourceKey:randomUUID()}).returning();
    for(const kind of ["upload","nextcloud","declined"]){
      const rid=randomUUID();
      await db.insert(mediaReservations).values({id:rid,eventId:e.id,reservedBytes:1,storageKey:`fixture-${rid}`,thumbnailKey:`fixture-${rid}`});
      const p=await storage.finishMedia(rid,{eventId:e.id,type:"image",url:image,thumbnail:image,caption:kind==="nextcloud"?"new.jpg":"",tags:[]},
        kind==="nextcloud"?file.id:undefined,kind==="nextcloud"?token:undefined,kind!=="declined");
      scope([p]);
      if(kind==="declined"){assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id))).length,0);continue;}
      const [job]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id));
      assert.equal(job.fingerprint.startsWith(enabled?"recognition:":"tags:"),true);
      if(kind==="nextcloud")assert.equal(p.captionSource,"nextcloud_placeholder");
      const done=await settled(p.id);
      if(enabled){assert.equal(done.photoMatchStatus,"matched");assert.match(done.caption,/Apex/);}
      else {assert.deepEqual(done.identification,[]);assert.equal(done.caption,kind==="nextcloud"?"new.jpg":"");}
      await enqueueAnalysis(done);await settled(p.id);
      assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id)))[0].fingerprint,job.fingerprint);
    }
  }
});

test("disable during provider response fences late results; re-enable reuses recognition safely",async()=>{
  const e=await album();const p=await photo(e);scope([p]);
  let release;gate=new Promise(r=>release=r);const started=new Promise(r=>entered=r);
  await enqueueAnalysis(p);await started;
  assert.equal((await api(`/api/events/${e.id}/photo-matching`,{enabled:false,platform:"iRacing"},"admin","PATCH")).status,200);
  release();gate=undefined;entered=undefined;await settled(p.id);
  assert.equal((await storage.getMediaItem(p.id)).caption,"");assert.deepEqual((await storage.getMediaItem(p.id)).identification,[]);
  const before=calls;
  await api(`/api/events/${e.id}/photo-matching`,{enabled:true,platform:"iRacing"},"admin","PATCH");
  await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:[p.id],confirmed:true});await settled(p.id);
  assert.equal(calls,before);assert.match((await storage.getMediaItem(p.id)).caption,/Apex/);
});

test("parallel editor changes and running tags upgrade are fenced without overwriting manual state",async()=>{
  const e=await album(false);const p=await photo(e,{caption:"original.jpg"});scope([p]);
  let release;gate=new Promise(r=>release=r);const started=new Promise(r=>entered=r);
  await enqueueAnalysis(p);await started;
  await api(`/api/events/${e.id}/photo-matching`,{enabled:true,platform:null},"admin","PATCH");
  await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:[p.id],confirmed:true,replacePreservedIds:[p.id]});
  assert.equal((await api(`/api/media/${p.id}`,{caption:"Editor's new text",tags:["Trophy"]},"admin","PUT")).status,200);
  release();gate=undefined;entered=undefined;
  const done=await settled(p.id);
  assert.equal(done.caption,"Editor's new text");assert.equal(done.captionSource,"manual");assert.ok(done.tags.includes("Trophy"));
  const [job]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id));
  assert.ok(job.fingerprint.startsWith("recognition:"));assert.equal(job.status,"completed");
});

test("conservative multi-car captions and conflicts, season/session/owner boundaries",async()=>{
  const e=await album(true,owner.id);const p=await photo(e);scope([p]);
  await db.delete(eventEntries).where(eq(eventEntries.eventId,e.id));
  await db.insert(referenceDocuments).values({eventId:null,seriesId:e.seriesId,ownerId:other.id,seasonYear:2026,scope:"season",kind:"entry",
    title:"Foreign owner",fingerprint:randomUUID(),identityKey:randomUUID(),rows:[entry]});
  await db.insert(referenceDocuments).values({eventId:e.id,seriesId:e.seriesId,ownerId:owner.id,seasonYear:2026,scope:"event",kind:"result",
    session:"Race 2",title:"Session only",fingerprint:randomUUID(),identityKey:randomUUID(),rows:[entry]});
  await enqueueAnalysis(p);let saved=await settled(p.id);
  assert.equal(saved.photoMatchStatus,"no_unique_match");assert.doesNotMatch(saved.caption,/Apex|Registered lineup/);
  const before=calls;
  assert.equal((await api(`/api/media/${p.id}`,{recognitionSession:"Race 2"},"owner","PUT")).status,200);
  saved=await settled(p.id);assert.equal(saved.photoMatchStatus,"matched");assert.equal(calls,before);
  const doc={scope:"event",kind:"entry",session:null,updatedAt:new Date(),rows:[entry,{...entry,team:"Conflicting team"}]};
  const matched=matchReferences([visible],[doc],null,e.title,true);
  assert.equal(matchedPhotoCaption(e,null,matched).matchStatus,"no_unique_match");
  const identified={...visible,team:"Apex",drivers:"Registered One",source:"reference"};
  assert.match(matchedPhotoCaption(e,null,[identified,{...identified,number:"008",team:"Second Team"}]).caption,/#008 Second Team/);
  assert.equal(matchedPhotoCaption(e,null,[identified,visible]).matchStatus,"no_unique_match");
  assert.equal(matchedPhotoCaption({...e,platform:null},null,[]).caption.includes("undefined"),false);
});

test("bounded requests and provider errors stay visible without revealing provider payloads",async()=>{
  const e=await album();const p=await photo(e,{caption:"Protected editorial text"});scope([p]);
  assert.equal((await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:Array(51).fill(p.id),confirmed:true})).status,400);
  assert.equal((await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:[p.id],replacePreservedIds:[999999],confirmed:true})).status,400);
  providerFailure=true;
  await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:[p.id],confirmed:true});
  for(let attempt=1;attempt<=3;attempt++){
    await wait(async()=>{
      const [job]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id));
      return job?.attempts>=attempt && job.status!=="running";
    });
    if(attempt<3){
      await db.update(mediaAnalysisJobs).set({availableAt:new Date(0)}).where(eq(mediaAnalysisJobs.mediaId,p.id));
      await drainAnalysisQueue();
    }
  }
  providerFailure=false;
  const state=await (await api(`/api/events/${e.id}/photo-matching`)).json();
  assert.equal(state.photos[0].status,"failed");assert.match(state.photos[0].error,/retry/i);
  assert.ok(!JSON.stringify(state).includes("fixture-private-provider-payload"));
  assert.equal((await storage.getMediaItem(p.id)).caption,"Protected editorial text");
});

test("readable numbers with contradictory vehicles save context only, while generic/subset descriptions remain compatible",async()=>{
  const e=await album();const p=await photo(e);scope([p]);
  await db.update(eventEntries).set({car:"BMW M4 GT3"}).where(eq(eventEntries.eventId,e.id));
  visionVehicle="Porsche 911 GT3 R";
  try {
    await enqueueAnalysis(p);const saved=await settled(p.id);
    assert.equal(saved.photoMatchStatus,"no_unique_match");
    assert.equal(saved.identification[0].source,"visual");
    assert.equal(saved.identification[0].vehicle,visionVehicle);
    assert.equal(saved.identification[0].drivers,"");
    assert.doesNotMatch(saved.caption,/BMW|Porsche|Apex|Registered lineup/);
    assert.match(saved.caption,/Sebring/);
  } finally {visionVehicle="";}
  const doc={scope:"event",kind:"entry",session:null,updatedAt:new Date(),rows:[{...entry,car:"BMW M4 GT3"}]};
  for(const vehicle of ["Race Car","GT3 car","M4 GT3","BMW M4 GT3 EVO","bmw-m4 gt3"]){
    assert.equal(matchReferences([{...visible,vehicle}],[doc],null,e.title,true)[0].source,"reference",vehicle);
  }
  for(const vehicle of ["Porsche 911 GT3 R","BMW M6 GT3"]){
    const result=matchReferences([{...visible,vehicle}],[doc],null,e.title,true);
    assert.equal(matchedPhotoCaption(e,null,result).matchStatus,"no_unique_match",vehicle);
  }
});

test("queued opt-out work does not call Vision, and older photos remain selectable by page",async()=>{
  const e=await album();const p=await photo(e,{caption:"fixture.jpg"});scope([p]);
  await db.insert(mediaAnalysisJobs).values({mediaId:p.id,fingerprint:itemAnalysisFingerprint(p),status:"completed",generatedTags:["Day"]});
  await db.update(mediaAnalysisJobs).set({status:"queued",photoWorkflow:true,recognition:null,
    photoMatchingRevision:e.photoMatchingRevision,fingerprint:itemAnalysisFingerprint(p,true)})
    .where(eq(mediaAnalysisJobs.mediaId,p.id));
  const before=calls;
  assert.equal((await api(`/api/events/${e.id}/photo-matching`,{enabled:false,platform:null},"admin","PATCH")).status,200);
  await wait(async()=>(await analysisStatus(p.id)).status==="completed");
  assert.equal(calls,before);assert.equal((await storage.getMediaItem(p.id)).caption,"fixture.jpg");
  scope([]);
  await db.insert(mediaItems).values(Array.from({length:501},(_,i)=>({
    eventId:e.id,type:"image",caption:`Page fixture ${i}`,url:image,thumbnail:image,tags:[],
  })));
  const first=await (await api(`/api/events/${e.id}/photo-matching`)).json();
  assert.equal(first.photos.length,500);assert.ok(first.nextCursor);
  assert.equal(first.page,1);assert.equal(first.totalPages,2);assert.equal(first.total,502);
  const second=await (await api(`/api/events/${e.id}/photo-matching?before=${first.nextCursor}`)).json();
  assert.ok(second.photos.some(photo=>photo.id===p.id));assert.equal(second.nextCursor,null);
  assert.equal(second.page,2);assert.equal(second.totalPages,2);assert.equal(second.hasMore,false);
  assert.equal((await api(`/api/events/${e.id}/photo-matching?before=invalid`)).status,400);
});

test("both photo paths and legacy reuse suppress the Verstap false match",async()=>{
  for (const workflow of [false,true]) {
    const e=await album(workflow);
    await storage.replaceEventEntries(e.id,[{...entry,number:"1",team:"BMW M Verstappen Sim Racing"}]);
    const p=await photo(e,{caption:"Protected editorial text",tags:["Helmet"],manualTags:["Helmet"]});scope([p]);
    const falseIdentity={...visible,number:"01",team:"BMW M Verstappen Sim Racing",
      drivers:entry.drivers,source:"reference"};
    await db.update(mediaItems).set({identification:[falseIdentity]}).where(eq(mediaItems.id,p.id));
    const search=async()=> (await (await api("/api/media?q=verstap&fields=identification",undefined,"anonymous")).json()).filter(r=>r.id===p.id);
    assert.equal((await search()).length,1,"reproduced false hit before isolated correction");
    visionNumber="01";auditNumber="";
    try {
      const beforeAudits=auditCalls;
      const res=workflow
        ? await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:[p.id],confirmed:true})
        : await api(`/api/media/${p.id}/analyze`,{reanalyse:true});
      assert.equal(res.status,202);
      const saved=await settled(p.id);
      assert.equal(saved.identification[0].number,"");
      assert.equal(saved.identification[0].team,"");
      assert.equal(saved.identification[0].drivers,"");
      assert.equal(saved.identification[0].source,"visual");
      assert.equal(saved.caption,p.caption);assert.ok(saved.tags.includes("Helmet"));
      assert.equal((await search()).length,0);
      assert.equal(auditCalls-beforeAudits,1,"empty independent reading does not need a crop request");
      // Historical readable=true did not retain audit provenance. Reuse only
      // local data during a reference correction, without silently reanalysing.
      await db.update(mediaAnalysisJobs).set({recognition:[{...visible,number:"01"}]})
        .where(eq(mediaAnalysisJobs.mediaId,p.id));
      await db.update(mediaItems).set({identification:[falseIdentity]}).where(eq(mediaItems.id,p.id));
      const before=calls, audits=auditCalls;
      await storage.replaceEventEntries(e.id,[{...entry,number:"1",team:"BMW M Verstappen Sim Racing"}]);
      const rematched=await settled(p.id);
      assert.equal(rematched.identification[0].number,"");assert.equal(rematched.identification[0].drivers,"");
      assert.equal((await search()).length,0);
      assert.equal(calls,before);assert.equal(auditCalls,audits);
      const preview=await api(`/api/media/${p.id}/caption-preview`,{});
      assert.equal(preview.status,200);
      assert.doesNotMatch(JSON.stringify(await preview.json()),/Verstappen|Registered One/);
    } finally {visionNumber="007";auditNumber="007";}
  }
});
