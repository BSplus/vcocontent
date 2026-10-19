import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,open,rm,readFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {inspectSonyArwStructure,inspectSonyArwToolOutput} from "../server/sony-arw-structure.ts";
import {syntheticSonyArw} from "./helpers/synthetic-sony-arw.mjs";

async function inspect(fixture,signal=new AbortController().signal){
  const root=await mkdtemp(path.join(os.tmpdir(),"sony-structure-"));
  const filename=path.join(root,"fixture.arw");await writeFile(filename,fixture.bytes);
  const file=await open(filename,"r");
  try{
    const result=await inspectSonyArwStructure(file,fixture.bytes.length,signal);
    assert.deepEqual(await readFile(filename),fixture.bytes);return result;
  }finally{await file.close();await rm(root,{recursive:true,force:true});}
}
const rejects=async(fixture,codes=["invalid_container"])=>{
  await assert.rejects(inspect(fixture),error=>codes.includes(error.code)&&
    error.message===`RAW validation: ${error.code}`);
};
test("bounded Sony profile inspects all 140 lossless tile frames without modifying source",async()=>{
  const result=await inspect(syntheticSonyArw());
  assert.deepEqual(result,{width:7168,height:5120,tiles:140,profile:"sony-ilce7m4-lossless-cfa14"});
});
test("valid tile table order need not be physical file order",async()=>{
  const f=syntheticSonyArw();
  const a=f.bytes.readUInt32LE(f.offsets),b=f.bytes.readUInt32LE(f.offsets+4);
  f.bytes.writeUInt32LE(b,f.offsets);f.bytes.writeUInt32LE(a,f.offsets+4);
  await inspect(f);
});
test("truncation, invalid IFD offsets and directory cycles fail closed",async()=>{
  let f=syntheticSonyArw();f.bytes=f.bytes.subarray(0,-1);await rejects(f);
  for(const offset of [1,0xffffffff,8]){
    f=syntheticSonyArw();f.bytes.writeUInt32LE(offset,18);await rejects(f);
  }
});
test("hostile entry counts, value types, value offsets and duplicate tags fail",async()=>{
  let f=syntheticSonyArw();f.bytes.writeUInt16LE(65535,f.sub);await rejects(f);
  f=syntheticSonyArw();f.bytes.writeUInt16LE(99,f.fields[324]+2);await rejects(f);
  f=syntheticSonyArw();f.bytes.writeUInt32LE(0xffffffff,f.fields[324]+4);await rejects(f);
  f=syntheticSonyArw();f.bytes.writeUInt32LE(0xffffffff,f.fields[324]+8);await rejects(f);
  f=syntheticSonyArw();f.bytes.writeUInt16LE(256,f.fields[257]);await rejects(f);
});
test("compressed tile extents cannot overlap each other, metadata, or the enclosing strip",async()=>{
  for(const [offset,count] of [[1,64],[0xffffffff,64],[0,0],[0,0xffffffff]]){
    const f=syntheticSonyArw();
    f.bytes.writeUInt32LE(offset||f.data,f.offsets);f.bytes.writeUInt32LE(count,f.counts);
    await rejects(f);
  }
  let f=syntheticSonyArw();f.bytes.writeUInt32LE(f.data,f.offsets+4);await rejects(f);
  f=syntheticSonyArw();f.bytes.writeUInt32LE(f.data+64,f.fields[273]+8);await rejects(f);
  f=syntheticSonyArw();f.bytes.writeUInt32LE(f.data,f.fields[324]+8);await rejects(f);
});
test("other Sony dimensions, compression, depth and tile counts are not silently supported",async()=>{
  for(const [tag,value] of [[256,7008],[257,4672],[259,1],[258,12],[277,3],[322,256],[28672,3]]){
    const f=syntheticSonyArw();f.bytes.writeUInt32LE(value,f.fields[tag]+8);
    await rejects(f,["unsupported"]);
  }
  const f=syntheticSonyArw();f.bytes.writeUInt32LE(139,f.fields[324]+4);await rejects(f);
});
test("every tile needs the reviewed SOI/SOF3/precision/component framing and bounded EOI padding",async()=>{
  for(const [relative,value] of [[0,0],[3,0xc0],[6,8],[8,1],[11,3],[13,0x21],[48,0]]){
    const f=syntheticSonyArw();f.bytes[f.data+139*64+relative]=value;await rejects(f);
  }
  const f=syntheticSonyArw();f.bytes[f.data+47]=0xd9;f.bytes[f.data+46]=0xff;
  f.bytes.fill(0xff,f.data+48,f.data+64);await rejects(f);
});
test("pre-aborted structural inspection does not read a private input",async()=>{
  const abort=new AbortController();abort.abort();
  await assert.rejects(inspect(syntheticSonyArw(),abort.signal),error=>error.name==="AbortError");
});
const clean=[
  "[ExifTool] Validate : 0 0 0","[File] FileType : ARW","[File] MIMEType : image/x-sony-arw",
  "[IFD0] Make : SONY","[IFD0] Model : ILCE-7M4",
].join("\n");
const warnings=[
  "Entries in SubIFD are out of order [x6]",
  "Tag ID 0x011a XResolution out of sequence in SubIFD",
  "Tag ID 0x7000 SonyRawFileType out of sequence in SubIFD",
  "Tag ID 0x0111 StripOffsets out of sequence in SubIFD",
  "Tag ID 0x74c7 SonyCropTopLeft out of sequence in SubIFD",
  "Tag ID 0x0102 BitsPerSample out of sequence in SubIFD",
  "Tag ID 0x0142 TileWidth out of sequence in SubIFD",
];
const known=clean.replace("0 0 0","0 7 0")+"\n"+warnings.map(w=>`[ExifTool] Warning : ${w}`).join("\n");
test("clean output or exact reviewed seven-warning layout pass without exporting metadata",()=>{
  assert.deepEqual(inspectSonyArwToolOutput(clean),{reviewedTagOrderWarnings:0});
  assert.deepEqual(inspectSonyArwToolOutput(known),{reviewedTagOrderWarnings:7});
});
test("unknown, missing, duplicated, error and count-mismatched warnings cannot pass",()=>{
  for(const text of [known.replace(warnings[0],"Truncated data"),known.replace(warnings[0],warnings[1]),
    known.replace("0 7 0","0 6 0"),known.replace(`[ExifTool] Warning : ${warnings[0]}`,""),
    clean+"\n[ExifTool] Error : private detail",clean+"\n[ExifTool] Warning : private detail",
    clean+"\nnot a valid tool line",clean+"\n[IFD0] Model : ILCE-7M4"]){
    assert.throws(()=>inspectSonyArwToolOutput(text),error=>
      error.code==="invalid_container"&&error.message==="RAW validation: invalid_container");
  }
});
test("other camera models, generic TIFF and MIME mismatches remain unsupported",()=>{
  for(const text of [clean.replace("ILCE-7M4","ILCE-7RM4"),clean.replace("FileType : ARW","FileType : TIFF"),
    clean.replace("image/x-sony-arw","image/tiff")]){
    assert.throws(()=>inspectSonyArwToolOutput(text),error=>error.code==="unsupported");
  }
});
