import test from "node:test";
import assert from "node:assert/strict";
import {suggestRawPairs,assertRawPairSelection} from "../server/raw-pairing.ts";
import {assertMediaKey} from "../server/object-store.ts";
const ownership={galleryId:7,category:"CREATOR",ownerId:3};
const jpegKey="media-11111111-1111-4111-8111-111111111111.jpg";
const rawKey="media-22222222-2222-4222-8222-222222222222.dng";
const evidence={capturedAtMs:1700000000000,cameraMake:"Canon",cameraModel:"R5",cameraSerial:"body-a"};
const candidate={mediaId:11,ownership,sourceVersion:1,jpegKey,jpegSha256:"a".repeat(64),
  filename:"IMG_1234.JPG",evidence};
const raw={ownership,filename:"img_1234.CR3",evidence};
test("matching stem, capture time and camera only suggest; explicit selection is always required",()=>{
  const result=suggestRawPairs(raw,[candidate]);
  assert.equal(result.status,"suggested");assert.equal(result.requiresExplicitSelection,true);
  assert.equal(result.matches.length,1);assert.equal(result.matches[0].mediaId,11);
  assert.equal("filename" in result.matches[0],false);
  assert.equal("evidence" in result.matches[0],false);
});
test("filename alone, missing metadata and missing normalized timestamp never suggest",()=>{
  for(const input of [{...raw,evidence:undefined},{...raw,evidence:{...evidence,capturedAtMs:NaN}},
    {...raw,evidence:{...evidence,cameraModel:""}}]){
    assert.equal(suggestRawPairs(input,[candidate]).status,"manual_selection_required");
  }
});
test("camera, serial, capture time and filename conflicts veto suggestions",()=>{
  for(const change of [{cameraMake:"Nikon"},{cameraModel:"R6"},{cameraSerial:"body-b"},
    {capturedAtMs:evidence.capturedAtMs+2001}]){
    assert.equal(suggestRawPairs({...raw,evidence:{...evidence,...change}},[candidate]).matches.length,0);
  }
  assert.equal(suggestRawPairs({...raw,filename:"IMG_12345.dng"},[candidate]).matches.length,0);
});
test("normalization keeps sequence numbers and only tolerates bounded capture differences",()=>{
  const result=suggestRawPairs({...raw,filename:" IMG_1234.dNg ",evidence:{...evidence,
    capturedAtMs:evidence.capturedAtMs+2000,cameraMake:" CANON ",cameraSerial:undefined}},[candidate]);
  assert.equal(result.status,"suggested");
  assert.equal(suggestRawPairs({...raw,filename:"IMG_01234.dng"},[candidate]).matches.length,0);
});
test("owner/event/category boundaries and stale/non-JPEG candidate facts are excluded",()=>{
  for(const change of [{ownership:{...ownership,galleryId:8}},{ownership:{...ownership,ownerId:4}},
    {ownership:{...ownership,category:"OFFICIAL_VCO",ownerId:null}},
    {sourceVersion:0},{jpegKey:jpegKey.replace(".jpg",".png")},{jpegSha256:"not-a-hash"}]){
    assert.equal(suggestRawPairs(raw,[{...candidate,...change}]).matches.length,0);
  }
});
test("several plausible assets remain ambiguous; no filename or array-order tie-break",()=>{
  const second={...candidate,mediaId:12,jpegKey:jpegKey.replace("11111111-","33333333-")};
  const result=suggestRawPairs(raw,[candidate,second]);
  assert.equal(result.status,"ambiguous");assert.equal(result.matches.length,2);
  assert.equal(result.requiresExplicitSelection,true);
});
test("unsafe names and unsupported extensions do not become suggestions",()=>{
  for(const filename of ["../IMG_1234.dng","C:\\IMG_1234.dng","IMG_1234.dng.exe",
    "IMG_1234.png","IMG_1234\0.dng","a".repeat(300)+".dng"]){
    assert.equal(suggestRawPairs({...raw,filename},[candidate]).matches.length,0);
  }
});
test("candidate processing is bounded and duplicate revision evidence is rejected",()=>{
  assert.throws(()=>suggestRawPairs(raw,Array(201).fill(candidate)),/bound/);
  assert.throws(()=>suggestRawPairs(raw,[candidate,candidate]),/Duplicate/);
  assert.throws(()=>suggestRawPairs({...raw,ownership:{...ownership,ownerId:null}},[]),/scope/);
});
test("manual choice is authoritative only when bound to the exact photo, JPEG and RAW",()=>{
  const expected={mediaId:11,sourceVersion:1,jpegKey,jpegSha256:"a".repeat(64),rawKey,rawSha256:"b".repeat(64)};
  assertRawPairSelection({intent:"explicit",...expected},expected);
  assert.throws(()=>assertRawPairSelection(undefined,expected),/selection/);
  for(const change of [{intent:"automatic"},{mediaId:12},{sourceVersion:2},{jpegKey:rawKey},
    {jpegSha256:"c".repeat(64)},{rawKey:jpegKey},{rawSha256:"c".repeat(64)}]){
    assert.throws(()=>assertRawPairSelection({intent:"explicit",...expected,...change},expected),/stale/);
  }
});
test("pairing vocabulary does not open generic object delivery or upload to any RAW format",()=>{
  for(const extension of ["dng","cr2","cr3","nef","arw","raf","orf","rw2"]){
    assert.throws(()=>assertMediaKey(rawKey.replace(".dng",`.${extension}`)),error=>error.code==="configuration");
  }
});
