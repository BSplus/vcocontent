// Deterministic provider-contract replay, NOT an actual AI image evaluation.
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {pool} from "../server/db.ts";
import {matchReferences} from "../server/reference-matching.ts";
import {matchedPhotoCaption} from "../server/caption-proposal.ts";
import {verifyPhotoObservations,supportedPhotoObservations} from "../server/utils/photo-number-evidence.ts";
import {confirmedTeamMarkings,TEAM_MARKING_POLICY} from "../server/utils/video-branding-evidence.ts";
import {identificationSchema} from "../shared/schema.ts";
import {sebringEntry,sebringEvent,sebringDocument,sebringObservations} from "./fixtures/sebring-196.mjs";

const realFetch=globalThis.fetch,realQuery=pool.query;
test.before(()=>{
  globalThis.fetch=async()=>{throw new Error("Network forbidden in isolated replay");};
  pool.query=()=>{throw new Error("Database forbidden in isolated replay");};
});
test.after(async()=>{globalThis.fetch=realFetch;pool.query=realQuery;await pool.end();});
const image="data:image/png;base64,"+(await sharp({create:{
  width:1280,height:720,channels:3,background:"white"}}).png().toBuffer()).toString("base64");
const match=(observations,documents=[sebringDocument],session=null)=>
  matchReferences(observations,documents,session,sebringEvent.title,true,true);
const caption=rows=>matchedPhotoCaption(sebringEvent,"IMSA Esports Global Championship",rows);
const markings=(kind="team",text="Turner")=>[{text,kind}];
const branding=(full=markings(),crop=full)=>({
  fullImageReadings:[{readingIndex:1,complete:true,markings:full}],
  vehicleReadings:[{vehicleIndex:1,complete:true,markings:crop}],
});
const proof=(extra={})=>({
  fullImageReadings:sebringObservations.map(v=>({number:v.number,vehicleRegion:v.vehicleRegion,
    ...(v.number?{panelRegion:[450,580,50,40]}:{})})),
  vehicleReadings:[0,1,2].map(vehicleIndex=>({vehicleIndex,number:sebringObservations[vehicleIndex].number})),
  branding:branding(),...extra,
});
async function verify(evidence=proof(),input=sebringObservations) {
  let calls=0;
  const client={chat:{completions:{create:async request=>{
    calls++;
    assert.match(request.messages[0].content,/No entry-list names or first-pass guesses/);
    return {choices:[{finish_reason:"stop",message:{content:JSON.stringify(evidence)}}]};
  }}}};
  const checked=await verifyPhotoObservations(image,input,client,{visibleBrands:true});
  assert.equal(calls,1);
  return checked;
}
test("saved 196 is applicable and unique, but Turner alone still cannot bypass the team veto",()=>{
  const input=structuredClone(sebringObservations);
  const failed=match(input);
  assert.equal(failed[1].number,"196");
  assert.equal(failed[1].source,"visual");
  assert.equal(caption(failed).matchStatus,"no_unique_match");
  const noHint=structuredClone(input);noHint[1].referenceConstraints[0].team="";
  assert.equal(match(noHint)[1].source,"reference","isolates team veto, not number or list applicability");
  assert.deepEqual(input,sebringObservations);
});
test("independent same-car explicit team marking resolves an initialism prefix, without calling it a sponsor",async()=>{
  const checked=await verify();
  assert.deepEqual(checked[1].teamMarkingEvidence,{policy:TEAM_MARKING_POLICY,markings:["Turner"]});
  assert.equal(checked[1].visibleBrands,undefined,"not a commercial classification");
  assert.equal(checked[1].referenceConstraints[0].team,"Turner","retain the original hint");
  const cached=checked.map(v=>identificationSchema.parse(JSON.parse(JSON.stringify(v))));
  assert.deepEqual(JSON.parse(JSON.stringify(supportedPhotoObservations(cached))),cached);
  const result=match(cached);
  assert.equal(result[1].source,"reference");
  assert.equal(result[1].team,sebringEntry.team);
  assert.equal(result[1].vehicle,sebringEntry.car);
  assert.equal(result[1].drivers,sebringEntry.drivers);
  assert.equal(caption(result).matchStatus,"matched");
  assert.match(caption(result).caption,/#196 BS TURNER — BMW M4 GT3 — Daniel Lafuente, Oskari Rinne$/);
  for(const i of [0,2,3]) {
    assert.equal(result[i].source,"visual");assert.equal(result[i].number,"");assert.equal(result[i].drivers,"");
  }
});
test("commercial-only lettering can clear exactly its hint; unknown, dual-role and different-team lettering cannot masquerade as a sponsor",async()=>{
  const commercial=await verify(proof({branding:branding(markings("commercial","Example Supply"))}),
    sebringObservations.map((v,i)=>i===1?{...v,referenceConstraints:[{team:"Example Supply",vehicle:"",manufacturer:"BMW"}]}:v));
  assert.equal(match(commercial)[1].source,"reference");
  for(const kind of ["unknown","team","team_and_commercial"]) {
    const checked=await verify(proof({branding:branding(markings(kind,"Rival Racing"))}));
    assert.equal(match(checked)[1].source,"visual",kind);
  }
});
test("uncertain, inconsistent, duplicate or absent independent readings leave the original veto unresolved",async()=>{
  const variations=[
    undefined,branding(markings("unknown")),branding(markings(),markings("commercial")),
    branding(markings(),markings("team","Turner Junior")),
    {...branding(),vehicleReadings:[]},
    {...branding(),fullImageReadings:[...branding().fullImageReadings,...branding().fullImageReadings]},
    {...branding(),vehicleReadings:[{...branding().vehicleReadings[0],complete:false}]},
    branding([...markings(),{text:"Unclear",kind:"unknown"}]),
  ];
  for(const raw of variations){
    assert.deepEqual(confirmedTeamMarkings(raw,1,1),[]);
    const checked=await verify(proof({branding:raw}));
    assert.equal(checked[1].teamMarkingEvidence,undefined);
    assert.equal(match(checked)[1].source,"visual");
  }
});
test("all independently checked team markings veto, including rivals omitted by the weak reader",async()=>{
  const checked=await verify(proof({branding:branding([...markings(),{text:"Rival Racing",kind:"team"}])}));
  assert.equal(match(checked)[1].source,"visual");
});
test("duplicate reference identities, ambiguous short names and nonliteral fragments remain blocked",async()=>{
  const checked=await verify();
  for(const row of [
    {...sebringEntry,team:"Rival Racing"},
    {...sebringEntry,drivers:"Different lineup"},
    {...sebringEntry,car:"Ford Mustang GT3"},
    {...sebringEntry,number:"197",team:"Other Turner"},
  ]) assert.equal(match(checked,[{...sebringDocument,rows:[...sebringDocument.rows,row]}])[1].source,"visual");
  for(const text of ["Turn","T","Racing","BS","Turner Junior"]) {
    const input=sebringObservations.map((v,i)=>i===1?{...v,referenceConstraints:[{team:text,vehicle:"",manufacturer:""}]}:v);
    const checked=await verify(proof({branding:branding(markings("team",text))}),input);
    assert.equal(match(checked)[1].source,"visual",text);
  }
});
test("number, geometry, original panel and per-car gates remain prerequisites; old evidence is not upgraded",async()=>{
  const checked=await verify();
  for(const evidence of [
    proof({vehicleReadings:[{vehicleIndex:1,number:"19"}]}),
    proof({fullImageReadings:[{number:"196",vehicleRegion:[710,392,180,169],panelRegion:[740,450,20,20]}]}),
    proof({branding:{...branding(),vehicleReadings:[{vehicleIndex:0,complete:true,markings:markings()}]}}),
  ]) {
    const result=await verify(evidence);
    assert.equal(match(result)[1].source,"visual");
    assert.equal(result[1].teamMarkingEvidence,undefined);
  }
  const panelInput=structuredClone(sebringObservations);panelInput[1].numberPanelRegion=[450,580,50,40];
  assert.equal((await verify(proof(),panelInput))[1].number,"","no supplied-panel reread");
  const shared=structuredClone(sebringObservations);shared[3].vehicleRegion=shared[1].vehicleRegion;
  assert.equal((await verify(proof(),shared))[1].number,"","shared physical car cannot certify two observations");
  const legacy=structuredClone(checked);legacy[1].numberEvidence=undefined;
  assert.equal(supportedPhotoObservations(legacy)[1].teamMarkingEvidence,undefined);
  const untrusted=await verify(proof({branding:undefined}),checked);
  assert.equal(untrusted[1].teamMarkingEvidence,undefined,"new audit strips caller-supplied provenance");
  const manual={...checked[1],source:"manual",team:"Protected team",drivers:"Protected lineup"};
  assert.deepEqual(match([manual]),[manual]);
});
test("wrong session and season row event cannot supply the identity even with checked lettering",async()=>{
  const checked=await verify();
  assert.equal(match(checked,[{...sebringDocument,session:"Race"}])[1].source,"visual");
  const seasonal={...sebringDocument,scope:"season",rows:[{...sebringEntry,eventName:"Different event"}]};
  assert.equal(match(checked,[seasonal])[1].source,"visual");
  assert.equal(match(checked,[{...seasonal,rows:[{...sebringEntry,eventName:sebringEvent.title}]}])[1].source,"reference");
});
