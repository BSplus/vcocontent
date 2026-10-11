import test from "node:test";
import assert from "node:assert/strict";
import { videoFixture } from "./helpers/video-fixture.mjs";
import { byteRange, legacyVideoSource } from "../server/video-delivery.ts";
import { delay } from "./helpers/ui-browser.mjs";

test("single byte ranges are bounded and legacy decoding never allocates the complete video", async()=>{
  assert.deepEqual(byteRange("bytes=2-999",10),{start:2,end:9});
  for (const header of ["bytes=10-","bytes=3-2","bytes=-0","bytes=-","bytes=0-1,3-4","items=0-1","bytes=9007199254740993-"])
    assert.equal(byteRange(header,10),null,header);
  const bytes=Buffer.alloc(200_000,123);
  const source=legacyVideoSource(bytes.toString("base64"));
  let result=[];
  for await(const chunk of source.open({start:2,end:199998})) {assert.ok(chunk.length<=49152);result.push(chunk);}
  assert.deepEqual(Buffer.concat(result),bytes.subarray(2,199999));
});

test("actual object/legacy routes: full, HEAD, single ranges, boundaries and aborts", {timeout:60000},async()=>{
  const fixture=await videoFixture();
  try {
    assert.equal(fixture.codec.streams[0].codec_name,"h264");
    for(const item of fixture.media.slice(0,2)) {
      const n=fixture.clip.length;
      for (const [range,start,end,status] of [[undefined,0,n-1,200],["bytes=0-99",0,99,206],
        ["bytes=101-",101,n-1,206],["bytes=-101",n-101,n-1,206],["bytes=20-9999999",20,n-1,206],
        [`bytes=-${n+1}`,0,n-1,206]]) {
        const res=await fixture.api(item.url,"user",{headers:range?{Range:range}:{}});
        assert.equal(res.status,status);
        assert.equal(res.headers.get("accept-ranges"),"bytes");
        assert.equal(res.headers.get("content-length"),String(end-start+1));
        assert.equal(res.headers.get("content-type"),"video/mp4");
        assert.equal(res.headers.get("cache-control"),"private, no-store");
        assert.equal(res.headers.get("content-range"),range?`bytes ${start}-${end}/${n}`:null);
        assert.deepEqual(Buffer.from(await res.arrayBuffer()),fixture.clip.subarray(start,end+1));
      }
      for(const range of ["bytes=99999999-","bytes=5-1","bytes=-0","bytes=0-1,4-5","not-a-range"]) {
        const res=await fixture.api(item.url,"user",{headers:{Range:range}});
        assert.equal(res.status,416);
        assert.equal(res.headers.get("content-range"),`bytes */${n}`);
        assert.equal((await res.arrayBuffer()).byteLength,0);
      }
      const head=await fixture.api(item.url,"user",{method:"HEAD",headers:{Range:"bytes=0-99"}});
      assert.equal(head.status,206);assert.equal(head.headers.get("content-length"),"100");
      assert.equal((await head.arrayBuffer()).byteLength,0);
      const fallback=await fixture.api(item.url,"user",{headers:{Range:"bytes=0-99","If-Range":'"unknown"'}});
      assert.equal(fallback.status,200);await fallback.arrayBuffer();
      for(const role of [null,"suspended"]) {
        const before=fixture.metadataReads;
        assert.equal((await fixture.api(item.url,role,{headers:{Range:"bytes=0-99"}})).status,role?403:401);
        assert.equal(fixture.metadataReads,before,"authorize before metadata/stream");
      }
      item.isPremium=true;
      assert.equal((await fixture.api(item.url)).status,403);item.isPremium=false;
      fixture.event.isPremium=true;
      assert.equal((await fixture.api(item.url)).status,403);fixture.event.isPremium=false;
      fixture.event.adminHidden=true;
      assert.equal((await fixture.api(item.url)).status,404);
      assert.equal((await fixture.api(item.url,"admin",{headers:{Range:"bytes=0-2"}})).status,206);
      fixture.event.adminHidden=false;
      fixture.event.creatorId=fixture.roles.owner.id;fixture.event.visibility="draft";
      assert.equal((await fixture.api(item.url)).status,404);
      assert.equal((await fixture.api(item.url,"owner",{headers:{Range:"bytes=0-2"}})).status,206);
      fixture.event.visibility="published";fixture.event.safetyStatus="legacy";item.safetyStatus="rejected";
      assert.equal((await fixture.api(item.url)).status,404,"unsafe creator original stays hidden");
      assert.equal((await fixture.api(item.url,"owner",{headers:{Range:"bytes=0-2"}})).status,206);
      item.safetyStatus="legacy";fixture.event.safetyStatus="rejected";
      assert.equal((await fixture.api(item.url)).status,404,"unsafe creator gallery stays hidden");
      fixture.event.safetyStatus="legacy";
      fixture.event.creatorId=null;
    }
    fixture.slow=true;
    const controller=new AbortController();
    const res=await fixture.api(fixture.media[0].url,"user",{signal:controller.signal});
    await res.body.getReader().read();const stream=fixture.streams.at(-1);controller.abort();
    for(let i=0;i<30&&!stream.destroyed;i++)await delay(20);
    assert.equal(stream.destroyed,true,"disconnect destroys upstream");
    fixture.slow=false;fixture.fail=true;
    await assert.rejects(async()=>{
      const res=await fixture.api(fixture.media[0].url);await res.arrayBuffer();
    },/fetch failed|terminated|socket/);
    fixture.fail=false;
    fixture.failAfter=true;
    await assert.rejects(async()=>{
      const res=await fixture.api(fixture.media[0].url);await res.arrayBuffer();
    },/fetch failed|terminated|socket/);
    fixture.failAfter=false;
    assert.ok(fixture.objectRanges.some(call=>call.range.start===0&&call.range.end===99));
    assert.ok(fixture.objectRanges.every(call=>call.options.generation==="1"&&call.range.decompress===false),
      "native reads are ranged and pinned, not full downloads sliced in RAM");
  } finally {await fixture.close();}
});
