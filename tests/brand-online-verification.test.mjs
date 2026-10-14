import test from "node:test";
import assert from "node:assert/strict";
import {parseOnlineBrandReceipt,createOnlineBrandVerifier,managedWebLookup} from "../server/brand-online-verification.ts";
import {brandOnlineResponse} from "./helpers/brand-online-fixture.mjs";

test("a named ordinary product search result is enough",()=>{
  const proof=brandOnlineResponse("MOZA RACING");
  assert.equal(parseOnlineBrandReceipt(proof,"MOZA RACING",100).name,"MOZA RACING");
});
test("mozaracing.com is enough even with a generic website title",()=>{
  const proof=brandOnlineResponse("MOZA RACING"),part=proof.output[1].content[0];
  part.text="Website found.";
  part.annotations[0]={type:"url_citation",url:"https://mozaracing.com/?utm_source=search",title:"Home"};
  assert.equal(parseOnlineBrandReceipt(proof,"MOZA RACING",100).sourceUrl,"https://mozaracing.com/?utm_source=search");
});
test("retailer results work without an official website or structured verdict",()=>{
  const proof=brandOnlineResponse("MOZA RACING");
  proof.output[1].content[0].annotations[0]={type:"url_citation",url:"https://sim-shop.com/products/wheel",title:"Moza Racing R12 Wheel Base – Buy Online"};
  proof.output[1].content[0].text="Product available from a retailer.";
  assert.equal(parseOnlineBrandReceipt(proof,"MOZA RACING",100).sourceUrl,"https://sim-shop.com/products/wheel");
});
test("differences in quotes, JSON formatting and URL tracking no longer veto a real result",()=>{
  const proof=brandOnlineResponse("MOZA RACING");
  proof.output[1].content[0].text='No JSON, quote or classifier required.';
  proof.output[1].content[0].annotations[0].url+="?utm_source=search";
  assert.equal(parseOnlineBrandReceipt(proof,"MOZA RACING",100).name,"MOZA RACING");
});
test("non-Latin names cannot match unrelated Latin source titles as empty strings",()=>{
  const proof=brandOnlineResponse("比亚迪");
  assert.equal(parseOnlineBrandReceipt(proof,"比亚迪",100).name,"比亚迪");
  proof.output[1].content[0].annotations[0].title="Some Other Company";
  assert.equal(parseOnlineBrandReceipt(proof,"比亚迪",100),undefined);
});
test("newer search source records and legacy completed search records work",()=>{
  const proof=brandOnlineResponse("MOZA RACING");
  proof.output[1].content[0].annotations=[];
  proof.output[0].action.sources=[{url:"https://sim-shop.com/",title:"MOZA RACING Products"}];
  assert.equal(parseOnlineBrandReceipt(proof,"MOZA RACING",100).name,"MOZA RACING");
  const legacy=brandOnlineResponse("MOZA RACING");delete legacy.output[0].action;
  assert.equal(parseOnlineBrandReceipt(legacy,"MOZA RACING",100).name,"MOZA RACING");
});
test("one web lookup suffices; no secondary model classification is called",async()=>{
  let searches=0,classifications=0;
  const search=brandOnlineResponse("MOZA RACING");
  const client={
    responses:{create:async payload=>{searches++;assert.equal(payload.store,false);return search;}},
    chat:{completions:{create:async()=>{classifications++;throw new Error("Must not classify");}}},
  };
  const verifier=createOnlineBrandVerifier({lookup:(name,signal)=>managedWebLookup(name,signal,client)});
  assert.deepEqual(await verifier.filter(["Day","Brand: MOZA RACING"]),["Day","Brand: MOZA RACING"]);
  assert.equal(searches,1);assert.equal(classifications,0);
});
for(const [name,mutate] of [
  ["model assertion without a web search",r=>{r.output.shift();}],
  ["unfinished web search",r=>{r.output[0].status="in_progress";}],
  ["incomplete response",r=>{r.status="incomplete";}],
  ["missing actual URL citation",r=>{r.output[1].content[0].annotations=[];}],
  ["generic source title without the name",r=>{r.output[1].content[0].annotations[0].title="Directory Home";}],
  ["nearby but different company",r=>{r.output[1].content[0].annotations[0].title="NOZA RACING Products";}],
  ["private/insecure source",r=>{r.output[1].content[0].annotations[0].url="http://127.0.0.1/";}],
  ["fictional-only result",r=>{r.output[1].content[0].annotations[0].title="MOZA RACING – Fictional Company";}],
  ["lookalike domain without a named product result",r=>{r.output[1].content[0].annotations[0]={type:"url_citation",url:"https://notmozaracing.com/",title:"Home"};}],
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
