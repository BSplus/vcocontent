import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { R2Store, r2Config, assertMediaKey, ObjectStoreError, objectMime } from "../server/object-store.ts";
import { routingEnabled } from "../server/media-object-routing.ts";
import { mediaDatabaseFingerprint, mediaStorageEnvironment, PRODUCTION_MEDIA_BUCKET } from "../server/media-storage-config.ts";
import { servePreview } from "../workers/media-preview/worker.ts";
import { edgeAuthMessage } from "../shared/media-edge-auth.ts";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const databaseUrl="postgres://synthetic:synthetic@dev-db.example.invalid/vco_dev";
const config = {NODE_ENV:"development",MEDIA_STORAGE_ENVIRONMENT:"development",
  R2_ACCOUNT_ID:"a".repeat(32),R2_BUCKET:"vco-fixture-test",R2_JURISDICTION:"eu",
  R2_STORAGE_CLASS:"Standard",R2_DEV_ACCESS_KEY_ID:"synthetic",R2_DEV_SECRET_ACCESS_KEY:"synthetic",
  DATABASE_URL:databaseUrl,MEDIA_STORAGE_DATABASE_FINGERPRINT:mediaDatabaseFingerprint(databaseUrl)};
const digest = b=>createHash("sha256").update(b).digest("hex");
const key = () => `media-${randomUUID()}.png`;
const thumb = () => `thumb-${randomUUID()}.webp`;
const bytesOf = async stream=>{const chunks=[];for await(const c of stream)chunks.push(Buffer.from(c));return Buffer.concat(chunks);};

test("configuration is strict EU Standard; never generic endpoint/public URL; production gated",()=>{
  assert.equal(r2Config(config).endpoint,`https://${"a".repeat(32)}.eu.r2.cloudflarestorage.com`);
  for (const change of [{R2_JURISDICTION:"weur"},{R2_STORAGE_CLASS:"InfrequentAccess"},
    {R2_ENDPOINT:"https://example.invalid"},{R2_ENDPOINT:`https://${"a".repeat(32)}.r2.cloudflarestorage.com`},
    {R2_DEV_SECRET_ACCESS_KEY:""},{R2_BUCKET:"bucket/path"},{R2_ACCOUNT_ID:"not-account"},
    {R2_BUCKET:PRODUCTION_MEDIA_BUCKET},{MEDIA_STORAGE_ENVIRONMENT:"production"},
    {MEDIA_STORAGE_ENVIRONMENT:""},{REPLIT_DEPLOYMENT:"1"},{R2_BUCKET:"not-isolated"}])
    assert.throws(()=>r2Config({...config,...change}),ObjectStoreError);
  assert.equal(routingEnabled({}),false);
  assert.throws(()=>routingEnabled({MEDIA_STORAGE_PROVIDER:"other"}));
  assert.throws(()=>routingEnabled({MEDIA_STORAGE_PROVIDER:"r2"}));
  assert.throws(()=>routingEnabled({NODE_ENV:"production",MEDIA_STORAGE_ROUTING:"enabled"}));
  assert.equal(routingEnabled({...config,MEDIA_STORAGE_ROUTING:"enabled"}),true);
  assert.throws(()=>routingEnabled({...config,MEDIA_STORAGE_ROUTING:"enabled",DATABASE_URL:"postgres://synthetic@prod-db.example.invalid/vco_prod"}));
  assert.throws(()=>routingEnabled({...config,MEDIA_STORAGE_ROUTING:"enabled",MEDIA_STORAGE_DATABASE_FINGERPRINT:""}));
  for(const k of ["../original","thumb-x.webp","https://bucket/media-x.png","reference-"+randomUUID()+".pdf","profile-x.webp"])
    assert.throws(()=>assertMediaKey(k));
});

test("environment isolation and read-only production gates use synthetic credentials and no real transport",async()=>{
  const production={...config,MEDIA_STORAGE_ENVIRONMENT:"production",NODE_ENV:"production",REPLIT_DEPLOYMENT:"1",
    MEDIA_STORAGE_PRODUCTION_APPROVED:"true",R2_BUCKET:PRODUCTION_MEDIA_BUCKET,
    R2_PROD_ACCESS_KEY_ID:"synthetic-prod-access",R2_PROD_SECRET_ACCESS_KEY:"synthetic-prod-secret",
    R2_PROD_WRITE_ENABLED:"false",MEDIA_STORAGE_ROUTING:"enabled",MEDIA_STORAGE_PROVIDER:"replit"};
  delete production.R2_DEV_ACCESS_KEY_ID;
  delete production.R2_DEV_SECRET_ACCESS_KEY;
  assert.equal(r2Config(production).credentials.accessKeyId,"synthetic-prod-access");
  assert.throws(()=>r2Config({...config,R2_PROD_ACCESS_KEY_ID:"unused"}),ObjectStoreError);
  for(const key of ["R2_DEV_ACCESS_KEY_ID","R2_DEV_SECRET_ACCESS_KEY"])
    assert.throws(()=>r2Config({...production,[key]:"unused"}),ObjectStoreError);
  for(const change of [{MEDIA_STORAGE_PRODUCTION_APPROVED:""},{NODE_ENV:"development"},{REPLIT_DEPLOYMENT:""},
    {R2_BUCKET:"vco-fixture-test"},{R2_PROD_ACCESS_KEY_ID:""},{R2_PROD_SECRET_ACCESS_KEY:""}])
    assert.throws(()=>r2Config({...production,...change}),ObjectStoreError);
  assert.throws(()=>r2Config({...config,R2_DEV_ACCESS_KEY_ID:"",R2_ACCESS_KEY_ID:"legacy",R2_PROD_ACCESS_KEY_ID:"unused"}),ObjectStoreError);
  assert.equal(mediaStorageEnvironment({...config,NODE_ENV:"production"}),"development");
  assert.equal(routingEnabled(production),true);
  assert.throws(()=>routingEnabled({...production,MEDIA_STORAGE_PROVIDER:"r2"}),ObjectStoreError);
  assert.equal(routingEnabled({...production,MEDIA_STORAGE_PROVIDER:"r2",R2_PROD_WRITE_ENABLED:"true"}),true);
  let calls=0;
  const client={async send(command){calls++;assert.equal(command.input.Bucket,PRODUCTION_MEDIA_BUCKET);
    return {ContentLength:3,ContentType:"image/png",ETag:'"fixture"'};}};
  const store=new R2Store(production,client),k=key();
  await assert.rejects(store.put(k,Buffer.from("png"),"image/png"),ObjectStoreError);
  await assert.rejects(store.delete(k),ObjectStoreError);assert.equal(calls,0);
  await store.metadata(k);assert.equal(calls,1);
  production.R2_PROD_WRITE_ENABLED="true";
  await store.put(k,Buffer.from("png"),"image/png");await store.delete(k);assert.equal(calls,3);
  production.R2_PROD_WRITE_ENABLED="false";
  await assert.rejects(store.delete(k),ObjectStoreError);assert.equal(calls,3);
  production.R2_BUCKET="vco-fixture-test";
  await assert.rejects(store.metadata(k),ObjectStoreError);assert.equal(calls,3);
  assert.equal(mediaDatabaseFingerprint("postgresql://other:other@dev-db.example.invalid:5432/vco_dev"),config.MEDIA_STORAGE_DATABASE_FINGERPRINT);
  assert.notEqual(mediaDatabaseFingerprint("postgres://synthetic@prod-db.example.invalid/vco_dev"),config.MEDIA_STORAGE_DATABASE_FINGERPRINT);
  assert.throws(()=>mediaDatabaseFingerprint("https://example.invalid"),ObjectStoreError);
});

test("credential isolation diagnostic names the resolved environment and keys without exposing values",()=>{
  const production={...config,MEDIA_STORAGE_ENVIRONMENT:"production",NODE_ENV:"production",REPLIT_DEPLOYMENT:"1",
    MEDIA_STORAGE_PRODUCTION_APPROVED:"true",R2_BUCKET:PRODUCTION_MEDIA_BUCKET,
    R2_PROD_ACCESS_KEY_ID:"synthetic-prod-access",R2_PROD_SECRET_ACCESS_KEY:"synthetic-prod-secret"};
  delete production.R2_DEV_ACCESS_KEY_ID;
  delete production.R2_DEV_SECRET_ACCESS_KEY;
  for (const [environment,base,keys] of [
    ["production",production,["R2_DEV_ACCESS_KEY_ID","R2_DEV_SECRET_ACCESS_KEY"]],
    ["development",config,["R2_PROD_ACCESS_KEY_ID","R2_PROD_SECRET_ACCESS_KEY"]],
  ]) {
    for (const value of ["", "synthetic-conflicting-value-must-not-appear"]) {
      assert.throws(()=>r2Config({...base,...Object.fromEntries(keys.map(key=>[key,value]))}),error=>{
        assert.ok(error instanceof ObjectStoreError);
        assert.equal(error.code,"configuration");
        assert.equal(error.message,"Media storage configuration");
        assert.deepEqual(error.diagnostic,{reason:"opposite_environment_credentials",environment,conflictingKeys:keys});
        const output=JSON.stringify(error);
        for (const sensitive of ["synthetic-conflicting-value-must-not-appear","synthetic-prod-access","synthetic-prod-secret",databaseUrl])
          assert.ok(!output.includes(sensitive));
        return true;
      });
    }
  }
});

test("actual S3 adapter contract: private put, metadata, pinned Range, existence, delete, no bearer signing",async()=>{
  const objects=new Map(),calls=[];
  const client={async send(command,options) {
    assert.ok(options.abortSignal); const c=command.constructor.name,i=command.input;calls.push([c,i]);
    assert.equal(i.Bucket,config.R2_BUCKET);
    if (c==="PutObjectCommand") {objects.set(i.Key,{bytes:typeof i.Body==="string"?await readFile(i.Body):
      i.Body instanceof Readable?await bytesOf(i.Body):Buffer.from(i.Body),mime:i.ContentType});return {};}
    if (c==="DeleteObjectCommand") {objects.delete(i.Key);return {};}
    const o=objects.get(i.Key);
    if(!o)throw {$metadata:{httpStatusCode:404},message:"must-not-leak"};
    if(c==="HeadObjectCommand")return {ContentLength:o.bytes.length,ContentType:o.mime,ETag:'"version"'};
    if(i.IfMatch)assert.equal(i.IfMatch,'"version"');
    const m=/bytes=(\d+)-(\d+)/.exec(i.Range||"");
    return {Body:Readable.from(m?o.bytes.subarray(+m[1],+m[2]+1):o.bytes)};
  }};
  const store=new R2Store(config,client),k=key(),bytes=await sharp({create:{width:12,height:9,channels:3,background:"red"}}).png().toBuffer();
  assert.equal(await store.exists(k),false);
  await store.put(k,bytes,"image/png");assert.equal(calls.at(-1)[1].StorageClass,"STANDARD");
  assert.equal(calls.at(-1)[1].ACL,undefined);
  assert.deepEqual(await store.metadata(k),{size:bytes.length,mime:"image/png",version:'"version"'});
  assert.deepEqual(await bytesOf(store.open(k,{start:2,end:20},'"version"')),bytes.subarray(2,21));
  assert.throws(()=>store.sign());
  await store.delete(k);assert.equal(await store.exists(k),false);
  let n=0;
  const denied=new R2Store(config,{async send(){n++;throw {$metadata:{httpStatusCode:403},message:"secret=value"};}});
  await assert.rejects(denied.put(k,bytes,"image/png"),e=>e.code==="authorization"&&!e.message.includes("secret"));
  assert.equal(n,1,"No permission retries or alternate provider");
  await assert.rejects(denied.exists(k),e=>e.code==="authorization","Denied is not missing");
});

function memoryStore() {
  const objects=new Map(),writes=[];
  return {objects,writes,async put(k,b,mime){writes.push(k);objects.set(k,{bytes:typeof b==="string"?await readFile(b):Buffer.from(b),mime});},
    async metadata(k){const o=objects.get(k);if(!o)throw new ObjectStoreError("missing");return {size:o.bytes.length,mime:o.mime,version:"fixture"};},
    open(k,r){const o=objects.get(k);return o?Readable.from(r?o.bytes.subarray(r.start,r.end+1):o.bytes):
      new Readable({read(){this.destroy(new ObjectStoreError("missing"));}});},
    async exists(k){return objects.has(k);},async delete(){assert.fail("Migration must never delete a source");}};
}
test("edge permissions checked before every cache hit; revoke/outage/premium denial; keys and digests cannot expose originals",async()=>{
  const bytes=await sharp({create:{width:8,height:8,channels:3,background:"green"}}).webp().toBuffer();
  const k=thumb(),version=digest(bytes),secret="synthetic-secret-".repeat(4);
  const url=`https://edge.invalid/preview/${k}/${version}`,cacheObjects=new Map();
  let reads=0,auth=0,mode="allow";
  const cache={async match(r){return cacheObjects.get(r.url)?.clone();},async put(r,v){cacheObjects.set(r.url,v.clone());}};
  const pending=[];const ctx={waitUntil(p){pending.push(p);}};
  const env={DEVELOPMENT_ONLY:"true",APP_ORIGIN:"https://app.invalid",MEDIA_EDGE_AUTH_SECRET:secret,
    MEDIA:{async get(key){assert.equal(key,k);reads++;return {size:bytes.length,httpMetadata:{contentType:"image/webp"},
      async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};}}};
  const appFetch=async(url,opts)=>{
    auth++;assert.equal(opts.redirect,"error");assert.equal(opts.cache,"no-store");
    const message=edgeAuthMessage(k,version,opts.headers["X-VCO-Timestamp"]);
    const expected=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const raw=await crypto.subtle.sign("HMAC",expected,new TextEncoder().encode(message));
    assert.equal(Buffer.from(raw).toString("hex"),opts.headers["X-VCO-Signature"]);
    if(mode==="outage")throw new Error("Synthetic auth failure");
    return mode==="allow"?Response.json({allowed:true,version}):new Response(null,{status:404});
  };
  const request=u=>servePreview(new Request(u||url),env,ctx,cache,appFetch);
  let r=await request();assert.equal(r.status,200);assert.equal(r.headers.get("x-vco-cache"),"MISS");
  assert.equal(r.headers.get("cache-control"),"no-store");assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
  await Promise.all(pending);
  r=await request();assert.equal(r.headers.get("x-vco-cache"),"HIT");assert.equal(reads,1);assert.equal(auth,2);
  mode="revoked";assert.equal((await request()).status,404);
  mode="outage";assert.equal((await request()).status,503);
  assert.equal(reads,1,"Neither stale cache nor bucket read when denied");
  for(const bad of [url+"?key=original",url.replace(k,key()),url.replace(version,"x"),url.replace("/preview/","/__private_preview_cache/")])
    assert.equal((await request(bad)).status,404);
  mode="allow";cacheObjects.clear();
  env.MEDIA.get=async()=>({size:bytes.length,httpMetadata:{contentType:"image/webp"},async arrayBuffer(){return new Uint8Array(bytes.length).buffer;}});
  assert.equal((await request()).status,502,"Wrong object bytes cannot populate cache");
});
