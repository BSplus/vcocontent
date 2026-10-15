// These are locality/transport contracts, not claims of mocked pixel accuracy.
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {readFile} from "node:fs/promises";
import {verifyPhotoObservations,supportedPhotoObservations,photoVehicleCrop,checkedBrandTags,PHOTO_NUMBER_POLICY,NUMBER_AUDIT_MODEL} from "../server/utils/photo-number-evidence.ts";
import {parseRecognition} from "../server/utils/motorsport-recognition.ts";
import {detectRaceNumbers} from "../server/utils/ai-tagger.ts";
import {matchReferences} from "../server/reference-matching.ts";
import {hasOpaqueNeutralPatch} from "../server/utils/photo-redaction.ts";
import {pool} from "../server/db.ts";
import {localizePhotoNumbers} from "../server/utils/photo-number-localizer.ts";
const realFetch=globalThis.fetch,oldBase=process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,oldKey=process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const bytes=await sharp({create:{width:128,height:96,channels:3,background:"white"}}).webp().toBuffer();
const image="data:image/webp;base64,"+bytes.toString("base64");
const entire=[0,0,1000,1000],left=[0,0,450,1000],right=[550,0,450,1000];
const panel=r=>[r[0]+r[2]*.25,r[1]+r[3]*.25,r[2]*.3,r[3]*.3];
const observed=(number="",extra={})=>({number,team:"",drivers:"",vehicle:"Race Car",manufacturer:"",racingClass:"",discipline:"",source:"visual",vehicleRegion:entire,...extra});
const full=(number,vehicleRegion=entire)=>({number,vehicleRegion,panelRegion:panel(vehicleRegion)});
const proof=(number,vehicleRegion=entire)=>({fullImageReadings:[full(number,vehicleRegion)],vehicleReadings:[{vehicleIndex:0,number}]});
const reply=(content,finish_reason="stop")=>new Response(JSON.stringify({choices:[{finish_reason,message:{content:JSON.stringify(content)}}]}),{headers:{"Content-Type":"application/json"}});
let evidence,requests;
test.before(()=>{process.env.AI_INTEGRATIONS_OPENAI_BASE_URL="https://number-audit.example.invalid/v1";process.env.AI_INTEGRATIONS_OPENAI_API_KEY="fixture-only";});
test.beforeEach(()=>{evidence={fullImageReadings:[],vehicleReadings:[]};requests=[];
  globalThis.fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));return reply(evidence);};});
test.after(async()=>{globalThis.fetch=realFetch;
  if(oldBase===undefined)delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL=oldBase;
  if(oldKey===undefined)delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;else process.env.AI_INTEGRATIONS_OPENAI_API_KEY=oldKey;await pool.end();});
test("source-pixel car crops use the exact first-pass anchor, no other-car substitution",async()=>{
  const colors=await sharp({create:{width:128,height:96,channels:3,background:"red"}})
    .composite([{input:await sharp({create:{width:64,height:96,channels:3,background:"blue"}}).png().toBuffer(),left:64,top:0}]).png().toBuffer();
  const crop=await photoVehicleCrop(colors,[0,0,500,1000]);
  const meta=await sharp(crop).metadata();assert.equal(meta.width,64);assert.equal(meta.height,96);
  const {data}=await sharp(crop).raw().toBuffer({resolveWithObject:true});
  assert.ok(data[0]>230&&data[2]<15);
  await assert.rejects(photoVehicleCrop(colors,[999,0,2,1000]),/Invalid/);
});
test("opaque patches at unseen positions, sizes and grey levels preclude provider confirmation",async()=>{
  for(const [grey,x,y,w,h] of [[60,20,25,22,43],[110,55,35,25,31],[190,40,15,18,24]]){
    const patch=await sharp({create:{width:w,height:h,channels:3,background:{r:grey,g:grey,b:grey}}}).png().toBuffer();
    const b=await sharp({create:{width:128,height:96,channels:3,background:{r:180,g:40,b:15}}}).composite([{input:patch,left:x,top:y}]).webp({quality:90}).toBuffer();
    assert.equal(await hasOpaqueNeutralPatch(b),true);evidence=proof("10");
    assert.equal((await verifyPhotoObservations("data:image/webp;base64,"+b.toString("base64"),[observed("10")]))[0].number,"");
  }
  assert.equal(requests.length,0);
});
test("provider flags and forged provenance alone cannot certify numbers or missing vehicle anchors",async()=>{
  const raw=parseRecognition(JSON.stringify({tags:[],vehicles:[{number:"10",numberReadable:true,numberEvidence:PHOTO_NUMBER_POLICY,vehicle:"Race Car"}]}));
  assert.equal(raw.vehicles[0].numberEvidence,undefined);evidence=proof("10");
  assert.equal((await verifyPhotoObservations(image,raw.vehicles))[0].number,"");assert.equal(requests.length,0);
  assert.equal(supportedPhotoObservations([observed("01",{team:"Logo"})])[0].team,"");
});
test("unprimed car-local full and crop readings preserve exact leading zeros without identities",async()=>{
  evidence={fullImageReadings:[full("007",left),full("12",right)],vehicleReadings:[{vehicleIndex:0,number:"007"},{vehicleIndex:1,number:"12"}],
    team:"Guessed team",drivers:"Guessed person",racingClass:"GT3"};
  const result=await verifyPhotoObservations(image,[observed("007",{vehicleRegion:left}),observed("12",{vehicleRegion:right})]);
  assert.deepEqual(result.map(v=>v.number),["007","12"]);
  assert.ok(result.every(v=>v.numberEvidence===PHOTO_NUMBER_POLICY&&!v.team&&!v.drivers&&!v.racingClass));
  assert.equal(requests.length,1);assert.equal(requests[0].model,NUMBER_AUDIT_MODEL);assert.equal(requests[0].reasoning_effort,"medium");
  assert.equal(requests[0].max_completion_tokens,4096);
  const inputs=requests[0].messages[1].content.filter(c=>c.type==="image_url");
  assert.equal(inputs.length,3);assert.equal(inputs[0].image_url.url,image);
  for(const input of inputs.slice(1))assert.equal((await sharp(Buffer.from(input.image_url.url.split(",")[1],"base64")).metadata()).width,58);
  assert.doesNotMatch(JSON.stringify(requests[0].messages[0]),/007|Guessed team|Registered lineup/);
});
test("a genuinely visible number on another car cannot validate the wrong first-pass car",async()=>{
  const realImage="data:image/webp;base64,"+(await readFile(new URL("./fixtures/motorsport/multiple-readable.webp",import.meta.url))).toString("base64");
  // Human-reviewed pixels: red GT car 107 in front, green prototype 5 behind.
  const red=[160,350,385,145],green=[585,245,310,88];
  // Deliberate cross-car borrowing: 5 exists on the RIGHT car, but the first
  // pass assigns it to the LEFT car. No duplicated first-pass number is needed.
  evidence={fullImageReadings:[
    {number:"107",vehicleRegion:red,panelRegion:[426,421,35,20]},
    {number:"5",vehicleRegion:green,panelRegion:[747,300,17,10]},
  ],vehicleReadings:[{vehicleIndex:0,number:"107"}]};
  const wrong=await verifyPhotoObservations(realImage,[observed("5",{vehicleRegion:red})]);
  assert.equal(wrong[0].number,"");
  const refs=[{scope:"event",kind:"entry",session:null,updatedAt:new Date(),rows:[
    {number:"5",team:"BMW M Verstappen Sim Racing",car:"Wrong model",drivers:"Registered lineup"},
  ]}];
  const linked=matchReferences(wrong,refs,null,"",true,true)[0];
  assert.equal(linked.team,"");assert.equal(linked.drivers,"");assert.equal(linked.source,"visual");
  // Even an erroneous crop answer cannot override the full-image car binding.
  evidence.vehicleReadings[0].number="5";
  assert.equal((await verifyPhotoObservations(realImage,[observed("5",{vehicleRegion:red})]))[0].number,"");
  evidence.vehicleReadings[0].number="5";
  assert.equal((await verifyPhotoObservations(realImage,[observed("5",{vehicleRegion:green})]))[0].number,"5");
});
test("canonical car localization never moves weak descriptors using only a matching number",async()=>{
  globalThis.fetch=async()=>reply({vehicles:[{number:"107",vehicleRegion:left},{number:"5",vehicleRegion:right}],scene:null});
  const r=await localizePhotoNumbers(image,[observed("5",{vehicleRegion:left,vehicle:"Wrong model",manufacturer:"Wrong brand",team:"Wrong team"})]);
  assert.deepEqual(r.vehicles.map(v=>v.number),["","5"]);
  assert.equal(r.vehicles[1].vehicle,"Race Car");assert.equal(r.vehicles[1].manufacturer,"");assert.equal(r.vehicles[1].team,"");
  assert.deepEqual(r.vehicles[1].vehicleRegion,right);assert.equal(r.vehicles[1].drivers,"");assert.equal(r.vehicles[1].racingClass,"");
});
test("OCR can retain a complete leading-zero number only with original panel, car and full-image agreement",async()=>{
  const realImage="data:image/webp;base64,"+(await readFile(new URL("./fixtures/motorsport/controls/dual-007.webp",import.meta.url))).toString("base64");
  const car=[80,250,780,480];
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);requests.push(body);
    if(body.messages[0].content.includes("Localize complete"))
      return reply({vehicles:[{number:"7",vehicleRegion:car}],scene:"Race Action"});
    return reply({fullImageReadings:[full("007",car)],vehicleReadings:[{vehicleIndex:0,number:"007"}],panelReadings:[{vehicleIndex:0,number:"007"}]});
  };
  const first=await localizePhotoNumbers(realImage,[observed("007",{vehicleRegion:undefined})],true);
  assert.equal(first.vehicles[0].number,"007");assert.ok(first.vehicles[0].numberPanelRegion);
  assert.equal((await verifyPhotoObservations(realImage,first.vehicles))[0].number,"007");
  assert.equal(requests[1].messages[1].content.filter(c=>c.type==="image_url").length,3);
  for(const mismatch of ["7",""]){
    globalThis.fetch=async()=>reply({fullImageReadings:[full("007",car)],vehicleReadings:[{vehicleIndex:0,number:"007"}],panelReadings:[{vehicleIndex:0,number:mismatch}]});
    assert.equal((await verifyPhotoObservations(realImage,first.vehicles))[0].number,"");
  }
  globalThis.fetch=async()=>reply({vehicles:[{number:"7",vehicleRegion:car}],scene:null});
  const disallowed=await localizePhotoNumbers(realImage,[observed("10",{vehicleRegion:undefined})],true);
  assert.equal(disallowed.vehicles[0].number,"");
  const withoutOcr=await localizePhotoNumbers(realImage,[observed("007",{vehicleRegion:undefined})],false);
  assert.equal(withoutOcr.vehicles[0].number,"");
  assert.equal(withoutOcr.vehicles[0].numberPanelRegion,undefined);
});
test("both swapped first-pass car numbers stay unknown, correct anchored numbers both survive",async()=>{
  evidence={fullImageReadings:[full("107",left),full("5",right)],vehicleReadings:[{vehicleIndex:0,number:"107"},{vehicleIndex:1,number:"5"}]};
  const anchors=[{vehicleRegion:left},{vehicleRegion:right}];
  assert.deepEqual((await verifyPhotoObservations(image,["5","107"].map((n,i)=>observed(n,anchors[i])))).map(v=>v.number),["",""]);
  assert.deepEqual((await verifyPhotoObservations(image,["107","5"].map((n,i)=>observed(n,anchors[i])))).map(v=>v.number),["107","5"]);
});
test("outside panels, ambiguous anchors and shared car regions never certify a number",async()=>{
  evidence=proof("007",left);evidence.fullImageReadings[0].panelRegion=panel(right);
  assert.equal((await verifyPhotoObservations(image,[observed("007",{vehicleRegion:left})]))[0].number,"");
  evidence=proof("007",left);
  assert.ok((await verifyPhotoObservations(image,[observed("007",{vehicleRegion:left}),observed("",{vehicleRegion:left})])).every(v=>!v.number));
  evidence.fullImageReadings.push(full("12",left));
  assert.equal((await verifyPhotoObservations(image,[observed("007",{vehicleRegion:left})]))[0].number,"");
});
test("full/crop disagreement, shorter leading-zero forms and new numbers never replace observations",async()=>{
  for(const [a,b] of [["7","007"],["007","7"],["11","11"],["007",""]]){
    evidence=proof(a);evidence.vehicleReadings[0].number=b;
    assert.equal((await verifyPhotoObservations(image,[observed("007")]))[0].number,"");
  }
  evidence=proof("007");evidence.vehicleReadings=[];
  assert.equal((await verifyPhotoObservations(image,[observed("007")]))[0].number,"");
});
test("duplicate original numbers cannot share car evidence",async()=>{
  evidence=proof("007");
  assert.ok((await verifyPhotoObservations(image,[observed("007"),observed("007")])).every(v=>!v.number));
});
test("MAHLE same-car pixel contracts remain independent of failed number readings and team hints",async()=>{
  for(const [fullNumber,cropNumber] of [["110",""],["","110"],["11","110"],["",""]]) {
    evidence=proof(fullNumber);
    evidence.vehicleReadings[0].number=cropNumber;
    evidence.branding={
      fullImageReadings:[{readingIndex:0,complete:true,markings:[{text:"MAHLE",kind:"team_and_commercial"}]}],
      vehicleReadings:[{vehicleIndex:0,complete:true,markings:[{text:"MAHLE",kind:"commercial"}]}],
    };
    const result=await verifyPhotoObservations(image,[observed("110",{team:"MAHLE"})],undefined,{visibleBrands:true});
    assert.deepEqual(checkedBrandTags(result),["Brand: MAHLE"]);
    assert.equal(result[0].number,"");assert.equal(result[0].numberEvidence,undefined);
    assert.equal(result[0].team,"");assert.equal(result[0].drivers,"");
  }
  assert.ok(requests.every(r=>!r.messages[0].content.includes("MAHLE")),"no team/brand candidates prime the audit");
});
test("independent logo evidence still requires unique same-car full/crop binding, not team text or another car",async()=>{
  const branding={
    fullImageReadings:[{readingIndex:0,complete:true,markings:[{text:"MAHLE",kind:"commercial"}]}],
    vehicleReadings:[{vehicleIndex:0,complete:true,markings:[{text:"MAHLE",kind:"commercial"}]}],
  };
  for(const mutate of [
    e=>{delete e.branding;},
    e=>{e.branding.vehicleReadings[0].markings[0].kind="unknown";},
    e=>{e.branding.vehicleReadings[0].complete=false;},
    e=>{e.branding.vehicleReadings[0].vehicleIndex=1;},
    e=>{e.fullImageReadings[0].vehicleRegion=right;},
    e=>{e.fullImageReadings.push(full("",left));},
    e=>{e.vehicleReadings=[];},
    e=>{e.vehicleReadings.push({vehicleIndex:0,number:""});},
  ]) {
    evidence={...proof("",left),branding:structuredClone(branding)};mutate(evidence);
    const r=await verifyPhotoObservations(image,[observed("",{vehicleRegion:left,team:"MAHLE RACING TEAM"})],undefined,{visibleBrands:true});
    assert.deepEqual(checkedBrandTags(r),[]);
  }
  evidence={...proof("",left),branding};
  const shared=await verifyPhotoObservations(image,[observed("",{vehicleRegion:left}),observed("",{vehicleRegion:left})],undefined,{visibleBrands:true});
  assert.deepEqual(checkedBrandTags(shared),[]);
});
test("invalid optional branding does not block certified numbers, and dual-role text cannot excuse a competing team",async()=>{
  evidence={...proof("110"),branding:{vehicleReadings:"invalid"}};
  let r=await verifyPhotoObservations(image,[observed("110")],undefined,{visibleBrands:true});
  assert.equal(r[0].number,"110");assert.equal(r[0].numberEvidence,PHOTO_NUMBER_POLICY);
  assert.deepEqual(checkedBrandTags(r),[]);
  evidence.branding={
    fullImageReadings:[{readingIndex:0,complete:true,markings:[{text:"Other Racing",kind:"team_and_commercial"}]}],
    vehicleReadings:[{vehicleIndex:0,complete:true,markings:[{text:"Other Racing",kind:"team_and_commercial"}]}],
  };
  r=await verifyPhotoObservations(image,[observed("110",{team:"Other Racing"})],undefined,{visibleBrands:true,videoBranding:true});
  assert.deepEqual(checkedBrandTags(r),["Brand: OTHER RACING"]);
  assert.equal(r[0].team,"Other Racing");
  const linked=matchReferences(r,[{scope:"event",kind:"entry",session:null,updatedAt:new Date(),
    rows:[{number:"110",team:"MAHLE RACING TEAM",car:"BMW M4 GT3",drivers:"Registered lineup"}]}],null,"",true,true)[0];
  assert.equal(linked.source,"visual");assert.equal(linked.drivers,"");
});
test("no image substitution, vehicle creation or evidence for unanchored historical numbers",async()=>{
  evidence=proof("107");
  assert.equal((await verifyPhotoObservations("https://example.invalid/photo.jpg",[observed("107")]))[0].number,"");
  assert.deepEqual(await verifyPhotoObservations(image,[]),[]);
  assert.equal((await verifyPhotoObservations(image,[observed("107",{vehicleRegion:undefined})]))[0].number,"");
  assert.equal(requests.length,0);
});
test("bad car geometry, invented crop indices and incomplete responses fail closed",async()=>{
  globalThis.fetch=async()=>reply({},"length");
  await assert.rejects(verifyPhotoObservations(image,[observed("01")]),/Incomplete number audit/);
  for(const e of [{fullImageReadings:[],vehicleReadings:[{vehicleIndex:1,number:"01"}]},
    {fullImageReadings:[{number:"01",vehicleRegion:[900,0,200,1000]}],vehicleReadings:[]}]) {
    globalThis.fetch=async()=>reply(e);await assert.rejects(verifyPhotoObservations(image,[observed("01")]));
  }
});
test("caption numbers cross the same car-local boundary without model identity fields",async()=>{
  globalThis.fetch=async(_url,options)=>JSON.parse(options.body).messages[0].content.includes("Independently inspect")
    ?reply({fullImageReadings:[],vehicleReadings:[]})
    :reply({vehicles:[{number:"01",vehicleRegion:entire}],scene:"Race Action",team:"Guessed team",drivers:"Guessed person",racingClass:"GT3"});
  const r=await detectRaceNumbers(image);assert.deepEqual(r.numbers,[]);assert.equal(r.scene,"Race Action");
  assert.ok(r.vehicles.every(v=>!v.team&&!v.drivers&&!v.racingClass));
});
test("previous global-tile proof and reference enrichments cannot become local proof; manual values stay protected",()=>{
  const supported=observed("01",{numberEvidence:PHOTO_NUMBER_POLICY});
  assert.equal(supportedPhotoObservations([supported])[0].number,"01");
  for(const numberEvidence of ["pixel-tiles-v1","dual-panel-v1","vehicle-crop-v1"])assert.equal(supportedPhotoObservations([{...supported,numberEvidence}])[0].number,"");
  assert.equal(supportedPhotoObservations([{...supported,vehicleRegion:undefined}])[0].number,"");
  const clean=supportedPhotoObservations([{...supported,source:"reference",team:"Old team",drivers:"Old lineup",vehicle:"BMW M Hybrid V8"}])[0];
  assert.equal(clean.number,"");assert.equal(clean.team,"");assert.equal(clean.vehicle,"");assert.equal(clean.drivers,"");
  const manual={...observed("01"),source:"manual",team:"Operator team",drivers:"Operator lineup"};
  assert.deepEqual(matchReferences([manual],[],null,"",true,true),[manual]);
});
