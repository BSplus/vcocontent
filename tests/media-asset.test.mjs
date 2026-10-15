import test from "node:test";
import assert from "node:assert/strict";
import {assetKind, assertAssetPurpose, assertAssetObjectFormat, assetTitle, legacyAssetVariants} from "../shared/media-asset.ts";

test("asset identity extends existing image/video without replacing IDs or captions", () => {
  assert.equal(assetKind("image"),"PHOTO");
  assert.equal(assetKind("video"),"VIDEO");
  assert.throws(()=>assetKind("raw"));
  for (const purpose of ["original","legacy_source","preview","thumbnail","raw"]) assertAssetPurpose("PHOTO",purpose);
  for (const purpose of ["original","legacy_source","preview","thumbnail","poster"]) assertAssetPurpose("VIDEO",purpose);
  assert.throws(()=>assertAssetPurpose("PHOTO","poster"));
  assert.throws(()=>assertAssetPurpose("VIDEO","raw"));
  assert.throws(()=>assertAssetPurpose("PHOTO","public_original"));
  assert.equal(assetTitle(null),null);
  assert.equal(assetTitle("  Optional title  "),"Optional title");
  assert.equal(assetTitle("   "),null);
  assert.throws(()=>assetTitle("x".repeat(201)));
  assert.throws(()=>assetTitle(23));
});

test("format metadata cannot mislabel JPEG as RAW, video as photo, or an arbitrary key as an object",()=>{
  const key="media-11111111-1111-4111-8111-111111111111";
  assertAssetObjectFormat("PHOTO","raw",`${key}.dng`,"image/x-adobe-dng");
  assertAssetObjectFormat("VIDEO","poster",`${key}.webp`,"image/webp");
  assert.throws(()=>assertAssetObjectFormat("PHOTO","raw",`${key}.jpg`,"image/jpeg"));
  assert.throws(()=>assertAssetObjectFormat("PHOTO","original",`${key}.dng`,"image/x-adobe-dng"));
  assert.throws(()=>assertAssetObjectFormat("VIDEO","preview",`${key}.jpg`,"image/jpeg"));
  assert.throws(()=>assertAssetObjectFormat("PHOTO","original",`${key}.jpg`,"image/png"));
  assert.throws(()=>assertAssetObjectFormat("PHOTO","original","../media.jpg","image/jpeg"));
});

test("legacy high files are labelled honestly and every existing URL remains unchanged", () => {
  const ordinary={type:"image",url:"/api/media/files/media-11111111-1111-4111-8111-111111111111.jpg",
    thumbnail:"data:image/webp;base64,legacy"};
  const mapped=legacyAssetVariants(ordinary);
  assert.equal(mapped[0].purpose,"legacy_source");
  assert.equal(mapped[0].provenance,"legacy_available_source");
  assert.equal(mapped[0].url,ordinary.url);
  assert.equal(mapped[1].url,ordinary.thumbnail);
  assert.equal(mapped[1].purpose,"thumbnail");
  const original={...ordinary,url:"/api/media/files/media-11111111-1111-8111-8111-111111111111.png"};
  assert.equal(legacyAssetVariants(original)[0].purpose,"original");
  const video=legacyAssetVariants({...ordinary,type:"video",url:"data:video/mp4;base64,legacy"});
  assert.equal(video[0].purpose,"legacy_source");
  assert.equal(video[1].purpose,"poster");
});
