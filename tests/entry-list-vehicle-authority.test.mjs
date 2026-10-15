import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {matchReferences,visualMakeNeeded} from "../server/reference-matching.ts";
import {matchedPhotoCaption} from "../server/caption-proposal.ts";
import {verifyPhotoObservations,PHOTO_NUMBER_POLICY} from "../server/utils/photo-number-evidence.ts";
import {VEHICLE_MAKE_POLICY} from "../shared/vehicle-makes.ts";
import {aggregateVideo,VIDEO_NUMBER_PIPELINE} from "../server/video-recognition.ts";

const event={title:"Fixture race",date:new Date("2026-10-28"),track:"Spa",platform:"iRacing"};
const region=[100,100,400,600],otherRegion=[600,100,350,600];
const observed=(extra={})=>({number:"027",team:"",drivers:"",vehicle:"Guessed model",
  manufacturer:"Ferrari",racingClass:"",discipline:"",source:"visual",vehicleRegion:region,
  numberEvidence:PHOTO_NUMBER_POLICY,manufacturerEvidence:VEHICLE_MAKE_POLICY,...extra});
const row=(extra={})=>({number:"27",team:"Registered Team",car:"Porsche 911 GT3 R",
  manufacturer:"Porsche",drivers:"Registered Lineup",racingClass:"",discipline:"",...extra});
const docs=(rows=[row()],extra={})=>[{scope:"event",kind:"entry",session:null,
  rows,updatedAt:new Date(0),...extra}];
const match=(vehicles,documents=docs())=>matchReferences(vehicles,documents,null,event.title,true,true);
const caption=(vehicles,documents=docs(),context=event)=>
  matchedPhotoCaption(context,null,match(vehicles,documents)).caption;

test("independently checked numbers use registered model/make, not conflicting visual hints",()=>{
  const v=observed({referenceConstraints:[{vehicle:"Ferrari 296",manufacturer:"Ferrari",team:""}]});
  const [matched]=match([v]);
  assert.equal(matched.source,"reference");
  assert.equal(matched.manufacturer,"Porsche");
  assert.equal(matched.manufacturerEvidence,undefined);
  assert.match(caption([v]),/#027 Registered Team — Porsche 911 GT3 R — Registered Lineup/);
  assert.doesNotMatch(caption([v]),/Ferrari|Guessed|Vehicle makes?:/);
  const modelOnly=docs([row({manufacturer:""})]);
  assert.equal(match([v],modelOnly)[0].manufacturer,"");
  assert.match(caption([v],modelOnly),/Porsche 911 GT3 R/);
  assert.match(caption([v],docs([row({car:"",manufacturer:"BMW"})])),/— BMW —/);
});

test("empty reference vehicle fields use only the same car's verified make, after event context",()=>{
  const empty=docs([row({car:"",manufacturer:""})]);
  assert.match(caption([observed()],empty),/— Ferrari — Registered Lineup/);
  assert.doesNotMatch(caption([observed({manufacturerEvidence:undefined})],empty),/Ferrari|Guessed/);
  assert.match(caption([observed()],empty,{...event,vehicle:"Mazda MX-5 Cup"}),/— Mazda MX-5 Cup —/);
  assert.doesNotMatch(caption([observed()],empty,{...event,vehicle:"Mazda MX-5 Cup"}),/Ferrari/);
  // Another car's verified make cannot fill the matched car's empty fields.
  const mixed=caption([observed({manufacturer:"",manufacturerEvidence:undefined}),
    observed({number:"",vehicleRegion:otherRegion,manufacturer:"BMW"})],empty);
  assert.doesNotMatch(mixed,/Ferrari|BMW|Guessed/);
});

test("reference precedence does not bypass incomplete digits, ambiguity, team or session guards",()=>{
  assert.equal(match([observed({numberEvidence:undefined})])[0].source,"visual");
  assert.equal(match([observed({number:"27",team:"Other Team"})],
    docs([row(),row({number:"99",team:"Other Team"})]))[0].source,"visual");
  assert.equal(match([observed()],docs([row(),row({car:"BMW M4"})]))[0].source,"visual");
  assert.equal(match([observed()],docs([row()],{session:"Qualifying"}))[0].source,"visual");
  const manual=observed({source:"manual"});
  assert.deepEqual(match([manual])[0],manual);
  assert.ok(caption([observed()],[]).endsWith(" | Ferrari"));
  assert.doesNotMatch(caption([observed()],[]),/#027|Registered|Guessed/);
});

test("make scheduling respects reference model/maker, missing entries, session and explicit event fallback",()=>{
  for(const entry of [row(),row({manufacturer:""}),row({car:""})]) {
    assert.equal(visualMakeNeeded(docs([entry]),null,event.title)(observed()),false);
  }
  assert.equal(visualMakeNeeded(docs([row({car:"",manufacturer:""})]),null,event.title)(observed()),true);
  assert.equal(visualMakeNeeded(docs(),null,event.title)(observed({number:"99"})),true);
  assert.equal(visualMakeNeeded(docs(),null,event.title)(observed({number:""})),true);
  assert.equal(visualMakeNeeded(docs([row()],{session:"Race 2"}),null,event.title)(observed()),true);
  assert.equal(visualMakeNeeded(docs([row(),row({car:"BMW M4"})]),null,event.title)(observed()),true);
  assert.equal(visualMakeNeeded([],null,event.title,"Mazda MX-5 Cup")(observed()),false);
});

const pixels=Buffer.from(Array.from({length:400*240*3},(_,i)=>(i*37+i%19)%255));
const image="data:image/webp;base64,"+(await sharp(pixels,{raw:{width:400,height:240,channels:3}})
  .webp({quality:90}).toBuffer()).toString("base64");
function audit(number="027") {
  return {fullImageReadings:[{number,vehicleRegion:region,panelRegion:[200,300,100,100],
    manufacturer:"Ferrari",manufacturerConfident:true,manufacturerBasis:"factory_logo"}],
    vehicleReadings:[{vehicleIndex:0,number,manufacturer:"Ferrari",
      manufacturerConfident:true,manufacturerBasis:"factory_logo"}]};
}
async function verifySequence(responses,documents=docs()) {
  const requests=[];
  const client={chat:{completions:{create:async body=>{
    requests.push(body);
    const content=responses[requests.length-1];
    assert.ok(content,"No unexpected provider calls");
    return {choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]};
  }}}};
  const vehicles=await verifyPhotoObservations(image,[observed()],client,{
    visibleBrands:true,visualMakes:true,visualMakeNeeded:visualMakeNeeded(documents,null,event.title)});
  return {vehicles,requests};
}

test("reference-covered number still gets independent number/brand checks but no manufacturer prompt",async()=>{
  const {vehicles,requests}=await verifySequence([audit()]);
  assert.equal(requests.length,1);
  assert.doesNotMatch(requests[0].messages[0].content,/For manufacturer checking/);
  assert.match(requests[0].messages[0].content,/BODYWORK branding/);
  assert.equal(vehicles[0].numberEvidence,PHOTO_NUMBER_POLICY);
  assert.equal(vehicles[0].manufacturerEvidence,undefined);
  assert.match(caption(vehicles),/Porsche 911 GT3 R/);
});

test("a reference row without vehicle details requests checked visual fallback in the same audit",async()=>{
  const empty=docs([row({car:"",manufacturer:""})]);
  const {vehicles,requests}=await verifySequence([audit()],empty);
  assert.equal(requests.length,1);
  assert.match(requests[0].messages[0].content,/For manufacturer checking/);
  assert.equal(vehicles[0].manufacturerEvidence,VEHICLE_MAKE_POLICY);
  assert.match(caption(vehicles,empty),/— Ferrari — Registered Lineup/);
});

test("a failed provisional number cannot authorize an entry or suppress visual no-match fallback",async()=>{
  const {vehicles,requests}=await verifySequence([audit(""),audit("")]);
  assert.equal(requests.length,2);
  assert.doesNotMatch(requests[0].messages[0].content,/For manufacturer checking/);
  assert.match(requests[1].messages[0].content,/For manufacturer checking/);
  assert.equal(vehicles[0].number,"");
  assert.equal(vehicles[0].numberEvidence,undefined);
  assert.equal(vehicles[0].manufacturer,"Ferrari");
  assert.ok(caption(vehicles).endsWith(" | Ferrari"));
  assert.doesNotMatch(caption(vehicles),/Registered|#027/);
});

function checkedFrame(vehicles,hash) {
  return {hash,timestamp:0,tags:[],vehicles:[],numberCheck:{
    policy:VIDEO_NUMBER_PIPELINE,hash,timestamp:0,status:"verified",vehicles}};
}
test("video visual make/model disagreements never displace entry facts or transfer frame descriptors",()=>{
  const result=aggregateVideo([checkedFrame([observed()],"a"),
    checkedFrame([observed({number:"27",manufacturer:"BMW",vehicle:"BMW M4",vehicleRegion:otherRegion})],"b")]);
  assert.equal(result.vehicles.filter(v=>v.number).length,2);
  assert.doesNotMatch(caption(result.vehicles),/Ferrari|BMW|Guessed/);
  assert.match(caption(result.vehicles),/Porsche 911 GT3 R/);
  const empty=docs([row({car:"",manufacturer:""})]);
  const independent=aggregateVideo([checkedFrame([observed({manufacturer:"",manufacturerEvidence:undefined})],"c"),
    checkedFrame([observed({number:"",manufacturer:"BMW",vehicleRegion:otherRegion})],"d")]);
  assert.doesNotMatch(caption(independent.vehicles,empty),/BMW|Ferrari|Guessed/);
});
