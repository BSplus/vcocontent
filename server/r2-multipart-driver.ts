import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand, ListPartsCommand,
  CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { Readable, addAbortSignal } from "node:stream";
import { ObjectStoreError } from "./media-storage-config";

export type NativePart = { number: number; size: number; etag: string };
export interface R2MultipartDriver {
  readonly scope: string;
  validate(key: string, mime: string): void;
  writable(): void;
  create(key: string, mime: string, token: string, sha256: string, signal: AbortSignal): Promise<string>;
  parts(key: string, uploadId: string, signal: AbortSignal): Promise<NativePart[]>;
  part(key: string, uploadId: string, number: number, body: Buffer, md5: string, signal: AbortSignal): Promise<string>;
  complete(key: string, uploadId: string, parts: NativePart[], signal: AbortSignal): Promise<void>;
  abort(key: string, uploadId: string, signal: AbortSignal): Promise<void>;
  head(key: string, signal: AbortSignal): Promise<{
    size: number; mime: string; version: string; token?: string; sha256?: string;
  }>;
  open(key: string, version: string, signal: AbortSignal): Promise<Readable>;
}

/** Private SDK boundary. No URL signing, arbitrary buckets or browser capabilities. */
export function createR2MultipartDriver(options: {
  client: S3Client; bucket: string; scope: string;
  guard(write: boolean): void;
  validate(key: string, mime?: string): void;
}): R2MultipartDriver {
  const {client,bucket,scope,guard,validate}=options;
  const send=async(command: any, signal: AbortSignal)=>{
    signal.throwIfAborted();
    const bounded=AbortSignal.any([signal,AbortSignal.timeout(30_000)]);
    try { return await client.send(command,{abortSignal:bounded}) as any; }
    catch(error: any) {
      signal.throwIfAborted();
      const status=error?.$metadata?.httpStatusCode;
      throw new ObjectStoreError(status===404?"missing":status===401||status===403?"authorization":"upstream");
    }
  };
  const input=(key: string,write=false)=>{guard(write);validate(key);return {Bucket:bucket,Key:key};};
  return {
    scope,validate:(key,mime)=>{guard(false);validate(key,mime);},
    writable:()=>guard(true),
    async create(key,mime,token,sha256,signal){
      validate(key,mime);
      const result=await send(new CreateMultipartUploadCommand({...input(key,true),
        ContentType:mime,StorageClass:"STANDARD",Metadata:{"vco-upload":token,"vco-sha256":sha256}}),signal);
      if(typeof result.UploadId!=="string"||!result.UploadId||result.UploadId.length>1024)
        throw new ObjectStoreError("integrity");
      return result.UploadId;
    },
    async parts(key,uploadId,signal){
      const result=await send(new ListPartsCommand({...input(key),UploadId:uploadId,MaxParts:33}),signal);
      const parts=result.Parts??[];
      if(result.IsTruncated!==false || !Array.isArray(parts))throw new ObjectStoreError("integrity");
      return parts.map((part: any)=>({number:part.PartNumber,size:part.Size,etag:part.ETag}));
    },
    async part(key,uploadId,number,body,md5,signal){
      const result=await send(new UploadPartCommand({...input(key,true),UploadId:uploadId,
        PartNumber:number,Body:body,ContentLength:body.length,ContentMD5:md5}),signal);
      if(typeof result.ETag!=="string")throw new ObjectStoreError("integrity");
      return result.ETag;
    },
    async complete(key,uploadId,parts,signal){
      await send(new CompleteMultipartUploadCommand({...input(key,true),UploadId:uploadId,
        MultipartUpload:{Parts:parts.map(part=>({PartNumber:part.number,ETag:part.etag}))}}),signal);
    },
    async abort(key,uploadId,signal){
      // Cleanup is intentionally allowed with the normal new-upload gate closed.
      await send(new AbortMultipartUploadCommand({...input(key),UploadId:uploadId}),signal);
    },
    async head(key,signal){
      const result=await send(new HeadObjectCommand(input(key)),signal);
      if(!Number.isSafeInteger(result.ContentLength)||result.ContentLength<=0||
        typeof result.ETag!=="string"||!result.ETag||result.ContentEncoding)
        throw new ObjectStoreError("integrity");
      return {size:result.ContentLength,mime:result.ContentType,version:result.ETag,
        token:result.Metadata?.["vco-upload"],sha256:result.Metadata?.["vco-sha256"]};
    },
    async open(key,version,signal){
      const bounded=AbortSignal.any([signal,AbortSignal.timeout(120_000)]);
      const result=await send(new GetObjectCommand({...input(key),IfMatch:version}),bounded);
      if(!(result.Body instanceof Readable))throw new ObjectStoreError("integrity");
      return addAbortSignal(bounded,result.Body);
    },
  };
}
