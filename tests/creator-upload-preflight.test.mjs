import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { File } from "node:buffer";
import { creatorUploadPlan, creatorSelection, creatorQuotaMessage, PREVIEW_ALLOWANCE } from "../client/src/lib/creator-upload-preflight.ts";
const usage=(extra={})=>({bytes:0,photos:0,galleries:1,unknown:0,pendingCleanup:0,
  limits:{bytes:500_000_000,photos:1000,galleries:5,imageBytes:5_000_000},...extra});
const policy={imageBytes:5_000_000,zipCount:100,zipBytes:100*1048576};
async function zip(name,files){
  const archive=new JSZip();
  for(const [path,size] of Object.entries(files))archive.file(path,new Uint8Array(size));
  return new File([await archive.generateAsync({type:"uint8array",compression:"DEFLATE"})],name,{type:"application/zip"});
}
test("preflight accounts for preview reservations, skips a large file and still fits a later small file",()=>{
  const plan=creatorUploadPlan([{size:200000},{size:500000},{size:100000}],usage({bytes:499_400_000}));
  assert.equal(plan[0],undefined);assert.match(plan[1],/storage allowance/);assert.equal(plan[2],undefined);
  assert.equal(creatorUploadPlan([{size:1}],usage({bytes:500_000_000-1-PREVIEW_ALLOWANCE}))[0],undefined);
});
test("photo limits, exception capacities, unknown usage and recovery receipts are distinct",()=>{
  assert.match(creatorUploadPlan([{size:1}],usage({photos:1000}))[0],/Photo allowance/);
  assert.equal(creatorUploadPlan([{size:1}],usage({photos:1000,limits:{...usage().limits,photos:2000}}))[0],undefined);
  assert.match(creatorUploadPlan([{size:1}],usage({unknown:1}))[0],/unknown/);
  assert.match(creatorUploadPlan([{size:1}],undefined)[0],/could not be checked/);
  assert.equal(creatorUploadPlan([{size:1,recovery:true}],undefined)[0],undefined);
  assert.equal(creatorQuotaMessage("Your storage is full (500 MB)."),true);
  assert.equal(creatorQuotaMessage("You have reached the maximum of 1,000 photos."),true);
  assert.equal(creatorQuotaMessage("Save not confirmed."),false);
});
test("oversized ZIP members and unsupported files do not discard valid siblings",async()=>{
  const selected=await creatorSelection([await zip("photos.zip",{"small.jpg":100,"large.jpg":5_000_001,"notes.txt":20,"last.png":110}),
    new File(["ok"],"direct.jpg",{type:"image/jpeg"}),new File(["video"],"clip.mp4",{type:"video/mp4"})],policy,0);
  assert.equal(selected.entries.filter(e=>!e.error).length,3);
  assert.equal(selected.entries.filter(e=>e.error).length,3);
  assert.deepEqual(selected.entries.filter(e=>!e.error).map(e=>e.file.size),[100,110,2]);
});
test("multiple ZIPs and loose photos share one batch-count and expansion budget",async()=>{
  const selected=await creatorSelection([new File(["ok"],"loose.jpg",{type:"image/jpeg"}),
    await zip("one.zip",{"a.jpg":20,"b.jpg":20}),await zip("two.zip",{"c.jpg":20,"d.jpg":20})],
    {...policy,zipCount:3},0);
  assert.equal(selected.entries.filter(e=>!e.error).length,3);
  assert.equal(selected.entries.filter(e=>e.error).length,2);
  const expanded=await creatorSelection([await zip("one.zip",{"a.jpg":140}),await zip("two.zip",{"b.jpg":140})],
    {...policy,zipBytes:200},0);
  assert.equal(expanded.entries.filter(e=>!e.error).length,1);
  assert.match(expanded.entries.find(e=>e.error).error,/Combined ZIP expansion/);
  const full=await creatorSelection([await zip("later.zip",{"a.jpg":1})],policy,100);
  assert.match(full.entries[0].error,/Selection limit/);
});
