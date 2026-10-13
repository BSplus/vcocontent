import { Client } from "@replit/object-storage";
import { Storage } from "@google-cloud/storage";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Readable, PassThrough } from "node:stream";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ByteRange } from "./video-delivery";
import { ObjectStoreError, mediaStorageEnvironment, PRODUCTION_MEDIA_BUCKET } from "./media-storage-config";
export { ObjectStoreError } from "./media-storage-config";

export type Provider = "replit" | "r2";
export type ObjectMetadata = { size: number; mime: string; version?: string };
export interface ObjectStore {
  put(key: string, bytes: Buffer | string, mime: string, options?: { createOnly: boolean }): Promise<void>;
  metadata(key: string): Promise<ObjectMetadata>;
  open(key: string, range?: ByteRange, version?: string): Readable;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Deliberately unavailable: browser bearer URLs cannot preserve app rights/statistics. */
  sign(): never;
}
export function assertMediaKey(key: string) {
  if (!/^(media|thumb)-[0-9a-f-]{36}\.(jpg|png|gif|webp|mp4|mov|webm)$/.test(key))
    throw new ObjectStoreError("configuration");
}
export function objectMime(key: string) {
  const ext = key.split(".").pop()!;
  return ({jpg:"image/jpeg",png:"image/png",gif:"image/gif",webp:"image/webp",
    mp4:"video/mp4",mov:"video/quicktime",webm:"video/webm"} as Record<string,string>)[ext];
}
export function r2Config(env = process.env) {
  const environment = mediaStorageEnvironment(env);
  const forbidden = environment === "development"
    ? ["R2_PROD_ACCESS_KEY_ID","R2_PROD_SECRET_ACCESS_KEY"] as const
    : ["R2_DEV_ACCESS_KEY_ID","R2_DEV_SECRET_ACCESS_KEY"] as const;
  const conflictingKeys = forbidden.filter(key => Object.hasOwn(env,key));
  if (conflictingKeys.length) throw new ObjectStoreError("configuration", {
    reason: "opposite_environment_credentials",
    environment,
    conflictingKeys,
  });
  const prefix = environment === "development" ? "R2_DEV" : "R2_PROD";
  if (!/^[0-9a-f]{32}$/.test(env.R2_ACCOUNT_ID || "") ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET || "") ||
      env.R2_JURISDICTION !== "eu" || env.R2_STORAGE_CLASS !== "Standard" ||
      !env[`${prefix}_ACCESS_KEY_ID`] || !env[`${prefix}_SECRET_ACCESS_KEY`])
    throw new ObjectStoreError("configuration");
  if (environment === "development"
    ? env.R2_BUCKET === PRODUCTION_MEDIA_BUCKET || !/-(dev|test)$/.test(env.R2_BUCKET!)
    : env.R2_BUCKET !== PRODUCTION_MEDIA_BUCKET)
    throw new ObjectStoreError("configuration");
  const endpoint = `https://${env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`;
  if (env.R2_ENDPOINT && env.R2_ENDPOINT !== endpoint) throw new ObjectStoreError("configuration");
  return { environment, endpoint, bucket: env.R2_BUCKET!, credentials: {
    accessKeyId: env[`${prefix}_ACCESS_KEY_ID`]!, secretAccessKey: env[`${prefix}_SECRET_ACCESS_KEY`]!,
  }};
}
/** Delayed open keeps existing synchronous stream consumers (analysis, safety, FFmpeg). */
export function deferredStream(open: () => Promise<Readable>): Readable {
  const output = new PassThrough();
  let input: Readable | undefined;
  output.once("close", () => input?.destroy());
  void open().then(value => {
    input = value;
    if (output.destroyed) { value.destroy(); return; }
    value.once("error", () => output.destroy(new ObjectStoreError("upstream")));
    value.pipe(output);
  }, error => output.destroy(error instanceof ObjectStoreError ? error : new ObjectStoreError("upstream")));
  return output;
}
abstract class BaseStore implements ObjectStore {
  abstract put(key: string, bytes: Buffer | string, mime: string): Promise<void>;
  abstract metadata(key: string): Promise<ObjectMetadata>;
  abstract open(key: string, range?: ByteRange, version?: string): Readable;
  abstract delete(key: string): Promise<void>;
  async exists(key: string) {
    try { await this.metadata(key); return true; }
    catch (e) { if (e instanceof ObjectStoreError && e.code === "missing") return false; throw e; }
  }
  sign(): never { throw new ObjectStoreError("configuration"); }
}
export class R2Store extends BaseStore {
  private client: S3Client;
  private bucket: string;
  private environment: "development" | "production";
  private endpoint: string;
  constructor(private env = process.env, client?: S3Client) {
    super();
    const config = r2Config(env);
    this.bucket = config.bucket;
    this.environment = config.environment;
    this.endpoint = config.endpoint;
    this.client = client || new S3Client({endpoint:config.endpoint,credentials:config.credentials,
      region:"auto",forcePathStyle:true,maxAttempts:2});
  }
  private guard(write = false) {
    const current = r2Config(this.env);
    if (current.environment !== this.environment || current.bucket !== this.bucket || current.endpoint !== this.endpoint ||
        (write && this.environment === "production" && this.env.R2_PROD_WRITE_ENABLED !== "true"))
      throw new ObjectStoreError("configuration");
  }
  private async send(command: any) {
    try { return await this.client.send(command, {abortSignal:AbortSignal.timeout(30_000)}) as any; }
    catch (error: any) {
      const status = error?.$metadata?.httpStatusCode;
      throw new ObjectStoreError(status === 404 ? "missing" : status === 401 || status === 403 ? "authorization" : "upstream");
    }
  }
  async put(key: string, bytes: Buffer | string, mime: string, options?: { createOnly: boolean }) {
    this.guard(true);
    assertMediaKey(key);
    const size = typeof bytes === "string" ? (await stat(bytes)).size : bytes.length;
    if (!size || size > 100 * 1048576) throw new ObjectStoreError("integrity");
    // Reopen file bodies per attempt; SDK retrying an already-consumed stream is unsafe.
    for (let attempt = 0; ; attempt++) {
      const body = typeof bytes === "string" ? createReadStream(bytes) : bytes;
      try {
        await this.send(new PutObjectCommand({Bucket:this.bucket,Key:key,Body:body,
          ContentLength:size,ContentType:mime,StorageClass:"STANDARD",
          IfNoneMatch:options?.createOnly ? "*" : undefined}));
        return;
      } catch (e) { if (attempt >= 1 || !(e instanceof ObjectStoreError) || e.code !== "upstream") throw e; }
      finally { if (body instanceof Readable) body.destroy(); }
    }
  }
  async metadata(key: string) {
    this.guard();
    assertMediaKey(key);
    const result = await this.send(new HeadObjectCommand({Bucket:this.bucket,Key:key}));
    if (!Number.isSafeInteger(result.ContentLength) || result.ContentLength <= 0 || !result.ETag ||
        result.ContentEncoding || result.ContentType !== objectMime(key)) throw new ObjectStoreError("integrity");
    return {size:result.ContentLength,mime:result.ContentType,version:result.ETag};
  }
  open(key: string, range?: ByteRange, version?: string) {
    this.guard();
    assertMediaKey(key);
    return deferredStream(async () => {
      const result = await this.send(new GetObjectCommand({Bucket:this.bucket,Key:key,
        IfMatch:version,Range:range ? `bytes=${range.start}-${range.end}` : undefined}));
      if (!(result.Body instanceof Readable)) throw new ObjectStoreError("integrity");
      const body = result.Body as Readable;
      const timer = setTimeout(() => body.destroy(new ObjectStoreError("upstream")), 120_000);
      body.once("close", () => clearTimeout(timer));
      return body;
    });
  }
  async delete(key: string) {
    this.guard(true);
    assertMediaKey(key);
    await this.send(new DeleteObjectCommand({Bucket:this.bucket,Key:key}));
  }
}
export class ReplitStore extends BaseStore {
  private client = new Client();
  private bucket: Promise<ReturnType<Storage["bucket"]>> | undefined;
  private getBucket() {
    return this.bucket ??= (async () => {
      const response = await fetch("http://127.0.0.1:1106/object-storage/default-bucket",
        {signal:AbortSignal.timeout(15_000)});
      if (!response.ok) throw new ObjectStoreError("upstream");
      const value = await response.json();
      if (!value.bucketId) throw new ObjectStoreError("configuration");
      return new Storage({projectId:"",timeout:15_000,retryOptions:{autoRetry:false},
        credentials:{type:"external_account",audience:"replit",subject_token_type:"access_token",
          token_url:"http://127.0.0.1:1106/token",
          credential_source:{url:"http://127.0.0.1:1106/credential",format:{type:"json",subject_token_field_name:"access_token"}},
          universe_domain:"googleapis.com"}}).bucket(value.bucketId);
    })().catch(() => {this.bucket = undefined; throw new ObjectStoreError("upstream");});
  }
  async put(key: string, bytes: Buffer | string, _mime: string, options?: { createOnly: boolean }) {
    if(options?.createOnly)throw new ObjectStoreError("configuration");
    const result = typeof bytes === "string"
      ? await this.client.uploadFromFilename(key, bytes, {compress:false})
      : await this.client.uploadFromBytes(key, bytes, {compress:false});
    if (!result.ok) throw new ObjectStoreError("upstream");
  }
  async metadata(key: string) {
    try {
      const [metadata] = await (await this.getBucket()).file(key).getMetadata();
      const size = Number(metadata.size);
      if (!Number.isSafeInteger(size) || size <= 0 || !metadata.generation || metadata.contentEncoding)
        throw new ObjectStoreError("integrity");
      return {size,mime:objectMime(key),version:String(metadata.generation)};
    } catch (e: any) {
      if (e instanceof ObjectStoreError) throw e;
      throw new ObjectStoreError(e?.code === 404 ? "missing" : "upstream");
    }
  }
  open(key: string, range?: ByteRange, version?: string) {
    if (!range && !version) return deferredStream(async () => this.client.downloadAsStream(key));
    return deferredStream(async () => (await this.getBucket()).file(key, {generation:version})
      .createReadStream({...range,decompress:false}));
  }
  async delete(key: string) {
    const result = await this.client.delete(key, {ignoreNotFound:true});
    if (!result.ok) throw new ObjectStoreError("upstream");
  }
}
const stores: Partial<Record<Provider,ObjectStore>> = {};
export function getObjectStore(provider: Provider): ObjectStore {
  return stores[provider] ??= provider === "r2" ? new R2Store() : new ReplitStore();
}
