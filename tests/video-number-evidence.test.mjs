import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {pool} from "../server/db.ts";
import {PHOTO_NUMBER_POLICY,verifyPhotoObservations} from "../server/utils/photo-number-evidence.ts";
import {aggregateVideo,checkVideoNumbers,recognizeVideoBatch,VIDEO_NUMBER_PIPELINE,VIDEO_NUMBER_LIMITS} from "../server/video-recognition.ts";
import {matchReferences} from "../server/reference-matching.ts";

const oldFetch=globalThis.fetch;
const oldBase=process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,oldKey=process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const left=[0,0,500,1000],right=[500,0,500,1000];
const observation=(number,vehicleRegion=left,extra={})=>({number,vehicleRegion,team:"",vehicle:"Race Car",
  drivers:"",manufacturer:"",racingClass:"",discipline:"",source:"visual",...extra});
const bytes=await sharp({create:{width:128,height:96,channels:3,background:"red"}}).jpeg().toBuffer();
const frame={image:"data:image/jpeg;base64,"+bytes.toString("base64"),
  hash:createHash("sha256").update(bytes).digest("hex"),timestamp:1.25};
const evidence=()=>({sourceHash:"source",duration:2,samplingMs:1,timestamps:[frame.timestamp],
  frames:[{hash:frame.hash,timestamp:frame.timestamp,tags:["Race Car"],vehicles:[observation("007")]}],
  providerRequests:0,analyzedFrames:1,usageUnavailableRequests:0,promptTokens:null,completionTokens:null,cost:null});
const reply=content=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}],
  usage:{prompt_tokens:111,completion_tokens:22}}),{headers:{"content-type":"application/json"}});
let calls,mode,failAudit,brandingMode;
test.before(()=>{
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL="https://video-number.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY="fixture";
});
test.beforeEach(()=>{
  calls=[];mode="valid";failAudit=false;brandingMode=undefined;
  // Instantiate only after assigning the mock transport, as in the photo tests.
  globalThis.fetch=async(_url,options)=>{
    const request=JSON.parse(options.body);calls.push(request);
    const localization=request.messages[0].content.startsWith("Localize");
    if(localization)return reply({scene:null,vehicles:[{number:"007",vehicleRegion:left},{number:"",vehicleRegion:right}]});
    if(failAudit){failAudit=false;throw new Error("transient audit transport");}
    const number=mode==="clipped"?"7":mode==="unreadable"?"":"007";
    const assessment={complete:true,markings:[{text:"MOZA RACING",kind:"commercial"}]};
    const branding={
      fullImageReadings:[{readingIndex:0,...assessment}],
      vehicleReadings:[{vehicleIndex:0,...assessment}],
    };
    if(brandingMode==="unknown")branding.vehicleReadings[0]={...assessment,
      vehicleIndex:0,markings:[{text:"MOZA RACING",kind:"unknown"}]};
    if(brandingMode==="team")branding.vehicleReadings[0]={...assessment,
      vehicleIndex:0,markings:[{text:"MOZA RACING",kind:"team"}]};
    if(brandingMode==="other-team")branding.fullImageReadings[0]={...assessment,readingIndex:0,
      markings:[...assessment.markings,{text:"Other Racing",kind:"team"}]};
    if(brandingMode==="bad-index")branding.vehicleReadings[0].vehicleIndex=1;
    if(brandingMode==="malformed")branding.vehicleReadings="bad";
    return reply({fullImageReadings:[{number,vehicleRegion:mode==="borrowed"?right:left,
      panelRegion:mode==="borrowed"?[600,200,100,100]:[100,200,100,100]}],
       vehicleReadings:[{vehicleIndex:0,number}],
       ...(brandingMode?{branding}:{})});
  };
});
test.after(async()=>{
  globalThis.fetch=oldFetch;
  if(oldBase===undefined)delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL=oldBase;
  if(oldKey===undefined)delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;else process.env.AI_INTEGRATIONS_OPENAI_API_KEY=oldKey;
  await pool.end();
});
const refs=[{scope:"event",kind:"entry",session:"Race",updatedAt:new Date(),
  rows:[{number:"7",team:"Registered",car:"Race Car",drivers:"Registered lineup"}]}];
const match=vehicles=>matchReferences(vehicles,refs,"Race","Event",true,true);
test("video commercial-brand resolution shares the numeric request and saves source-bound evidence",async()=>{
  brandingMode="commercial";
  const e=evidence();e.frames[0].vehicles[0].team="MOZA RACING";
  await checkVideoNumbers([frame],e,async()=>{});
  const result=aggregateVideo(e.frames);
  assert.equal(match(result.vehicles)[0].source,"reference");
  assert.equal(result.vehicles[0].team,"");
  assert.equal(result.vehicles[0].referenceConstraints[0].team,"");
  assert.equal(e.frames[0].vehicles[0].team,"MOZA RACING","Raw first-pass evidence stays intact");
  assert.equal(e.frames[0].numberCheck.commercialBranding.policy,"video-commercial-brand-v1");
  assert.deepEqual(e.frames[0].numberCheck.commercialBranding.vehicles,[{vehicleIndex:0,hints:["MOZA RACING"]}]);
  assert.equal(calls.length,2,"No extra provider request");
  assert.equal(e.numberRequests,2);assert.equal(e.promptTokens,222);assert.equal(e.completionTokens,44);
  assert.match(calls[1].messages[0].content,/BODYWORK branding/);
  assert.ok(!JSON.stringify(calls).includes("Registered lineup"),"No reference identities supplied to AI");
  await checkVideoNumbers([frame],e,async()=>{});
  assert.equal(calls.length,2,"Validated checkpoints are reused");
  const changed=structuredClone(e.frames);changed[0].numberCheck.hash="different";
  assert.ok(match(aggregateVideo(changed).vehicles).every(v=>v.source!=="reference"));
});
for(const negative of ["unknown","team","other-team","bad-index","malformed",undefined])
  test(`unresolved branding (${negative || "missing"}) does not excuse a team conflict or fail valid numbers`,async()=>{
    brandingMode=negative;
    const e=evidence();e.frames[0].vehicles[0].team="MOZA RACING";
    await checkVideoNumbers([frame],e,async()=>{});
    const checked=aggregateVideo(e.frames).vehicles[0];
    assert.equal(checked.number,"007");assert.equal(checked.numberEvidence,PHOTO_NUMBER_POLICY);
    assert.equal(match([checked])[0].source,"visual");
    assert.equal(checked.referenceConstraints[0].team,"MOZA RACING");
    assert.equal(e.frames[0].numberCheck.commercialBranding,undefined);
  });
test("commercial assessment cannot rescue unreadable digits or a borrowed car",async()=>{
  brandingMode="commercial";
  for(const failure of ["clipped","borrowed","unreadable"]){
    mode=failure;const e=evidence();e.frames[0].vehicles[0].team="MOZA RACING";
    await checkVideoNumbers([frame],e,async()=>{});
    assert.ok(aggregateVideo(e.frames).vehicles.every(v=>!v.number));
    assert.equal(e.frames[0].numberCheck.commercialBranding,undefined);
  }
});
test("ordinary photo numeric audits do not enable video branding exceptions",async()=>{
  brandingMode="commercial";
  const v=observation("007",left,{team:"MOZA RACING",
    referenceConstraints:[{team:"MOZA RACING",vehicle:"Race Car",manufacturer:""}]});
  const checked=await verifyPhotoObservations(frame.image,[v]);
  assert.equal(checked[0].number,"007");
  assert.equal(checked[0].referenceConstraints[0].team,"MOZA RACING");
  assert.equal(match(checked)[0].source,"visual");
  assert.ok(!calls[0].messages[0].content.includes("BODYWORK branding"));
});
test("dense frames cap optional branding assessments without adding requests",async()=>{
  const vehicles=Array.from({length:4},()=>observation("007",left,{team:"MOZA RACING"}));
  await verifyPhotoObservations(frame.image,vehicles,undefined,{videoBranding:true});
  assert.equal(calls.length,1);
  assert.match(calls[0].messages[0].content,/labelled vehicle crops 0, 1, 2\./);
  assert.ok(!calls[0].messages[0].content.includes("labelled vehicle crops 0, 1, 2, 3"));
});
test("actual frozen frame pixels, printed leading zeros and separate unknown cars",async()=>{
  const e=evidence();let saves=0;
  await checkVideoNumbers([frame],e,async()=>{saves++;});
  const result=aggregateVideo(e.frames);
  assert.deepEqual(result.vehicles.map(v=>v.number),["007",""]);
  assert.equal(match(result.vehicles)[0].source,"reference");
  assert.equal(matchReferences(result.vehicles,refs,"Other","Event",true,true)[0].source,"visual");
  assert.equal(calls.length,2);assert.equal(e.providerRequests,2);assert.equal(e.numberRequests,2);
  assert.equal(e.promptTokens,222);assert.equal(e.completionTokens,44);assert.equal(e.cost,null);
  assert.equal(e.usageUnavailableRequests,0);assert.ok(saves>=6);
  assert.equal(calls[0].messages[1].content[0].image_url.url,frame.image);
  assert.equal(calls[1].messages[1].content[1].image_url.url,frame.image);
  await checkVideoNumbers([frame],e,async()=>{});
  assert.equal(calls.length,2,"successful steps reused");
});
for(const negative of ["clipped","borrowed","unreadable"])test(`${negative} cannot reference-match despite weak repetition`,async()=>{
  mode=negative;const e=evidence();
  await checkVideoNumbers([frame],e,async()=>{});
  assert.ok(match(aggregateVideo([...e.frames,...e.frames]).vehicles).every(v=>!v.number&&!v.drivers&&v.source==="visual"));
});
test("successful localization survives failed audit and available tokens include all successful checks",async()=>{
  failAudit=true;const e=evidence();
  await assert.rejects(checkVideoNumbers([frame],e,async()=>{}),/Connection/);
  assert.equal(e.frames[0].numberCheck.status,"localized");
  assert.ok(aggregateVideo(e.frames).vehicles.every(v=>!v.number));
  await checkVideoNumbers([frame],e,async()=>{});
  assert.equal(calls.filter(c=>c.messages[0].content.startsWith("Localize")).length,1);
  assert.equal(e.providerRequests,3);assert.equal(e.usageUnavailableRequests,1);
  assert.equal(e.promptTokens,222);assert.equal(e.frames[0].numberCheck.status,"verified");
});
test("policy, hash, timestamp, historical and budget boundaries fail closed",async()=>{
  const e=evidence();
  await checkVideoNumbers([frame],e,async()=>{});
  for(const mutation of [c=>{c.policy="old";},c=>{c.hash="different";},c=>{c.timestamp++;},c=>{c.status="localized";}]){
    const copy=structuredClone(e.frames);mutation(copy[0].numberCheck);
    assert.ok(aggregateVideo(copy).vehicles.every(v=>!v.number));
  }
  const historical=evidence();
  historical.frames[0].vehicles[0].numberEvidence=PHOTO_NUMBER_POLICY;
  assert.ok(aggregateVideo(historical.frames).vehicles.every(v=>!v.number),"forged raw provenance not enough");
  const limited=evidence();limited.numberPipeline=VIDEO_NUMBER_PIPELINE;limited.numberRequests=VIDEO_NUMBER_LIMITS.requests;
  const before=calls.length;await checkVideoNumbers([frame],limited,async()=>{});
  assert.equal(calls.length,before);assert.equal(limited.frames[0].numberCheck.status,"skipped");
  assert.ok(aggregateVideo(limited.frames).vehicles.every(v=>!v.number));
  const old=evidence();old.numberPipeline="old";
  old.frames[0].numberCheck=e.frames[0].numberCheck;
  await checkVideoNumbers([frame],old,async()=>{});
  assert.equal(calls.length,before+2,"policy switch cannot reuse old checkpoint");
  await assert.rejects(checkVideoNumbers([{...frame,hash:"wrong"}],
    {...evidence(),frames:[{...evidence().frames[0],hash:"wrong"}]},async()=>{}),/Invalid/);
});
test("same digits never merge different cars or borrow descriptors; contradictory vehicles veto references",()=>{
  const checked=(vehicles,hash)=>({hash,timestamp:0,tags:[],vehicles:[],
    numberCheck:{policy:VIDEO_NUMBER_PIPELINE,hash,timestamp:0,status:"verified",
      vehicles:vehicles.map(v=>({...v,numberEvidence:PHOTO_NUMBER_POLICY}))}});
  const result=aggregateVideo([checked([observation("007",left,{vehicle:"BMW M4"}),
    observation("",right)],"a"),checked([observation("7",right,{vehicle:"McLaren 720S"})],"b")]);
  assert.equal(result.vehicles.length,3);
  assert.ok(result.vehicles.every(v=>!v.number));
  assert.ok(match(result.vehicles).every(v=>!v.drivers));
  const distinct=aggregateVideo([checked([observation("007",left),observation("7",right)],"c")]);
  assert.equal(distinct.vehicles.length,2);assert.deepEqual(distinct.vehicles.map(v=>v.number),["007","7"]);
  assert.ok(matchReferences(distinct.vehicles,[{...refs[0],rows:[...refs[0].rows,
    {...refs[0].rows[0],team:"Conflicting"}]}],"Race","Event",true,true).every(v=>v.source==="visual"));
});
test("frame and elapsed budgets bound additional checks across retries",async()=>{
  const e=evidence();
  const frames=Array.from({length:12},(_,i)=>({...frame,timestamp:i}));
  e.frames=frames.map(f=>({...e.frames[0],timestamp:f.timestamp}));
  await checkVideoNumbers(frames,e,async()=>{});
  assert.equal(calls.length,8);assert.equal(e.frames.filter(f=>f.numberCheck?.status==="verified").length,4);
  assert.equal(aggregateVideo(e.frames).vehicles.filter(v=>v.number).length,4);
  await checkVideoNumbers(frames,e,async()=>{});assert.equal(calls.length,8);
  const timed=evidence();timed.numberPipeline=VIDEO_NUMBER_PIPELINE;timed.numberElapsedMs=VIDEO_NUMBER_LIMITS.elapsedMs-1000;
  await checkVideoNumbers([frame],timed,async()=>{});
  assert.equal(calls.length,8);assert.equal(timed.frames[0].numberCheck.status,"skipped");
});
test("available batch tokens survive malformed recognition output",async()=>{
  let usage;
  await assert.rejects(recognizeVideoBatch([frame],async value=>{usage=value;}),/Invalid video recognition/);
  assert.deepEqual(usage,{prompt:111,completion:22});
});

test("video request enforces strict indexed frame output and records usage before structural rejection",async()=>{
  const captured=[];
  const usage=[];
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);captured.push(body);
    return reply({frames:[{index:0,tags:[],vehicles:[]}]});
  };
  const second={...frame,hash:"other-hash",timestamp:2.5};
  await assert.rejects(recognizeVideoBatch([frame,second],async u=>usage.push(u)),
    error=>error.details.outputReason==="frame_count" && error.details.receivedFrames===1);
  assert.equal(captured.length,1,"Structural failure does not silently resend paid requests");
  const format=captured[0].response_format;
  assert.equal(format.type,"json_schema");
  assert.equal(format.json_schema.strict,true);
  assert.equal(format.json_schema.schema.properties.frames.minItems,2);
  assert.deepEqual(format.json_schema.schema.properties.frames.items.properties.index.enum,[0,1]);
  assert.match(captured[0].messages[0].content,/zero-based indices 0, 1/);
  assert.deepEqual(usage,[{prompt:111,completion:22}]);
});
test("existing pilot evidence comparison rejects unverified 99/9 and retains omissions as unknown, not measured AI improvement",async()=>{
  const pilot=JSON.parse(await readFile(new URL("../docs/video-analysis-live-results.json",import.meta.url),"utf8"));
  const clips=pilot.clips||pilot.results;
  assert.ok(clips?.length);
  let compared=0,comparedFrames=0;
  for(const clip of clips){
    const e=clip.evidence;
    if(!e)continue;
    compared++;comparedFrames+=e.frames.length;
    const next=aggregateVideo(e.frames);
    assert.ok(next.vehicles.every(v=>!v.number&&!v.drivers));
    if(clip.file.includes("Snippet")){
      assert.deepEqual(clip.rawRecognition.map(v=>v.number),["99","9"]);
      assert.equal(e.frames.at(-1).vehicles[0].number,"9");
    }
    if(clip.file.includes("Gran_Turismo")){
      assert.ok(e.frames.some(f=>f.vehicles.some(v=>v.number==="65")));
      assert.ok(!clip.rawRecognition.some(v=>v.number==="65"),"baseline omitted disputed 65");
      assert.ok(next.vehicles.length>0,"unknown car observations still retained even without model descriptions");
    }
  }
  assert.equal(compared,5);assert.equal(comparedFrames,25);
});
