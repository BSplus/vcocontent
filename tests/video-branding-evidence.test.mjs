import test from "node:test";
import assert from "node:assert/strict";
import { confirmedCommercialHints, confirmedVisibleBrands, withoutCommercialTeamHints } from "../server/utils/video-branding-evidence.ts";
import { brandNameFromTag, visibleBrandTags } from "../shared/brand-tags.ts";

const vehicle = {
  number:"96", numberEvidence:"vehicle-crop-v2", vehicleRegion:[0,0,1000,1000],
  team:"MOZA RACING", drivers:"", vehicle:"Race Car", manufacturer:"Cadillac",
  racingClass:"", discipline:"", source:"visual",
  referenceConstraints:[
    {team:"MOZA Racing",manufacturer:"Cadillac",vehicle:"Race Car"},
    {team:"Different Team",manufacturer:"Ferrari",vehicle:"Porsche 911"},
  ],
};
const mark = (text="MOZA RACING", kind="commercial") => ({text,kind});
const proof = () => ({
  fullImageReadings:[{readingIndex:0,complete:true,markings:[mark()]}],
  vehicleReadings:[{vehicleIndex:0,complete:true,markings:[mark("Moza Racing")]}],
});

test("only literal commercial text assessed in both same-car views can be cleared",()=>{
  const hints=confirmedCommercialHints(proof(),vehicle,0,0);
  assert.deepEqual(hints,["MOZA RACING","MOZA Racing"]);
  const resolved=withoutCommercialTeamHints(vehicle,hints);
  assert.equal(resolved.team,"");
  assert.equal(resolved.referenceConstraints[0].team,"");
  assert.deepEqual(resolved.referenceConstraints[1],vehicle.referenceConstraints[1]);
  for(const field of ["number","numberEvidence","vehicleRegion","vehicle","manufacturer","racingClass","discipline"])
    assert.deepEqual(resolved[field],vehicle[field]);
  assert.equal(vehicle.team,"MOZA RACING","Original weak evidence is not mutated");
});
test("visible brands are canonical searchable tags, not team identities",()=>{
  assert.deepEqual(confirmedVisibleBrands(proof(),0,0),["MOZA RACING"]);
  assert.deepEqual(visibleBrandTags(["MOZA Racing","moza racing","", "<script>"]),["Brand: MOZA RACING"]);
  assert.equal(brandNameFromTag("Brand: Moza Racing"),"MOZA RACING");
  assert.equal(brandNameFromTag("Race Car"),undefined);
});
test("a checked sponsor can be tagged beside a competing team without excusing that conflict",()=>{
  const p=proof();
  for(const assessment of [...p.fullImageReadings,...p.vehicleReadings])
    assessment.markings.push(mark("Different Racing","team"));
  assert.deepEqual(confirmedVisibleBrands(p,0,0),["MOZA RACING"]);
  assert.deepEqual(confirmedCommercialHints(p,vehicle,0,0),[]);
  assert.equal(withoutCommercialTeamHints(vehicle,[]).team,"MOZA RACING");
});

for(const [name, mutate] of [
  ["missing evidence", ()=>undefined],
  ["malformed branding", p=>({...p,vehicleReadings:"invalid"})],
  ["no crop assessment", p=>({...p,vehicleReadings:[]})],
  ["no full-frame assessment", p=>({...p,fullImageReadings:[]})],
  ["different vehicle crop", p=>({...p,vehicleReadings:[{...p.vehicleReadings[0],vehicleIndex:1}]})],
  ["different full-frame car", p=>({...p,fullImageReadings:[{...p.fullImageReadings[0],readingIndex:1}]})],
  ["duplicate crop assessment", p=>({...p,vehicleReadings:[...p.vehicleReadings,...p.vehicleReadings]})],
  ["duplicate full assessment", p=>({...p,fullImageReadings:[...p.fullImageReadings,...p.fullImageReadings]})],
  ["incomplete crop", p=>({...p,vehicleReadings:[{...p.vehicleReadings[0],complete:false}]})],
  ["unknown purpose", p=>({...p,vehicleReadings:[{...p.vehicleReadings[0],markings:[mark("MOZA RACING","unknown")]}]})],
  ["explicit team identity", p=>({...p,fullImageReadings:[{...p.fullImageReadings[0],markings:[mark("MOZA RACING","team")]}]})],
  ["another team alongside sponsor", p=>({...p,vehicleReadings:[{...p.vehicleReadings[0],markings:[mark(),mark("Other Racing","team")]}]})],
  ["unassessed identity alongside sponsor", p=>({...p,fullImageReadings:[{...p.fullImageReadings[0],markings:[mark(),mark("ARRC","unknown")]}]})],
  ["partial sponsor name", p=>({...p,vehicleReadings:[{...p.vehicleReadings[0],markings:[mark("MOZA")]}]})],
  ["excessive markings", p=>({...p,vehicleReadings:[{...p.vehicleReadings[0],
    markings:[mark(),mark("A"),mark("B"),mark("C")]}]})],
  ["excessive assessed cars", p=>({...p,vehicleReadings:Array.from({length:4},(_,vehicleIndex)=>
    ({...p.vehicleReadings[0],vehicleIndex}))})],
]) test(`${name} retains the existing veto`,()=>{
  const hints=confirmedCommercialHints(mutate(proof()),vehicle,0,0);
  assert.deepEqual(hints,[]);
  assert.deepEqual(withoutCommercialTeamHints(vehicle,hints),vehicle);
});
