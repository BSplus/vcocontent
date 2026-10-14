import test from "node:test";
import assert from "node:assert/strict";
import {parseOnlineBrandReceipt,createOnlineBrandVerifier,managedWebLookup} from "../server/brand-online-verification.ts";
import {brandOnlineResponse} from "./helpers/brand-online-fixture.mjs";

test("exact brand requires a completed real-search record and cited authoritative naming evidence",()=>{
  const proof=brandOnlineResponse("MOZA RACING");
  assert.equal(parseOnlineBrandReceipt(proof,"MOZA RACING",100).name,"MOZA RACING");
});
test("pretty-printed valid JSON preserves the same source checks",()=>{
  const proof=brandOnlineResponse("MOZA RACING"),part=proof.output[1].content[0];
  const parsed=JSON.parse(part.text.split("\n")[1]);
  part.text="Authoritative cited evidence.\n"+JSON.stringify(parsed,null,2);
  assert.equal(parseOnlineBrandReceipt(proof,"MOZA RACING",100).name,"MOZA RACING");
});
test("non-Latin names cannot match unrelated Latin source titles as empty strings",()=>{
  const proof=brandOnlineResponse("比亚迪");
  assert.equal(parseOnlineBrandReceipt(proof,"比亚迪",100).name,"比亚迪");
  proof.output[1].content[0].annotations[0].title="Some Other Company";
  assert.equal(parseOnlineBrandReceipt(proof,"比亚迪",100),undefined);
});
test("two verdicts and a fabricated quote outside the actual retrieved evidence are rejected",()=>{
  const proof=brandOnlineResponse("MOZA RACING");
  proof.brandSourceText="No such literal brand name was retrieved.";
  assert.equal(parseOnlineBrandReceipt(proof,"MOZA RACING",100),undefined);
  delete proof.brandSourceText;
  proof.output[1].content[0].text+="\n"+proof.output[1].content[0].text.split("\n")[1];
  assert.equal(parseOnlineBrandReceipt(proof,"MOZA RACING",100),undefined);
});
test("cited prose is classified separately and a pretty-printed verdict retains real source provenance",async()=>{
  let searches=0,classifications=0;
  const search=brandOnlineResponse("MOZA RACING"),part=search.output[1].content[0];
  const original=JSON.parse(part.text.split("\n")[1]);
  part.text="MOZA RACING official commercial brand";
  const client={
    responses:{create:async()=>{searches++;return search;}},
    chat:{completions:{create:async payload=>{
      classifications++;
      assert.equal(payload.response_format.json_schema.strict,true);
      assert.ok(JSON.parse(payload.messages[1].content).citations.length>0);
      return {choices:[{finish_reason:"stop",message:{content:JSON.stringify(original,null,2)}}]};
    }}},
  };
  const verifier=createOnlineBrandVerifier({lookup:(name,signal)=>managedWebLookup(name,signal,client)});
  assert.deepEqual(await verifier.filter(["Day","Brand: MOZA RACING"]),["Day","Brand: MOZA RACING"]);
  assert.equal(searches,1);assert.equal(classifications,1);
});
for(const [name,mutate] of [
  ["model assertion without a web search",r=>{r.output.shift();}],
  ["unfinished web search",r=>{r.output[0].status="in_progress";}],
  ["incomplete response",r=>{r.status="incomplete";}],
  ["missing actual URL citation",r=>{r.output[1].content[0].annotations=[];}],
  ["citation to another page",r=>{r.output[1].content[0].annotations[0].url="https://another-site.com/";}],
  ["generic source title without the name",r=>{r.output[1].content[0].annotations[0].title="Directory Home";}],
  ["nearby but different company",r=>{r.output[1].content[0].text=JSON.stringify({name:"MOZA",confirmed:true,ambiguous:false,officialUrl:"https://brand-fixture.com/moza%20racing",sourceQuote:"MOZA"});}],
  ["ambiguous company",r=>{r.output[1].content[0].text=JSON.stringify({name:"MOZA RACING",confirmed:true,ambiguous:true,officialUrl:"https://brand-fixture.com/moza%20racing",sourceQuote:"MOZA RACING"});}],
  ["private/insecure source",r=>{r.output[1].content[0].text=JSON.stringify({name:"MOZA RACING",confirmed:true,ambiguous:false,officialUrl:"http://127.0.0.1/",sourceQuote:"MOZA RACING"});}],
  ["invented quote without the exact name",r=>{r.output[1].content[0].text=JSON.stringify({name:"MOZA RACING",confirmed:true,ambiguous:false,officialUrl:"https://brand-fixture.com/moza%20racing",sourceQuote:"A racing company"});}],
])test(`${name} is omitted`,()=>{
  const proof=brandOnlineResponse("MOZA RACING");mutate(proof);
  assert.equal(parseOnlineBrandReceipt(proof,"MOZA RACING",100),undefined);
});

test("cache and in-flight coalescing prevent a web lookup per file/frame",async()=>{
  let calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const verifier=createOnlineBrandVerifier({lookup:async name=>{calls++;await gate;return brandOnlineResponse(name);}});
  const first=verifier.filter(["Day","Brand: MOZA RACING"]);
  const second=verifier.filter(["Race Car","Brand: MOZA RACING"]);
  release();
  assert.deepEqual(await first,["Day","Brand: MOZA RACING"]);
  assert.deepEqual(await second,["Race Car","Brand: MOZA RACING"]);
  assert.deepEqual(await verifier.filter(["Brand: MOZA RACING"]),["Brand: MOZA RACING"]);
  assert.equal(calls,1);
});
test("ordinary tags survive unsupported search and failures are cached",async()=>{
  let calls=0;
  const verifier=createOnlineBrandVerifier({lookup:async()=>{calls++;throw new Error("Unsupported provider");}});
  assert.deepEqual(await verifier.filter(["Day","Brand: UNCERTAIN","Race Car"]),["Day","Race Car"]);
  assert.deepEqual(await verifier.filter(["Brand: UNCERTAIN","Night"]),["Night"]);
  assert.equal(calls,1);
});
test("hung online checks abort at the deadline without stopping ordinary tags",async()=>{
  let signal;
  const verifier=createOnlineBrandVerifier({timeoutMs:20,lookup:async(_name,s)=>{signal=s;return new Promise(()=>{});}});
  const start=Date.now();
  assert.deepEqual(await verifier.filter(["Day","Brand: UNKNOWN"]),["Day"]);
  assert.ok(Date.now()-start<250);assert.equal(signal.aborted,true);
});
test("only one new lookup runs per analysis; cached positives remain available",async()=>{
  let calls=0;
  const verifier=createOnlineBrandVerifier({lookup:async name=>{calls++;return brandOnlineResponse(name);}});
  assert.deepEqual(await verifier.filter(["Day","Brand: FIRST","Brand: SECOND"]),["Day","Brand: FIRST"]);
  assert.equal(calls,1);
  assert.deepEqual(await verifier.filter(["Brand: FIRST","Brand: SECOND"]),["Brand: FIRST","Brand: SECOND"]);
  assert.equal(calls,2);
});
test("expired positives are checked again; no malformed reserved tags bypass verification",async()=>{
  let clock=0,calls=0;
  const verifier=createOnlineBrandVerifier({now:()=>clock,positiveTtlMs:50,
    lookup:async name=>{calls++;return brandOnlineResponse(name);}});
  await verifier.filter(["Brand: FIRST"]);clock=51;
  assert.deepEqual(await verifier.filter(["Day","Brand: FIRST","Brand: <script>","brand: unverified"]),["Day","Brand: FIRST"]);
  assert.equal(calls,2);
});
