import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {once} from "node:events";
import express from "express";
import sharp from "sharp";
import {and,eq,inArray,sql} from "drizzle-orm";
import {db,pool} from "../server/db.ts";
import {events,users,series,mediaItems,mediaAnalysisJobs,eventEntries,referenceDocuments,mediaReservations,nextcloudJobs,nextcloudFiles} from "../shared/schema.ts";
import {storage} from "../server/storage.ts";
import {registerRoutes} from "../server/routes.ts";
import {stopImportWorker} from "../server/nextcloud.ts";
import {analysisStatus,enqueueAnalysis,drainAnalysisQueue,reconcileAutomaticPhotos,setAnalysisQueueTestScope,stopAnalysisWorker,itemAnalysisFingerprint} from "../server/analysis-jobs.ts";
import {matchedPhotoCaption} from "../server/caption-proposal.ts";
import {matchReferences} from "../server/reference-matching.ts";
import {automaticPhotoMatching} from "../server/automatic-photo-matching.ts";

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

test("legacy off flag does not block automatic history; authorization and obsolete switch rejection",async()=>{
  const e=await album(false);const p=await photo(e,{caption:"587.jpg"});
  scope([p]);
  assert.equal(e.photoMatchingEnabled,false);
  assert.equal((await api(`/api/events/${e.id}/photo-matching`,undefined,"other")).status,403);
  assert.equal((await api(`/api/events/${e.id}/photo-matching`,undefined,"anonymous")).status,401);
  assert.equal((await api(`/api/events/${e.id}/photo-matching`,{enabled:true,platform:null},"admin","PATCH")).status,400);
  assert.equal((await (await api(`/api/events/${e.id}/photo-matching`)).json()).enabled,true);
  assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id))).length,0);
  assert.equal((await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:[p.id],confirmed:false})).status,400);
  await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:[p.id],confirmed:true,replacePreservedIds:[p.id]});
  const done=await settled(p.id);
  assert.match(done.caption,/Apex/);assert.match(done.caption,/iRacing/);
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
       assert.ok(saved.caption.startsWith("IMSA Esports Global Championship 2026 · Round 2 · Sebring International Raceway · iRacing · 20 September 2026 | "));
       assert.ok(!saved.caption.includes(e.title));}
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
   assert.match((await storage.getMediaItem(photos[0].id)).caption,/^IMSA Esports Global Championship 2026 · Round 3 · Corrected Track · ACC · 20 September 2026/);
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
    const suggestion=(await preview.json()).suggestion;
     assert.ok(suggestion.startsWith("IMSA Esports Global Championship 2026 · Round 2 · Sebring International Raceway · iRacing · 20 September 2026"));
    assert.match(suggestion,/#007 Apex — Prototype — Registered One; Registered Two$/);
    assert.equal((await storage.getMediaItem(p.id)).caption,caption,"suggestions do not save or clean up history");
  }
  assert.match(generated.caption,/#007 Apex — Prototype — Registered One; Registered Two$/);
  assert.equal(calls,before);assert.equal(auditCalls,audits);
});

test("preview and photo/community workers share series context and title fallback without provider calls",async()=>{
  for (const mode of ["series","no-series","blank-series"]) {
    for (const enabled of [true,false]) {
      const e=await album(enabled,owner.id);
      if(mode==="no-series") {
        await db.update(events).set({seriesId:null}).where(eq(events.id,e.id));e.seriesId=null;
      } else if(mode==="blank-series") {
        await db.update(series).set({name:"   "}).where(eq(series.id,e.seriesId));
      }
      const p=await photo(e);scope([p]);
      // Reuse completed synthetic observations: no Vision or safety request.
      await db.insert(mediaAnalysisJobs).values({mediaId:p.id,fingerprint:itemAnalysisFingerprint(p,true),
        status:"queued",referenceOnly:true,recognition:[],generatedTags:[],photoWorkflow:enabled,
        photoMatchingRevision:e.photoMatchingRevision});
      const before=calls,audits=auditCalls;
      const saved=await settled(p.id);
      const first=mode==="series"?"IMSA Esports Global Championship 2026":e.title;
      const expected=`${first} · Round 2 · Sebring International Raceway · iRacing · 20 September 2026`;
      assert.equal(saved.caption,expected);
      const response=await api(`/api/media/${p.id}/caption-preview`,{},"owner");
      assert.equal(response.status,200);
      assert.equal((await response.json()).suggestion,expected);
      assert.equal(calls,before);assert.equal(auditCalls,audits);
    }
  }
});

test("upload and Nextcloud initial jobs ignore legacy opt-in and optional tagging decision",async()=>{
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
      const [job]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id));
      assert.equal(job.fingerprint.startsWith("recognition:"),true);
      if(kind==="nextcloud")assert.equal(p.captionSource,"nextcloud_placeholder");
      const done=await settled(p.id);
      assert.equal(done.photoMatchStatus,"matched");assert.match(done.caption,/Apex/);
      await enqueueAnalysis(done);await settled(p.id);
      assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id)))[0].fingerprint,job.fingerprint);
    }
  }
});

test("event creation with confirmed rows and a real direct upload with tagging off queue automatic recognition",async()=>{
  const response=await api("/api/events",{title:"Automatic creation fixture",description:"Synthetic fixture",
    date:"2026-10-14",entryRows:[entry]});
  assert.equal(response.status,201);
  const e=await response.json();eventIds.push(e.id);scope([]);
  const form=new FormData();
  form.append("file",new Blob([await sharp({create:{width:32,height:32,channels:3,background:"green"}}).jpeg().toBuffer()],{type:"image/jpeg"}),"photo.jpg");
  form.append("type","image");form.append("autoTag","false");form.append("caption","");form.append("tags",JSON.stringify(["Helmet"]));
  const upload=await realFetch(base+`/api/events/${e.id}/media/upload`,{method:"POST",headers:{"x-fixture-role":"admin"},body:form});
  assert.equal(upload.status,201);
  const p=await upload.json();scope([p]);
  assert.equal(p.analysis.status,"queued");
  assert.equal((await (await api(`/api/events/${e.id}/photo-matching`)).json()).enabled,true);
  const done=await settled(p.id);
  assert.match(done.caption,/Apex/);assert.ok(done.tags.includes("Helmet"));
});

test("list deletion during provider response fences late results; restoring list reuses recognition safely",async()=>{
  const e=await album();const p=await photo(e);scope([p]);
  let release;gate=new Promise(r=>release=r);const started=new Promise(r=>entered=r);
  await enqueueAnalysis(p);await started;
  await storage.replaceEventEntries(e.id,[]);
  release();gate=undefined;entered=undefined;await settled(p.id);
  assert.equal((await storage.getMediaItem(p.id)).caption,"");assert.deepEqual((await storage.getMediaItem(p.id)).identification,[]);
  const before=calls;
  await storage.replaceEventEntries(e.id,[entry]);
  await settled(p.id);
  assert.equal(calls,before);assert.match((await storage.getMediaItem(p.id)).caption,/Apex/);
});

test("parallel editor changes and running tags upgrade are fenced without overwriting manual state",async()=>{
  const e=await album(false);const p=await photo(e,{caption:"original.jpg"});scope([p]);
  let release;gate=new Promise(r=>release=r);const started=new Promise(r=>entered=r);
  await enqueueAnalysis(p);await started;
  await api(`/api/events/${e.id}/photo-matching`,{platform:null},"admin","PATCH");
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
  await enqueueAnalysis(p,{recognition:true});let saved=await settled(p.id);
  assert.equal(saved.photoMatchStatus,null);assert.doesNotMatch(saved.caption,/Apex|Registered lineup/);
  const before=calls;
  assert.equal((await api(`/api/media/${p.id}`,{recognitionSession:"Race 2"},"owner","PUT")).status,200);
  saved=await settled(p.id);assert.equal(saved.photoMatchStatus,null);assert.equal(saved.identification[0].source,"reference");assert.equal(calls,before);
  const doc={scope:"event",kind:"entry",session:null,updatedAt:new Date(),rows:[entry,{...entry,team:"Conflicting team"}]};
  const matched=matchReferences([visible],[doc],null,e.title,true);
  assert.equal(matchedPhotoCaption(e,null,matched).matchStatus,"no_unique_match");
  const identified={...visible,team:"Apex",drivers:"Registered One",source:"reference"};
  assert.match(matchedPhotoCaption(e,null,[identified,{...identified,number:"008",team:"Second Team"}]).caption,/#008 Second Team/);
  assert.equal(matchedPhotoCaption(e,null,[identified,visible]).matchStatus,"matched");
  assert.equal(matchedPhotoCaption({...e,platform:null},null,[]).caption.includes("undefined"),false);
});

test("worker saves safe reference information beside unknown cars without new provider calls",async()=>{
  const e=await album();
  await storage.replaceEventEntries(e.id,[{...entry,team:"Bleu Mercure Esport",car:"Porsche 911 GT3 R (992)"}]);
  const p=await photo(e,{tags:["Helmet"],manualTags:["Helmet"]});scope([p]);
  const recognition=[
    {...visible,numberEvidence:"vehicle-crop-v2",vehicleRegion:[0,0,450,1000],
      referenceConstraints:[{team:"bleu mercure",vehicle:"Porsche",manufacturer:"Porsche"}]},
    {...visible,number:"",vehicleRegion:[550,0,450,1000],team:"Unknown branding"},
  ];
  await db.insert(mediaAnalysisJobs).values({mediaId:p.id,fingerprint:itemAnalysisFingerprint(p,true),
    status:"queued",referenceOnly:true,recognition,generatedTags:[],
    photoWorkflow:true,photoMatchingRevision:e.photoMatchingRevision});
  const before=calls,audits=auditCalls;
  const saved=await settled(p.id);
  assert.equal(saved.photoMatchStatus,"matched");
  assert.equal(saved.captionSource,"photo_automatic");
  assert.match(saved.caption,/#007 Bleu Mercure Esport — Porsche 911 GT3 R \(992\) — Registered One; Registered Two/);
  assert.doesNotMatch(saved.caption,/Unknown branding/);
  assert.equal(saved.identification[0].source,"reference");
  assert.equal(saved.identification[0].numberEvidence,"vehicle-crop-v2");
  assert.equal(saved.identification[1].number,"");
  assert.equal(saved.identification[1].source,"visual");
  assert.ok(saved.tags.includes("Helmet"));
  const publicPhoto=await (await api(`/api/media/${p.id}`,undefined,"anonymous")).json();
  assert.equal(publicPhoto.caption,saved.caption);
  assert.equal(calls,before);assert.equal(auditCalls,audits);
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

test("queued work without a list does not call Vision, and older photos remain selectable by page",async()=>{
  const e=await album();const p=await photo(e,{caption:"fixture.jpg"});scope([p]);
  await db.insert(mediaAnalysisJobs).values({mediaId:p.id,fingerprint:itemAnalysisFingerprint(p),status:"completed",generatedTags:["Day"]});
  await db.update(mediaAnalysisJobs).set({status:"queued",photoWorkflow:true,recognition:null,
    photoMatchingRevision:e.photoMatchingRevision,fingerprint:itemAnalysisFingerprint(p,true)})
    .where(eq(mediaAnalysisJobs.mediaId,p.id));
  const before=calls;
  await storage.replaceEventEntries(e.id,[]);
  await wait(async()=>{await drainAnalysisQueue();return (await analysisStatus(p.id)).status==="completed";});
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

test("entry eligibility excludes empty, unconfirmed, result-only, foreign owner/year/title and session lists",async()=>{
  const e=await album(false,owner.id);await storage.replaceEventEntries(e.id,[]);
  const p=await photo(e);scope([p]);
  const form=new FormData();
  form.append("file",new Blob(["Number,Team,Car,Drivers\n7,Apex,Prototype,Registered One\n"],{type:"text/csv"}),"entry.csv");
  assert.equal((await realFetch(base+`/api/events/${e.id}/references`,{method:"POST",headers:{"x-fixture-role":"owner"},body:form})).status,400);
  assert.equal(await automaticPhotoMatching(e.id),false);
  const doc=async extra=>{
    const [d]=await db.insert(referenceDocuments).values({eventId:null,seriesId:e.seriesId,ownerId:owner.id,
      seasonYear:2026,scope:"season",kind:"entry",title:"Fixture",fingerprint:randomUUID(),identityKey:randomUUID(),rows:[entry],...extra}).returning();
    return d;
  };
  const invalid=await Promise.all([
    doc({rows:[]}),doc({kind:"result"}),doc({ownerId:other.id}),doc({seasonYear:2025}),
    doc({rows:[{...entry,eventName:"Another event"}]}),doc({session:"Race 2"}),
  ]);
  assert.equal(await automaticPhotoMatching(e.id),false);
  await reconcileAutomaticPhotos();
  assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id))).length,0);
  assert.equal((await (await api(`/api/events/${e.id}/photo-matching`,undefined,"owner")).json()).photos[0].status,"missing_entry_list");
  assert.equal(await automaticPhotoMatching(e.id,db,"Race 2"),true);
  await db.delete(referenceDocuments).where(inArray(referenceDocuments.id,invalid.map(d=>d.id)));
  const applicable=await doc({rows:[{...entry,eventName:e.title}]});
  assert.equal(await automaticPhotoMatching(e.id),true);
  await settled(p.id);
  assert.match((await storage.getMediaItem(p.id)).caption,/Apex/);
  await db.delete(referenceDocuments).where(eq(referenceDocuments.id,applicable.id));
});

test("later saved lists automatically catch missing, queued and completed tagging jobs without selections",async()=>{
  const e=await album(false);await storage.replaceEventEntries(e.id,[]);
  const ps=await Promise.all(["missing","queued","completed"].map(kind=>photo(e,{caption:`${kind}.jpg`,captionSource:"nextcloud_placeholder"})));
  scope(ps);
  for(const [i,status] of ["queued","completed"].entries())
    await db.insert(mediaAnalysisJobs).values({mediaId:ps[i+1].id,fingerprint:itemAnalysisFingerprint(ps[i+1]),status,generatedTags:["Day"]});
  await storage.replaceEventEntries(e.id,[entry]);
  await Promise.all([reconcileAutomaticPhotos(),reconcileAutomaticPhotos()]);
  for(const p of ps){
    const done=await settled(p.id);assert.match(done.caption,/Apex/);
    const [job]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id));
    assert.equal(job.photoWorkflow,true);assert.equal(job.generation,p.id===ps[0].id?1:2);
  }
  const before=calls;
  await reconcileAutomaticPhotos();await drainAnalysisQueue();
  assert.equal(calls,before,"completed current revision is idempotent");
});

test("list saved during running tag analysis keeps its lease and automatically upgrades after completion",async()=>{
  const e=await album(false);await storage.replaceEventEntries(e.id,[]);
  const p=await photo(e,{caption:"file.jpg",captionSource:"nextcloud_placeholder"});scope([p]);
  let release;gate=new Promise(r=>release=r);const started=new Promise(r=>entered=r);
  try {
    await enqueueAnalysis(p);await started;
    const [before]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id));
    await storage.replaceEventEntries(e.id,[entry]);
    await Promise.all([reconcileAutomaticPhotos(),enqueueAnalysis(p)]);
    const [after]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id));
    assert.equal(after.workerToken,before.workerToken);assert.equal(after.generation,before.generation);
  } finally {release();gate=undefined;entered=undefined;}
  await wait(async()=>!(await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id)))[0].workerToken);
  const done=await settled(p.id);
  assert.match(done.caption,/Apex/);
  assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id)))[0].photoWorkflow,true);
});

test("explicit historical caption replacement joins a running photo lease without a second recognition request",async()=>{
  const e=await album(false),p=await photo(e,{caption:"Protected historical text"});scope([p]);
  let release;gate=new Promise(r=>release=r);const started=new Promise(r=>entered=r);
  let before;
  try {
    await enqueueAnalysis(p);await started;before=calls;
    const [lease]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id));
    const response=await api(`/api/events/${e.id}/photo-matching/process`,{mediaIds:[p.id],replacePreservedIds:[p.id]});
    assert.equal(response.status,202);
    const [joined]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id));
    assert.equal(joined.workerToken,lease.workerToken);assert.equal(joined.generation,lease.generation);
    assert.equal(joined.replaceCaption,"Protected historical text");
  } finally {release();gate=undefined;entered=undefined;}
  assert.match((await settled(p.id)).caption,/Apex/);assert.equal(calls,before);
});

test("full queue leaves durable missing work visible and admits it when capacity returns",async()=>{
  const e=await album(false),p=await photo(e);scope([p]);
  const background=await album(false);await storage.replaceEventEntries(background.id,[]);
  const fillers=await db.insert(mediaItems).values(Array.from({length:1000},()=>({eventId:background.id,type:"image",url:image,thumbnail:image,tags:[]}))).returning();
  await db.insert(mediaAnalysisJobs).values(fillers.map(m=>({mediaId:m.id,fingerprint:itemAnalysisFingerprint(m),status:"queued"})));
  const before=calls;
  await reconcileAutomaticPhotos();
  assert.equal((await analysisStatus(p.id)).status,"queued");
  assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id))).length,0);
  assert.equal(calls,before);
  await db.delete(mediaItems).where(inArray(mediaItems.id,fillers.map(m=>m.id)));
  assert.match((await settled(p.id)).caption,/Apex/);
});

test("provider configuration outage preserves upload intent and automatically recovers admission",async()=>{
  const e=await album(false),rid=randomUUID();
  const key=process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  await db.insert(mediaReservations).values({id:rid,eventId:e.id,reservedBytes:1,storageKey:`fixture-${rid}`,thumbnailKey:`fixture-${rid}`});
  let p;
  try {
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    p=await storage.finishMedia(rid,{eventId:e.id,type:"image",url:image,thumbnail:image,caption:"",tags:[]},undefined,undefined,false);
    scope([p]);
    assert.equal((await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id)))[0].status,"waiting");
    await reconcileAutomaticPhotos();
    assert.equal((await analysisStatus(p.id)).status,"queued");
  } finally {process.env.AI_INTEGRATIONS_OPENAI_API_KEY=key;}
  assert.match((await settled(p.id)).caption,/Apex/);
});

test("large gallery admission is bounded, resumable and uses stored observations across list revisions",async()=>{
  const e=await album(false);
  const ps=await db.insert(mediaItems).values(Array.from({length:527},()=>({eventId:e.id,type:"image",url:image,thumbnail:image,
    caption:"Protected history",captionSource:"preserved",tags:["Helmet"],manualTags:["Helmet"]}))).returning();
  scope(ps);
  await db.insert(mediaAnalysisJobs).values(ps.map(p=>({mediaId:p.id,fingerprint:itemAnalysisFingerprint(p,true),status:"completed",recognition:[],generatedTags:[]})));
  const before=calls;
  await reconcileAutomaticPhotos();
  let jobs=await db.select().from(mediaAnalysisJobs).where(inArray(mediaAnalysisJobs.mediaId,ps.map(p=>p.id)));
  assert.equal(jobs.filter(j=>j.status==="queued").length,25);
  assert.match((await settled(ps[0].id)).caption,/Protected history/);
  for(let batch=0;batch<22;batch++){
    // Simulate interruption/restart between completed bounded batches.
    await db.update(mediaAnalysisJobs).set({status:"completed"}).where(and(
      inArray(mediaAnalysisJobs.mediaId,ps.map(p=>p.id)),eq(mediaAnalysisJobs.status,"queued")));
    await reconcileAutomaticPhotos();
  }
  jobs=await db.select().from(mediaAnalysisJobs).where(inArray(mediaAnalysisJobs.mediaId,ps.map(p=>p.id)));
  assert.equal(jobs.filter(j=>j.photoWorkflow).length,527);
  assert.equal(calls,before);
  const first=await (await api(`/api/events/${e.id}/photo-matching`)).json();
  assert.equal(first.photos.length,500);assert.equal(first.total,527);assert.ok(first.nextCursor);
});

test("expired automatic lease resumes cached evidence after a restart without repeating Vision",async()=>{
  const e=await album(false),p=await photo(e);scope([p]);
  await db.insert(mediaAnalysisJobs).values({mediaId:p.id,fingerprint:itemAnalysisFingerprint(p,true),status:"running",
    photoWorkflow:true,referenceRevision:e.referenceRevision,attempts:1,workerToken:randomUUID(),
    updatedAt:new Date(Date.now()-100000),referenceOnly:true,recognition:[],generatedTags:[]});
  const before=calls;
  await settled(p.id);
  assert.equal(calls,before);
  const [job]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,p.id));
  assert.equal(job.status,"completed");assert.equal(job.attempts,2);
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
