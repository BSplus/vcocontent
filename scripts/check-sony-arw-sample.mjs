// Explicit local-only acceptance; never included in the default test glob.
// No provider/database/AI calls, hashes/private metadata/paths never printed.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {mkdtemp,stat,copyFile,open,rm} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {createHash} from "node:crypto";
import {validateRawContainer,validateSonyArwContainer} from "../server/raw-container-validation.ts";

async function hash(filename){
  const digest=createHash("sha256");
  for await(const bytes of createReadStream(filename))digest.update(bytes);
  return digest.digest("hex");
}
async function run(){
  assert.equal(process.argv.length,3,"Supply exactly one authorized local ARW sample");
  const source=path.resolve(process.argv[2]),size=(await stat(source)).size;
  assert(size>0&&size<=250*1024*1024,"Sample exceeds isolated evaluation ceiling");
  const before=await hash(source),root=await mkdtemp(path.join(os.tmpdir(),"sony-arw-acceptance-"));
  const filename=path.join(root,"sample.arw");
  try{
    await copyFile(source,filename);
    const input={filename,stagingDirectory:root,originalFilename:"sample.arw",
      mime:"image/x-sony-arw",size,sha256:before,maxBytes:250*1024*1024};
    const start=performance.now(),result=await validateSonyArwContainer(input);
    assert.equal(result.sha256,before);assert.equal(result.tiles,140);
    assert.equal(await hash(filename),before);
    await assert.rejects(validateRawContainer(input),error=>error.code==="unsupported");
    await assert.rejects(validateSonyArwContainer({...input,sha256:"0".repeat(64)}),
      error=>error.code==="integrity");
    // Discover the Sony raw directory rather than hard-coding camera file offsets.
    const file=await open(filename,"r");
    let entries;
    try{
      const h=Buffer.alloc(8);await file.read(h,0,8,0);
      const pos=h.readUInt32LE(4),n=Buffer.alloc(2);await file.read(n,0,2,pos);
      const bytes=Buffer.alloc(n.readUInt16LE()*12);await file.read(bytes,0,bytes.length,pos+2);
      let sub;
      for(let p=0;p<bytes.length;p+=12)if(bytes.readUInt16LE(p)===330){
        assert.equal(bytes.readUInt32LE(p+4),1);sub=bytes.readUInt32LE(p+8);
      }
      assert(sub);await file.read(n,0,2,sub);
      const values=Buffer.alloc(n.readUInt16LE()*12);await file.read(values,0,values.length,sub+2);
      entries=new Map();
      for(let p=0;p<values.length;p+=12)entries.set(values.readUInt16LE(p),{
        entry:sub+2+p,value:values.readUInt32LE(p+8)});
    }finally{await file.close();}
    const firstTileFile=await open(filename,"r");
    const firstTile=Buffer.alloc(4);
    try{await firstTileFile.read(firstTile,0,4,entries.get(324).value);}
    finally{await firstTileFile.close();}
    const cases=[
      async file=>file.truncate(entries.get(273).value+entries.get(279).value-1),
      async file=>{const b=Buffer.alloc(4,255);await file.write(b,0,4,entries.get(324).value);},
      async file=>{const b=Buffer.alloc(4);await file.write(b,0,4,entries.get(325).value);},
      async file=>{await file.write(Buffer.from([0,0]),0,2,firstTile.readUInt32LE());},
    ];
    for(const mutate of cases){
      await copyFile(source,filename);
      const file=await open(filename,"r+");try{await mutate(file);}finally{await file.close();}
      // Rehash altered fixtures: rejection must not rely only on the old hash.
      await assert.rejects(validateSonyArwContainer({...input,size:(await stat(filename)).size,
        sha256:await hash(filename)}),error=>["invalid_container","unsupported"].includes(error.code));
    }
    assert.equal(await hash(source),before);
    console.log(JSON.stringify({passed:true,profile:result.subset,tiles:result.tiles,
      bytes:size,reviewedTagOrderWarnings:result.reviewedTagOrderWarnings,
      negativeCases:6,originalUnchanged:true,temporaryCopiesCleanedOnExit:true,
      elapsedMs:Math.round(performance.now()-start)}));
  }finally{await rm(root,{recursive:true,force:true});}
}
run().catch(()=>{console.error("Local Sony ARW acceptance failed; no private diagnostics emitted.");process.exitCode=1;});
