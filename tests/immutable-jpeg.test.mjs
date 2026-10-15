import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import sharp from "sharp";
import { uploadMedia, createMediaKeys } from "../server/media-storage.ts";
import { preparePhoto } from "../server/image-downloads.ts";
import { standardPhotoDownload } from "../server/standard-photo-download.ts";
import { mediaPolicy } from "../server/media-policy.ts";
import { legacyAssetVariants } from "../shared/media-asset.ts";
import { mockMediaStorage } from "./helpers/memory-media-storage.mjs";

const store=mockMediaStorage();
test.after(()=>store.restore());
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const jpeg=()=>sharp({create:{width:40,height:24,channels:3,background:"#334455"}}).jpeg().toBuffer();
async function file(bytes,fn) {
  const directory=await mkdtemp(path.join(tmpdir(),"vco-original-fixture-"));
  const filename=path.join(directory,"source");
  await writeFile(filename,bytes);
  try{return await fn({path:filename,size:bytes.length,mimetype:"image/jpeg"});}
  finally{await rm(directory,{recursive:true,force:true});}
}

test("official and Creator JPEGs preserve EXIF/orientation and hash; thumbnails contain no EXIF",async()=>{
  const source=await sharp({create:{width:80,height:40,channels:3,background:"red"}})
    .jpeg().withMetadata({orientation:6,exif:{IFD0:{Artist:"Synthetic metadata fixture"}}}).toBuffer();
  assert.ok((await sharp(source).metadata()).exif);
  for(const strategy of ["official","creator-original"]){
    await file(source,async input=>{
      let reservation;
      const saved=await uploadMedia(input,"image",createMediaKeys("image/jpeg",strategy),
        async(bytes,keys)=>{reservation={bytes,keys};},strategy);
      const original=store.objects.get(saved.storageKey);
      const thumbnail=store.objects.get(saved.thumbnailKey);
      assert.equal(hash(original),hash(source));
      assert.deepEqual(original,source);
      assert.equal(saved.highBytes,source.length);
      assert.equal(saved.storedBytes,source.length+thumbnail.length);
      assert.equal(reservation.bytes,saved.storedBytes);
      assert.equal(saved.objectCount,2);
      const view=legacyAssetVariants({type:"image",url:saved.url,thumbnail:saved.thumbnail});
      assert.equal(view[0].purpose,"original");
      assert.equal(view[0].provenance,strategy==="official"?"uploaded_original":"creator_original");
      const metadata=await sharp(thumbnail).metadata();
      assert.equal(metadata.exif,undefined);
      assert.deepEqual([metadata.width,metadata.height],[40,80]);
      assert.ok(thumbnail.length<=100_000);
    });
  }
});

test("exact existing JPEG byte limits preserve bytes; over-limit rejects before persistence",async()=>{
  const source=await jpeg();
  for(const [strategy,limit] of [["official",mediaPolicy.imageBytes],["creator-original",5_000_000]]){
    const exact=Buffer.concat([source,Buffer.alloc(limit-source.length)]);
    await file(exact,async input=>{
      const saved=await uploadMedia(input,"image",undefined,undefined,strategy);
      assert.equal(saved.highBytes,limit);
      assert.equal(hash(store.objects.get(saved.storageKey)),hash(exact));
    });
    const writes=store.writes.length;
    await file(Buffer.concat([exact,Buffer.from([0])]),input=>
      assert.rejects(uploadMedia(input,"image",undefined,undefined,strategy),/between|5 MB/));
    assert.equal(store.writes.length,writes);
  }
});

test("metadata-free JPEG is valid; malformed/type-spoofed/truncated and oversized pixels fail before storage",async()=>{
  const source=await jpeg();
  assert.equal((await sharp(source).metadata()).exif,undefined);
  await file(source,async input=>assert.deepEqual((await preparePhoto(input.path,input.mimetype,input.size,"official")).download,source));
  const png=await sharp({create:{width:16,height:16,channels:3,background:"blue"}}).png().toBuffer();
  for(const invalid of [Buffer.from("not a photo"),png,source.subarray(0,Math.floor(source.length*.6))]){
    const writes=store.writes.length;
    await file(invalid,input=>assert.rejects(uploadMedia(input,"image")));
    assert.equal(store.writes.length,writes);
  }
  const bomb=await sharp({create:{width:6500,height:6500,channels:3,background:"blue"}}).jpeg().toBuffer();
  await file(bomb,input=>assert.rejects(uploadMedia(input,"image"),/valid|pixel|megapixel/));
  const boundary=await sharp({create:{width:8000,height:5000,channels:3,background:"blue"}}).jpeg().toBuffer();
  await file(boundary,async input=>{
    const saved=await uploadMedia(input,"image");
    assert.equal(hash(store.objects.get(saved.storageKey)),hash(boundary));
  });
});

test("cancelled standard exports open no queued source, close active readers and remove temporary files",async()=>{
  const abort=new AbortController();
  abort.abort();
  let opened=false;
  await assert.rejects(standardPhotoDownload(()=>{opened=true;return Readable.from("unused");},abort.signal));
  assert.equal(opened,false);
  const before=(await readdir(tmpdir())).filter(name=>name.startsWith("vco-standard-download-")).sort();
  const running=new AbortController();
  let reader;
  const timer=setTimeout(()=>running.abort(),50);
  try{
    await assert.rejects(standardPhotoDownload(()=>{
      reader=new Readable({read(){}});return reader;
    },running.signal));
    assert.ok(reader.destroyed);
  }finally{clearTimeout(timer);}
  assert.deepEqual((await readdir(tmpdir())).filter(name=>name.startsWith("vco-standard-download-")).sort(),before);
});
