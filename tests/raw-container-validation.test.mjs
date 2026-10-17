import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm,symlink,open,rename} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {validateRawContainer} from "../server/raw-container-validation.ts";
import {runRawValidationTool} from "../server/raw-validation-tool.ts";
import {syntheticDng} from "./helpers/synthetic-dng.mjs";
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const fixture=async(work)=>{
  const root=await mkdtemp(path.join(tmpdir(),"vco-raw-validator-"));
  const bytes=syntheticDng(),filename=path.join(root,"opaque-source");
  await writeFile(filename,bytes,{mode:0o600});
  const input={filename,stagingDirectory:root,originalFilename:"fixture.dng",mime:"image/x-adobe-dng",
    size:bytes.length,sha256:hash(bytes),maxBytes:1024*1024};
  try{await work({root,bytes,filename,input});}
  finally{await rm(root,{recursive:true,force:true});}
};
const rejects=(operation,codes)=>assert.rejects(operation,error=>{
  assert.ok(codes.includes(error.code),`Unexpected sanitized code ${error.code}`);
  assert.equal(error.message,`RAW validation: ${error.code}`);return true;
});
function changeTag(bytes,tag,value){
  const copy=Buffer.from(bytes),count=copy.readUInt16LE(8);
  for(let i=0;i<count;i++){
    const offset=10+i*12;
    if(copy.readUInt16LE(offset)===tag){copy.writeUInt32LE(value,offset+8);return copy;}
  }
  throw Error("Missing synthetic tag");
}
test("real bounded ExifTool validates synthetic CFA DNG without changing source bytes",()=>fixture(async({bytes,filename,input})=>{
  const result=await validateRawContainer(input);
  assert.deepEqual(result,{format:"DNG",subset:"uncompressed-cfa16-strips",mime:"image/x-adobe-dng",
    size:bytes.length,sha256:hash(bytes),width:32,height:24});
  assert.deepEqual(await readFile(filename),bytes);
  assert.equal(JSON.stringify(result).includes("SourceFile"),false);
  assert.equal("cameraSerial" in result,false);
  assert.equal("gps" in result,false);
}));
test("octet-stream and case-insensitive DNG names still require validated DNG bytes",()=>fixture(async({input})=>{
  assert.equal((await validateRawContainer({...input,originalFilename:"CAMERA.DNG",mime:"application/octet-stream"})).format,"DNG");
}));
test("suffix/MIME/path tricks and all unverified vendor RAW formats stay unsupported",()=>fixture(async({input})=>{
  for(const name of ["fixture.cr2","fixture.cr3","fixture.nef","fixture.arw","fixture.raf","fixture.orf",
    "fixture.rw2","../fixture.dng","C:\\fixture.dng","fixture.dng.exe","fixture\0.dng"]){
    await rejects(validateRawContainer({...input,originalFilename:name}),["unsupported"]);
  }
  await rejects(validateRawContainer({...input,mime:"image/jpeg"}),["unsupported"]);
}));
test("a TIFF prefix is not enough; JPEG, generic TIFF and header-only DNG fail",()=>fixture(async({input,filename,bytes})=>{
  for(const changed of [Buffer.from([255,216,255,224,0,0,0,0]),bytes.subarray(0,8),
    changeTag(bytes,50706,0)]){
    await writeFile(filename,changed);
    await rejects(validateRawContainer({...input,size:changed.length,sha256:hash(changed)}),
      ["unsupported","invalid_container"]);
  }
}));
test("truncated sensor data and out-of-bounds strip offsets/counts are rejected",()=>fixture(async({input,filename,bytes})=>{
  for(const changed of [bytes.subarray(0,bytes.length-64),changeTag(bytes,273,bytes.length+50),
    changeTag(bytes,279,bytes.length*2)]){
    await writeFile(filename,changed);
    await rejects(validateRawContainer({...input,size:changed.length,sha256:hash(changed)}),["invalid_container"]);
  }
}));
test("other compression and oversized pixel dimensions are not silently accepted",()=>fixture(async({input,filename,bytes})=>{
  for(const changed of [changeTag(bytes,259,7),changeTag(bytes,256,100_000_000)]){
    await writeFile(filename,changed);
    await rejects(validateRawContainer({...input,size:changed.length,sha256:hash(changed)}),
      ["unsupported","invalid_container"]);
  }
}));
test("durable expected size/hash and evaluation ceilings cannot be bypassed",()=>fixture(async({input})=>{
  await rejects(validateRawContainer({...input,sha256:"a".repeat(64)}),["integrity"]);
  await rejects(validateRawContainer({...input,size:input.size+1}),["integrity"]);
  for(const change of [{maxBytes:250*1024*1024+1},{maxBytes:input.size-1},{size:0},{sha256:"fake"}]){
    await rejects(validateRawContainer({...input,...change}),["invalid_input"]);
  }
}));
test("only a regular non-symlink source in the owned staging directory can be read",()=>fixture(async({input,root,filename})=>{
  const alias=path.join(root,"alias");await symlink(filename,alias);
  await rejects(validateRawContainer({...input,filename:alias}),["invalid_input"]);
  await rejects(validateRawContainer({...input,stagingDirectory:path.dirname(root)}),["invalid_input"]);
  await rejects(validateRawContainer({...input,filename:root}),["invalid_input","integrity"]);
}));
test("pre-aborted validation does not start a parser and returns no input details",()=>fixture(async({input})=>{
  const controller=new AbortController();controller.abort(Error("private test detail"));
  await rejects(validateRawContainer({...input,signal:controller.signal}),["cancelled"]);
}));
test("two bounded RAW jobs can complete concurrently without source modification",()=>fixture(async({input,bytes,filename})=>{
  const results=await Promise.all([validateRawContainer(input),validateRawContainer(input)]);
  assert.equal(results.length,2);assert.deepEqual(await readFile(filename),bytes);
}));
test("mutation and path replacement during real parsing cannot return a validated original",()=>fixture(async({input,bytes,filename,root})=>{
  for(const mode of ["mutate","replace"]){
    await writeFile(filename,bytes);
    const changed=Buffer.from(bytes);changed[changed.length-1]^=1;
    const replacement=path.join(root,"replacement");await writeFile(replacement,changed);
    // ExifTool startup is deliberately real; only sensor bytes change so the
    // structural parser need not notice. Post-read checksum/inode checks must.
    const mutation=new Promise((resolve,reject)=>setTimeout(()=>{
      (mode==="mutate"?writeFile(filename,changed):rename(replacement,filename)).then(resolve,reject);
    },30));
    try{await rejects(validateRawContainer(input),["integrity"]);}
    finally{await mutation;}
  }
}));
test("subprocess deadline kills and reaps a genuinely stalled child",()=>fixture(async({filename})=>{
  const file=await open(filename,"r");
  try{
    await rejects(runRawValidationTool(process.execPath,["-e","setInterval(()=>{},1000)"],
      {fd:file.fd,signal:new AbortController().signal,timeoutMs:100}),["resource_limit"]);
    // Runner settles after close, not merely after the deadline signal.
  }finally{await file.close();}
}));
test("subprocess stdout/stderr overflow and raw parser errors are sanitized",()=>fixture(async({filename})=>{
  const file=await open(filename,"r");
  try{
    for(const [script,codes] of [
      ["process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000)",["resource_limit"]],
      ["process.stderr.write('private-camera-data'.repeat(1000));setInterval(()=>{},1000)",["resource_limit"]],
      ["process.stderr.write('private-location');process.exit(1)",["invalid_container"]],
    ]){
      await rejects(runRawValidationTool(process.execPath,["-e",script],
        {fd:file.fd,signal:new AbortController().signal}),codes);
    }
  }finally{await file.close();}
}));
test("active cancellation kills the child and retains no private diagnostics",()=>fixture(async({filename})=>{
  const file=await open(filename,"r"),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(Error("private test detail")),100);
  try{await rejects(runRawValidationTool(process.execPath,["-e","setInterval(()=>{},1000)"],
    {fd:file.fd,signal:controller.signal}),["cancelled"]);}
  finally{clearTimeout(timer);await file.close();}
}));
test("missing resource/parser tools fail explicitly without a permissive fallback",()=>fixture(async({filename})=>{
  const file=await open(filename,"r");
  try{await rejects(runRawValidationTool("/no-such-vco-raw-tool",[],
    {fd:file.fd,signal:new AbortController().signal}),["tool_unavailable"]);}
  finally{await file.close();}
}));
test("the Linux CPU cap actually stops an unresponsive parser process",()=>fixture(async({filename})=>{
  const file=await open(filename,"r");
  try{await rejects(runRawValidationTool("prlimit",["--cpu=1","--","perl","-e","while(1){}"],
    {fd:file.fd,signal:new AbortController().signal,timeoutMs:4000}),["resource_limit"]);}
  finally{await file.close();}
}));
