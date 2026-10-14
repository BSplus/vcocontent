import test from "node:test";
import assert from "node:assert/strict";
import { parseVideoOutput, videoOutputSchema } from "../server/video-output.ts";
import { videoFailureRecord } from "../server/video-failures.ts";
import { pool } from "../server/db.ts";

test.after(()=>pool.end());
const frames=Array.from({length:4},(_,i)=>({image:"fixture",timestamp:i+0.25,hash:`hash-${i}`}));
const vehicle={number:"007",numberReadable:true,numberObscured:false,classReadable:false,
  team:"",vehicle:"Race Car",manufacturer:"",racingClass:"",discipline:"",vehicleRegion:null};
const valid=()=>({frames:frames.map((_,index)=>({index,tags:["Race Car"],vehicles:[vehicle]}))});

test("strict output contract requires every frame and explicit unknown fields",()=>{
  const schema=videoOutputSchema(4);
  assert.equal(schema.additionalProperties,false);
  assert.equal(schema.properties.frames.minItems,4);
  assert.equal(schema.properties.frames.maxItems,4);
  const record=schema.properties.frames.items;
  assert.deepEqual(record.properties.index.enum,[0,1,2,3]);
  const fields=record.properties.vehicles.items;
  assert.equal(fields.additionalProperties,false);
  assert.equal(fields.properties.number.pattern,"^[0-9]{0,4}$");
  assert.ok(fields.required.includes("numberObscured"));
  assert.ok(fields.required.includes("vehicleRegion"));
});

test("valid reordered frames retain exact timestamp/hash binding without certifying numbers",()=>{
  const payload=valid();payload.frames.reverse();
  const result=parseVideoOutput(JSON.stringify(payload),"stop",frames);
  assert.deepEqual(result.map(f=>f.timestamp),[3.25,2.25,1.25,0.25]);
  assert.deepEqual(result.map(f=>f.hash),["hash-3","hash-2","hash-1","hash-0"]);
  assert.ok(result.every(f=>f.vehicles[0].number==="007" &&
    !f.vehicles[0].numberEvidence && !f.vehicles[0].vehicleRegion));
  assert.ok(result.every(f=>f.vehicles[0].source==="visual" && !f.vehicles[0].drivers));
});

test("empty-scene frames are valid observations, not missing records",()=>{
  const payload=valid();payload.frames[2]={index:2,tags:[],vehicles:[]};
  assert.equal(parseVideoOutput(JSON.stringify(payload),"stop",frames)[2].vehicles.length,0);
});

for(const [reason,change,finish] of [
  ["truncated",()=>"PRIVATE payload","length"],
  ["non_stop",()=>"PRIVATE payload","content_filter"],
  ["empty",()=>null,"stop"],
  ["oversized",()=>"PRIVATE".repeat(4000),"stop"],
  ["json_syntax",()=>"{PRIVATE payload","stop"],
  ["frame_shape",()=>JSON.stringify({frames:[{index:0,tags:null,vehicles:[]}]}),"stop"],
  ["frame_count",()=>JSON.stringify({frames:valid().frames.slice(0,3)}),"stop"],
  ["frame_indices",()=>JSON.stringify({frames:valid().frames.map(f=>({...f,index:0}))}),"stop"],
  ["vehicle_shape",()=>JSON.stringify({frames:valid().frames.map(f=>({...f,vehicles:[{...vehicle,number:null}]}))}),"stop"],
]) test(`${reason} fails closed with bounded diagnostics, never raw output`,()=>{
  assert.throws(()=>parseVideoOutput(change(),finish,frames),error=>{
    assert.equal(error.code,"AI_OUTPUT_INVALID");
    assert.equal(error.details.outputReason,reason);
    assert.equal(error.retryable,true);
    const record=JSON.stringify(videoFailureRecord(1,1,error));
    assert.ok(!record.includes("PRIVATE"));
    assert.ok(!record.includes("payload"));
    assert.equal(error.details.expectedFrames,4);
    return true;
  });
});

test("one-based indices fail closed rather than attaching observations to another frame",()=>{
  assert.throws(()=>parseVideoOutput(JSON.stringify({frames:valid().frames.map(f=>({...f,index:f.index+1}))}),
    "stop",frames),error=>error.details.outputReason==="frame_indices");
});
