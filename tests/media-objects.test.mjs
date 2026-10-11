import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { uploadMedia, createMediaKeys, readMediaStream } from "../server/media-storage.ts";
import { mediaPolicy, MediaLimitError } from "../server/media-policy.ts";
import { preparePhoto, fitOfficialDownload } from "../server/image-downloads.ts";
import { isCreatorOriginal } from "../shared/image-provenance.ts";
import { mockMediaStorage } from "./helpers/memory-media-storage.mjs";

const store = mockMediaStorage();
test.after(()=>store.restore());
async function withFile(bytes,mime,fn) {
  const dir=await mkdtemp(path.join(tmpdir(),"image-quality-"));
  const filename=path.join(dir,"source");
  await writeFile(filename,bytes);
  try {return await fn({path:filename,size:bytes.length,mimetype:mime});}
  finally {await rm(dir,{recursive:true,force:true});}
}
const hash = data => createHash("sha256").update(data).digest("hex");
async function read(key) {const chunks=[];for await(const chunk of readMediaStream(key))chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
const tiny = () => sharp({create:{width:96,height:64,channels:3,background:"#345678"}});

test("official highest fitting quality wins at the exact 5,000,000-byte limit before any resize", async () => {
  for (const target of [100, 98, 95, 90, 85, 80]) {
    const calls = [];
    const output = await fitOfficialDownload(async (scale, quality) => {
      calls.push([scale, quality]);
      return Buffer.alloc(quality === target ? 5_000_000 : 5_000_001);
    });
    assert.equal(output.length, 5_000_000);
    assert.deepEqual(calls, [100, 98, 95, 90, 85, 80].slice(0, calls.length).map(q => [1, q]));
    assert.equal(calls.at(-1)[1], target);
  }
  const calls = [];
  await fitOfficialDownload(async (scale, quality) => {
    calls.push([scale, quality]);
    return Buffer.alloc(scale === .70 && quality === 80 ? 1 : 5_000_001);
  });
  assert.deepEqual(calls, [100,98,95,90,85,80].map(q=>[1,q])
    .concat([90,85,80].map(q=>[.85,q]),[90,85,80].map(q=>[.70,q])));
  await assert.rejects(fitOfficialDownload(async()=>Buffer.alloc(5_000_001)), /quality 80.*70%/);
});

test("creator static JPEG, PNG, WebP and GIF stay hash-identical with exactly two private objects",async()=>{
  for (const [format,mime] of [["jpeg","image/jpeg"],["png","image/png"],["webp","image/webp"],["gif","image/gif"]]) {
    const bytes=await tiny()[format]().toBuffer();
    await withFile(bytes,mime,async file=>{
      const before=store.writes.length;
      let reserved;
      const saved=await uploadMedia(file,"image",createMediaKeys(mime,"creator-original"),
        async (bytes,keys)=>{reserved={bytes,keys};},"creator-original");
      const high=await read(saved.storageKey),low=await read(saved.thumbnailKey);
      assert.equal(hash(high),hash(bytes));
      assert.equal(saved.mimeType,mime);
      assert.equal(isCreatorOriginal(saved.url),true);
      assert.deepEqual(store.writes.slice(before),[saved.storageKey,saved.thumbnailKey]);
      assert.equal(saved.highBytes,bytes.length);
      assert.equal(saved.lowBytes,low.length);
      assert.equal(saved.storedBytes,bytes.length+low.length);
      assert.equal(reserved.bytes,saved.storedBytes);
      assert.equal(reserved.keys.storageKey,saved.storageKey);
      assert.ok(low.length<=100_000);
      assert.equal(saved.objectCount,2);
      assert.ok((await sharp(low).metadata()).width<=96,"No preview upscaling");
    });
  }
});

test("exact decimal creator limit, wrong MIME, full decode, animation and pixel limits",async()=>{
  const png=await tiny().png().toBuffer();
  const exact=Buffer.concat([png,Buffer.alloc(5_000_000-png.length)]);
  await withFile(exact,"image/png",async file=>{
    const saved=await uploadMedia(file,"image",undefined,undefined,"creator-original");
    assert.equal(saved.highBytes,5_000_000);
    assert.equal(hash(await read(saved.storageKey)),hash(exact));
    assert.ok(saved.storedBytes<=5_100_000);
  });
  const frames=Buffer.concat([Buffer.alloc(12,0),Buffer.alloc(12,255)]);
  const animated=await sharp(frames,{raw:{width:2,height:4,channels:3,pageHeight:2}}).gif().toBuffer();
  const jpeg=await tiny().jpeg().toBuffer();
  assert.equal((await sharp(animated,{animated:true}).metadata()).pages,2);
  for(const [bytes,mime] of [[Buffer.concat([exact,Buffer.from([0])]),"image/png"],
    [png,"image/jpeg"],[png.subarray(0,png.length-30),"image/png"],[jpeg.subarray(0,jpeg.length-20),"image/jpeg"],[animated,"image/gif"]]) {
    const before=store.writes.length;
    await withFile(bytes,mime,file=>assert.rejects(uploadMedia(file,"image",undefined,undefined,"creator-original")));
    assert.equal(store.writes.length,before);
  }
  const bomb=await sharp({create:{width:6500,height:6500,channels:3,background:"red"}}).png().toBuffer();
  await withFile(bomb,"image/png",file=>assert.rejects(uploadMedia(file,"image",undefined,undefined,"creator-original")));
  await withFile(Buffer.from("no image"),"image/png",file=>assert.rejects(
    uploadMedia({...file,size:mediaPolicy.imageBytes+1},"image"),MediaLimitError));
});

test("official high-resolution source over 5 MB retains dimensions and suitable small inputs are unchanged",async()=>{
  const source=await readFile("attached_assets/#89_3.png");
  assert.ok(source.length>5_000_000);
  await withFile(source,"image/png",async file=>{
    const saved=await uploadMedia(file,"image");
    const high=await read(saved.storageKey),low=await read(saved.thumbnailKey);
    const metadata=await sharp(high).metadata();
    assert.deepEqual([metadata.width,metadata.height],[2160,2700]);
    assert.ok(high.length<=5_000_000 && low.length<=100_000);
    assert.equal(saved.storedBytes,high.length+low.length);
    assert.equal(isCreatorOriginal(saved.url),false);
    assert.equal((await sharp(low).metadata()).height,640);
  });
  for(const [format,mime] of [["jpeg","image/jpeg"],["webp","image/webp"],["png","image/png"]]) {
    const source=await tiny()[format]().toBuffer();
    await withFile(source,mime,async file=>{
      const saved=await uploadMedia(file,"image");
      const high=await read(saved.storageKey);
      assert.ok(high.length<=source.length,"Small inputs must not be inflated");
      if(format!=="png")assert.equal(hash(high),hash(source));
      assert.equal((await sharp(high).metadata()).width,96);
    });
  }
});

function noise(width,height,amplitude=256) {
  let seed=17;const pixels=Buffer.alloc(width*height*3);
  for(let i=0;i<pixels.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[i]=128-amplitude/2+(seed>>>24)%amplitude;}
  return sharp(pixels,{raw:{width,height,channels:3}});
}
test("quality adjustment before bounded resolution adjustment; no extreme silent compression",async()=>{
  const source=await noise(3600,2400).png().toBuffer();
  await withFile(source,"image/png",async file=>{
    const result=await preparePhoto(file.path,file.mimetype,file.size,"official");
    const m=await sharp(result.download).metadata();
    assert.ok(result.download.length<=5_000_000);
    assert.ok(m.width<3600 && m.width>=3600*.70);
    assert.ok(result.preview.length<=100_000);
  });
  const modest=await noise(3200,2400,64).jpeg({quality:100,chromaSubsampling:"4:4:4"}).toBuffer();
  assert.ok(modest.length>5_000_000);
  await withFile(modest,"image/jpeg",async file=>{
    const result=await preparePhoto(file.path,file.mimetype,file.size,"official");
    const m=await sharp(result.download).metadata();
    assert.equal(m.width,3200);
    assert.ok(result.download.length<=5_000_000);
  });
  const huge=await noise(6000,5000).jpeg({quality:85}).toBuffer();
  await withFile(huge,"image/jpeg",file=>assert.rejects(
    preparePhoto(file.path,file.mimetype,file.size,"official"),/quality 80.*70%/));
});

test("failure after first object removes both keys and does not reserve twice",async()=>{
  store.failKey=key=>key.startsWith("thumb-");
  let calls=0;
  try {
    await withFile(await tiny().png().toBuffer(),"image/png",file=>assert.rejects(uploadMedia(file,"image",undefined,async()=>{calls++;},"creator-original")));
    assert.equal(calls,1);
    assert.equal(store.objects.has(store.writes.at(-2)),false);
    assert.equal(store.objects.has(store.writes.at(-1)),false);
  } finally {store.failKey=null;}
});
