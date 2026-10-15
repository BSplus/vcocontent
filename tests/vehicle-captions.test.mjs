import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {matchedPhotoCaption,communityCaption,proposeCaption} from "../server/caption-proposal.ts";
import {verifyPhotoObservations} from "../server/utils/photo-number-evidence.ts";
import {aggregateVideo} from "../server/video-recognition.ts";
import {canonicalVehicleMake,VEHICLE_MAKE_POLICY} from "../shared/vehicle-makes.ts";
import {insertEventSchema} from "../shared/schema.ts";

const event={title:"One-make Cup",date:new Date("2026-10-28"),round:"2",track:"Spa",platform:"iRacing"};
const region=[100,100,400,600];
const car=(extra={})=>({number:"",numberReadable:false,team:"",drivers:"",vehicle:"Race Car",
  manufacturer:"",racingClass:"",discipline:"",source:"visual",vehicleRegion:region,...extra});
const checked=car({manufacturer:"Porsche",manufacturerEvidence:VEHICLE_MAKE_POLICY});
const reference=car({number:"27",team:"Example Team",source:"reference",vehicle:"Porsche 911 GT3 R",
  referenceVehicle:"Porsche 911 GT3 R",referenceManufacturer:"Porsche"});

test("entry model is beside the number and overrides conflicting event vehicle context",()=>{
  const caption=matchedPhotoCaption({...event,vehicle:"BMW M4"},null,[reference]).caption;
  assert.ok(caption.includes("#27 Example Team — Porsche 911 GT3 R"));
  assert.ok(!caption.includes("BMW M4"));
});
test("registered maker fallback never prints an inherited guessed model",()=>{
  const caption=matchedPhotoCaption(event,null,[{...reference,referenceVehicle:"",vehicle:"Guessed 911 model"}]).caption;
  assert.ok(caption.includes("#27 Example Team — Porsche"));assert.ok(!caption.includes("Guessed"));
});
test("entry and manually confirmed caption proposals fall back to manufacturer",()=>{
  const row={number:"27",team:"Team",car:"",drivers:"",manufacturer:"Ferrari"};
  assert.ok(proposeCaption(event,[row],["27"],null).suggestion.includes("#27 Team — Ferrari"));
  assert.ok(matchedPhotoCaption(event,null,[car({...row,vehicle:"",source:"manual"})],true).caption.includes("Ferrari"));
});
test("one-make event context is optional and no-match context wins over visual guessing",()=>{
  assert.ok(communityCaption({...event,vehicle:"Porsche 911 GT3 Cup"}).includes("Porsche 911 GT3 Cup"));
  assert.ok(!communityCaption(event).includes("Vehicle:"));
  const caption=matchedPhotoCaption({...event,vehicle:"Porsche 911 GT3 Cup"},null,[],false,
    [car({manufacturer:"Ferrari",manufacturerEvidence:VEHICLE_MAKE_POLICY})]).caption;
  assert.ok(caption.includes("Porsche 911 GT3 Cup"));assert.ok(!caption.includes("Ferrari"));
});
test("no entry list: checked manufacturer only, never a visual model or number/team guess",()=>{
  const caption=matchedPhotoCaption(event,null,[{...checked,vehicle:"911 GT3 R",number:"96",team:"Imagined team"}]).caption;
  assert.ok(caption.endsWith(" | Porsche"));
  assert.ok(!/Vehicle makes?:/i.test(caption));
  assert.ok(!caption.includes("911")&&!caption.includes("#96")&&!caption.includes("Imagined"));
});
test("uncertain makes, sponsor names and invalid car geometry remain context-only",()=>{
  for(const item of [car({manufacturer:"Porsche"}),car({manufacturer:"MOZA",manufacturerEvidence:VEHICLE_MAKE_POLICY}),
    {...checked,source:"manual"},{...checked,vehicleRegion:[0,0,0,0]}]){
    assert.equal(matchedPhotoCaption(event,null,[item]).caption,communityCaption(event));
  }
});
test("multiple checked manufacturers appear without a vehicle-make label",()=>{
  const caption=matchedPhotoCaption(event,null,[checked,
    {...checked,manufacturer:"Ferrari"}]).caption;
  assert.ok(caption.endsWith(" | Porsche, Ferrari"));
  assert.ok(!/Vehicle makes?:/i.test(caption));
});
test("manufacturer aliases do not create sponsor/model aliases",()=>{
  assert.equal(canonicalVehicleMake("Mercedes-AMG"),"Mercedes-Benz");
  assert.equal(canonicalVehicleMake("MOZA Racing"),undefined);
  assert.equal(canonicalVehicleMake("Porsche 911 GT3 R"),undefined);
});
test("event vehicle accepts trim, empty/null, rejects overlong strings",()=>{
  const valid={...event,description:"Context"};
  assert.equal(insertEventSchema.parse({...valid,vehicle:"  Porsche Cup  "}).vehicle,"Porsche Cup");
  assert.equal(insertEventSchema.parse({...valid,vehicle:"  "}).vehicle,null);
  assert.equal(insertEventSchema.parse({...valid,vehicle:null}).vehicle,null);
  assert.equal(insertEventSchema.parse(valid).vehicle,undefined);
  assert.equal(insertEventSchema.safeParse({...valid,vehicle:"x".repeat(161)}).success,false);
});

const pixels=Buffer.from(Array.from({length:400*240*3},(_,i)=>(i*37+i%19)%255));
const image="data:image/webp;base64,"+(await sharp(pixels,{raw:{width:400,height:240,channels:3}})
  .webp({quality:90}).toBuffer()).toString("base64");
function audit(full="Porsche",crop="Porsche",confident=true,extras={}) {
  return {fullImageReadings:[{number:"",vehicleRegion:region,manufacturer:full,manufacturerConfident:true}],
    vehicleReadings:[{vehicleIndex:0,number:"",manufacturer:crop,manufacturerConfident:confident}],...extras};
}
async function verify(data,vehicles=[car()],options={visualMakes:true}) {
  let requests=0;
  const client={chat:{completions:{create:async()=>{requests++;return {choices:[{
    message:{content:JSON.stringify(data)},finish_reason:"stop"}]};}}}};
  const result=await verifyPhotoObservations(image,vehicles,client,options);
  assert.equal(requests,1);return result;
}
test("full-image and source-crop make agreement works without numbers",async()=>{
  const [v]=await verify(audit());
  assert.equal(v.manufacturer,"Porsche");assert.equal(v.manufacturerEvidence,VEHICLE_MAKE_POLICY);
  assert.equal(v.number,"");
});
test("one clear Ferrari factory logo is sufficient in either view without a second positive verdict",async()=>{
  for(const logoView of ["full","crop"]){
    const data=audit("","",false);
    const reading=logoView==="full"?data.fullImageReadings[0]:data.vehicleReadings[0];
    Object.assign(reading,{manufacturer:"Ferrari",manufacturerConfident:true,manufacturerBasis:"factory_logo"});
    const [v]=await verify(data);
    assert.equal(v.manufacturer,"Ferrari");assert.equal(v.manufacturerEvidence,VEHICLE_MAKE_POLICY);
    assert.ok(matchedPhotoCaption(event,null,[v]).caption.endsWith(" | Ferrari"));
  }
});
test("a clear factory logo outranks a shape suggestion, without certifying mismatching race numbers",async()=>{
  const data=audit("Ferrari","Porsche");
  Object.assign(data.fullImageReadings[0],{number:"107",manufacturerBasis:"factory_logo"});
  Object.assign(data.vehicleReadings[0],{number:"07",manufacturerBasis:"shape"});
  const [v]=await verify(data,[car({number:"107",numberReadable:true})]);
  assert.equal(v.manufacturer,"Ferrari");assert.equal(v.manufacturerEvidence,VEHICLE_MAKE_POLICY);
  assert.equal(v.number,"");assert.equal(v.numberEvidence,undefined);
});
test("incompatible factory logos, equipment names and explicitly uncertain/malformed bases do not certify a make",async()=>{
  for(const [full,crop,basis] of [["Ferrari","Porsche","factory_logo"],["MOZA","MOZA","factory_logo"],
    ["Ferrari","Ferrari","uncertain"],["Ferrari","Ferrari","sponsor_logo"]]){
    const data=audit(full,crop);
    data.fullImageReadings[0].manufacturerBasis=basis;data.vehicleReadings[0].manufacturerBasis=basis;
    const [v]=await verify(data);
    assert.equal(v.manufacturerEvidence,undefined);
  }
});
test("missing/uncertain/disagreeing manufacturer fields do not certify makes",async()=>{
  for(const data of [audit("Porsche","Ferrari"),audit("Porsche","Porsche",false),audit("MOZA","MOZA"),
    {fullImageReadings:[{number:"",vehicleRegion:region}],vehicleReadings:[{vehicleIndex:0,number:""}]}]){
    const [v]=await verify(data,[checked]);
    assert.equal(v.manufacturerEvidence,undefined);
    assert.equal(matchedPhotoCaption(event,null,[v]).caption,communityCaption(event));
  }
});
test("a shared/ambiguous car anchor does not certify either maker",async()=>{
  const vehicles=await verify(audit(),[car(),car()]);
  assert.ok(vehicles.every(v=>!v.manufacturerEvidence));
});
test("video source-bound checks retain makes while legacy/unchecked frames cannot supply them",()=>{
  const frame={hash:"source",timestamp:1,tags:[],vehicles:[checked],
    numberCheck:{policy:"",hash:"source",timestamp:1,status:"verified",vehicles:[checked]}};
  // The current video pipeline token comes from the actual helper.
  return import("../server/video-recognition.ts").then(({VIDEO_NUMBER_PIPELINE})=>{
    frame.numberCheck.policy=VIDEO_NUMBER_PIPELINE;
    const verified=aggregateVideo([frame]);
    assert.ok(matchedPhotoCaption(event,null,verified.vehicles).caption.endsWith(" | Porsche"));
    frame.numberCheck.hash="stale";
    const stale=aggregateVideo([frame]);
    assert.equal(matchedPhotoCaption(event,null,stale.vehicles).caption,communityCaption(event));
  });
});
