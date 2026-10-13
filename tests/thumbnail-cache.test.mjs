import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { ThumbnailCache, thumbnailDigest } from "../server/thumbnail-cache.ts";
import { legacyThumbnail } from "../server/legacy-thumbnail.ts";
import { inlineEventThumbnail } from "../server/event-thumbnails.ts";
import { storage } from "../server/storage.ts";
import { pool } from "../server/db.ts";

test.after(async()=>{ storage.sessionStore.close(); await pool.end(); });
test("cache joins concurrent work, expires, evicts by bytes and LRU entries, removes failures", async()=>{
  let now=0, calls=0;
  const cache=new ThumbnailCache({entries:2,bytes:10,entryBytes:8,ttlMs:20},()=>now);
  const produce=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return Buffer.alloc(6);};
  const first=await Promise.all(Array.from({length:8},()=>cache.get("a",produce)));
  assert.equal(calls,1); assert.ok(first.every(body=>body===first[0]));
  await cache.get("a",produce);assert.equal(calls,1);
  await cache.get("b",produce);assert.deepEqual(cache.stats,{entries:1,bytes:6,pending:0});
  await cache.get("a",produce);assert.equal(calls,3);
  now=21;await cache.get("a",produce);assert.equal(calls,4);
  for(let n=0;n<2;n++) await assert.rejects(cache.get("bad",async()=>{throw Error("invalid");}));
  assert.equal(cache.stats.pending,0);
  await cache.get("huge",async()=>Buffer.alloc(11));assert.equal(cache.stats.bytes,6);
  const entries=new ThumbnailCache({entries:2,bytes:20,entryBytes:8,ttlMs:20});
  await entries.get("a",async()=>Buffer.alloc(2));await entries.get("b",async()=>Buffer.alloc(2));
  await entries.get("a",async()=>assert.fail("hit"));await entries.get("c",async()=>Buffer.alloc(2));
  await entries.get("b",async()=>{calls++;return Buffer.alloc(2);});assert.equal(calls,5);
});
test("in-flight limit does not evict or duplicate existing computations",async()=>{
  const cache=new ThumbnailCache(), resolvers=[];
  const pending=Array.from({length:10},(_,i)=>cache.get(String(i),()=>new Promise(r=>resolvers.push(r))));
  await Promise.resolve();
  const shared=cache.get("0",()=>assert.fail("must coalesce"));
  await assert.rejects(cache.get("overflow",async()=>Buffer.alloc(1)),/busy/);
  resolvers.forEach(r=>r(Buffer.alloc(1)));
  await Promise.all([...pending,shared]);assert.equal(cache.stats.pending,0);
});
test("real legacy and inline conversion reuse outputs without changing their quality",async()=>{
  const input=await sharp({create:{width:1900,height:900,channels:3,background:"#6989b1"}}).jpeg().toBuffer();
  const value=`data:image/jpeg;base64,${input.toString("base64")}`;
  let calls=0;const original=sharp.prototype.toBuffer;
  sharp.prototype.toBuffer=async function(...args){calls++;return original.apply(this,args);};
  try {
    const bodies=await Promise.all(Array.from({length:6},()=>legacyThumbnail(value)));
    assert.equal(calls,1);await legacyThumbnail(value);assert.equal(calls,1);
    const expected=await sharp(input).rotate().resize({width:640,height:640,fit:"inside",withoutEnlargement:true}).webp({quality:72}).toBuffer();
    assert.deepEqual(bodies[0],expected);
    const before=calls;
    await Promise.all(Array.from({length:6},()=>inlineEventThumbnail(value)));
    assert.equal(calls,before+1);
    await inlineEventThumbnail(value);assert.equal(calls,before+1);
    const changed=await sharp({create:{width:50,height:50,channels:3,background:"red"}}).png().toBuffer();
    const other=await legacyThumbnail(`data:image/png;base64,${changed.toString("base64")}`);
    assert.notEqual(thumbnailDigest(other),thumbnailDigest(bodies[0]));
    for(let i=0;i<2;i++) await assert.rejects(legacyThumbnail("data:image/png;base64,YmFk"));
    await assert.rejects(legacyThumbnail("data:image/png;base64,"+"A".repeat(45*1024*1024)),/budget/);
  }finally{sharp.prototype.toBuffer=original;}
});
