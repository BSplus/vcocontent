// Disk-backed synthetic provider/journal. NEVER an application persistence adapter.
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {mkdtemp,open,writeFile,readFile,rename,rm,chmod} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {Readable} from "node:stream";
import path from "node:path";
import {R2Store} from "../../server/object-store.ts";
import {mediaDatabaseFingerprint} from "../../server/media-storage-config.ts";
const hash=(data,algorithm="sha256")=>createHash(algorithm).update(data).digest("hex");
const notFound=()=>({$metadata:{httpStatusCode:404},message:"synthetic-private-provider-message"});
const locks=new Set();
export class FixtureJournal {
  constructor(root){this.root=root;}
  async exclusive(scope,key,id,work){
    const lock=scope+key;
    assert.ok(!locks.has(lock),"Fixture destination lease already held");
    locks.add(lock);
    try{
      const filename=path.join(this.root,id+".json");
      let saved=null;
      try{saved=JSON.parse(await readFile(filename,"utf8"));}catch(error){if(error.code!=="ENOENT")throw error;}
      return await work(saved,async value=>{
        await writeFile(filename+".next",JSON.stringify(value),{mode:0o600});
        await rename(filename+".next",filename);
      });
    }finally{locks.delete(lock);}
  }
}
export async function multipartFixture(size=9*1048576){
  const root=await mkdtemp("/tmp/vco-native-multipart-");await chmod(root,0o700);
  const database="postgres://synthetic@multipart.example.invalid/isolated";
  const env={NODE_ENV:"development",MEDIA_STORAGE_ENVIRONMENT:"development",R2_ACCOUNT_ID:"a".repeat(32),
    R2_BUCKET:"vco-multipart-test",R2_JURISDICTION:"eu",R2_STORAGE_CLASS:"Standard",
    R2_DEV_ACCESS_KEY_ID:"synthetic",R2_DEV_SECRET_ACCESS_KEY:"synthetic",
    DATABASE_URL:database,MEDIA_STORAGE_DATABASE_FINGERPRINT:mediaDatabaseFingerprint(database),
    MEDIA_R2_MULTIPART_ENABLED:"true",MEDIA_STORAGE_NEW_UPLOADS_ENABLED:"true",
    MEDIA_STORAGE_PROVIDER:"r2",MEDIA_STORAGE_ROUTING:"enabled"};
  const source=path.join(root,"source");
  const output=await open(source,"wx",0o600),digest=createHash("sha256"),block=Buffer.alloc(1048576,37);
  try{
    for(let offset=0;offset<size;offset+=block.length){
      const piece=block.subarray(0,Math.min(block.length,size-offset));
      await output.write(piece);digest.update(piece);
    }
  }finally{await output.close();}
  const plan={sessionId:randomUUID(),actorId:101,eventId:201,
    owner:{kind:"creator",creatorId:101,revision:"fixture-owner-v1"},
    key:`media-${randomUUID()}.mp4`,mime:"video/mp4",size,sha256:digest.digest("hex"),
    expiresAt:Date.now()+3590000};
  const state={uploads:new Map(),objects:new Map(),calls:[],writes:[],maxBody:0,bufferCount:0,
    buffers:new WeakSet(),maxRss:process.memoryUsage().rss};
  const client={async send(command,options){
    options.abortSignal.throwIfAborted();
    const name=command.constructor.name,input=command.input;
    state.calls.push(name);state.maxRss=Math.max(state.maxRss,process.memoryUsage().rss);
    assert.equal(input.Bucket,env.R2_BUCKET);assert.equal(input.Key,plan.key);
    assert.equal(input.ACL,undefined);assert.ok(options.abortSignal);
    await state.before?.(name,input);
    let result;
    if(name==="CreateMultipartUploadCommand"){
      const id=randomUUID();
      assert.equal(input.StorageClass,"STANDARD");
      state.uploads.set(id,{id,mime:input.ContentType,metadata:input.Metadata,parts:new Map()});
      result={UploadId:id};
    }else if(name==="HeadObjectCommand"||name==="GetObjectCommand"){
      const object=state.objects.get(input.Key);if(!object)throw notFound();
      if(name==="HeadObjectCommand")result={ContentLength:object.size,ContentType:object.mime,
        ETag:object.version,Metadata:object.metadata,ContentEncoding:object.encoding};
      else{
        assert.equal(input.IfMatch,object.version);
        result={Body:Readable.from((async function*(){
          for(const part of object.files)for await(const bytes of createReadStream(part))yield bytes;
        })())};
      }
    }else{
      const upload=state.uploads.get(input.UploadId);if(!upload)throw notFound();
      if(name==="ListPartsCommand"){
        assert.equal(input.MaxParts,33);
        result={IsTruncated:false,Parts:[...upload.parts.values()].sort((a,b)=>a.number-b.number)
          .map(p=>({PartNumber:p.number,Size:p.size,ETag:p.etag}))};
      }else if(name==="UploadPartCommand"){
        assert.ok(Buffer.isBuffer(input.Body));
        assert.equal(input.ContentLength,input.Body.length);
        assert.equal(input.ContentMD5,Buffer.from(hash(input.Body,"md5"),"hex").toString("base64"));
        state.maxBody=Math.max(state.maxBody,input.Body.length);
        if(!state.buffers.has(input.Body.buffer)){state.buffers.add(input.Body.buffer);state.bufferCount++;}
        state.writes.push(input.PartNumber);
        const filename=path.join(root,upload.id+"-"+input.PartNumber);
        await writeFile(filename,input.Body,{mode:0o600});
        const part={number:input.PartNumber,size:input.Body.length,etag:`"${hash(input.Body,"md5")}"`,filename};
        upload.parts.set(input.PartNumber,part);result={ETag:part.etag};
      }else if(name==="CompleteMultipartUploadCommand"){
        const parts=input.MultipartUpload.Parts;
        assert.equal(parts.length,upload.parts.size);
        parts.forEach((p,i)=>{assert.equal(p.PartNumber,i+1);assert.equal(p.ETag,upload.parts.get(i+1).etag);});
        assert.equal(state.objects.has(input.Key),false,"Reserved immutable key must not be overwritten");
        state.objects.set(input.Key,{files:parts.map(p=>upload.parts.get(p.PartNumber).filename),
          size:[...upload.parts.values()].reduce((n,p)=>n+p.size,0),mime:upload.mime,metadata:upload.metadata,
          version:`"${"b".repeat(32)}-${parts.length}"`});
        state.uploads.delete(input.UploadId);result={};
      }else if(name==="AbortMultipartUploadCommand"){
        for(const part of upload.parts.values())await rm(part.filename);
        state.uploads.delete(input.UploadId);result={};
      }else throw Error("Unexpected synthetic command "+name);
    }
    await state.after?.(name,input,result);
    return result;
  }};
  const driver=()=>new R2Store(env,client).preparedMultipart();
  const context=()=>({driver:driver(),journal:new FixtureJournal(root),authorize:async()=>{}});
  return {root,env,plan,source,state,driver,context,
    checkpoint:async()=>JSON.parse(await readFile(path.join(root,plan.sessionId+".json"),"utf8")),
    close:()=>rm(root,{recursive:true,force:true})};
}
