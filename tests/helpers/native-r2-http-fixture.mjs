import {R2Store,objectMime} from "../../server/object-store.ts";
import {createHash,randomUUID} from "node:crypto";
import {readFile,writeFile,stat} from "node:fs/promises";
import {createReadStream} from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

/** Native SDK commands share the existing private disk-object fixture. */
export function nativeR2HttpFixture(root){
  assert.ok(process.env.VCO_TEST_PG_PROXY&&process.env.VCO_TEST_OBJECTS);
  const original=R2Store.prototype.preparedMultipart,uploads=new Map(),metadata=new Map(),calls=[];
  const api={calls,failAfter:null,restore(){R2Store.prototype.preparedMultipart=original;}};
  const missing=()=>({$metadata:{httpStatusCode:404}});
  const client={async send(command,options){
    options.abortSignal.throwIfAborted();
    const name=command.constructor.name,p=command.input;calls.push(name);
    const filename=path.join(root,p.Key);
    let result;
    if(name==="CreateMultipartUploadCommand"){
      const id=randomUUID();uploads.set(id,{metadata:p.Metadata,parts:new Map(),key:p.Key});
      result={UploadId:id};
    }else if(name==="HeadObjectCommand"||name==="GetObjectCommand"){
      let info;try{info=await stat(filename);}catch{throw missing();}
      if(name==="HeadObjectCommand")result={ContentLength:info.size,ContentType:objectMime(p.Key),ETag:"fixture",Metadata:metadata.get(p.Key)};
      else{assert.equal(p.IfMatch,"fixture");result={Body:createReadStream(filename)};}
    }else{
      const upload=uploads.get(p.UploadId);if(!upload)throw missing();
      assert.equal(upload.key,p.Key);
      if(name==="ListPartsCommand")result={IsTruncated:false,Parts:[...upload.parts].map(([number,value])=>
        ({PartNumber:number,Size:value.bytes.length,ETag:value.etag}))};
      else if(name==="UploadPartCommand"){
        assert.equal(createHash("md5").update(p.Body).digest("base64"),p.ContentMD5);
        const etag=`"${createHash("md5").update(p.Body).digest("hex")}"`;
        upload.parts.set(p.PartNumber,{bytes:Buffer.from(p.Body),etag});result={ETag:etag};
      }else if(name==="CompleteMultipartUploadCommand"){
        const bytes=Buffer.concat(p.MultipartUpload.Parts.map(part=>{
          const saved=upload.parts.get(part.PartNumber);assert.equal(saved.etag,part.ETag);return saved.bytes;
        }));
        await writeFile(filename,bytes,{flag:"wx"});metadata.set(p.Key,upload.metadata);uploads.delete(p.UploadId);result={};
      }else if(name==="AbortMultipartUploadCommand"){uploads.delete(p.UploadId);result={};}
      else throw Error("Unexpected native fixture command");
    }
    await api.failAfter?.(name,p);
    return result;
  }};
  R2Store.prototype.preparedMultipart=function(){
    this.multipartClient=client;
    return original.call(this);
  };
  return api;
}
