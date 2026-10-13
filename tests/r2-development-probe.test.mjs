import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { runDevelopmentProbe } from "../server/r2-development-probe.ts";
const env={NODE_ENV:"development",MEDIA_STORAGE_ENVIRONMENT:"development",MEDIA_STORAGE_PROVIDER:"replit",
  MEDIA_STORAGE_ROUTING:"disabled",MEDIA_MIGRATION_ISOLATED:"confirmed",R2_BUCKET_SCOPED_TOKEN_REVIEWED:"true",
  R2_ACCOUNT_ID:"a".repeat(32),R2_BUCKET:"vco-content-media-dev",R2_JURISDICTION:"eu",
  R2_STORAGE_CLASS:"Standard",R2_DEV_ACCESS_KEY_ID:"synthetic",R2_DEV_SECRET_ACCESS_KEY:"synthetic"};
const fixture = (options={}) => {
  const objects=new Map(),calls=[];
  const store={
    async exists(key){calls.push(["exists",key]);return options.collision || objects.has(key);},
    async put(key,bytes,mime,opts){calls.push(["put",key]);assert.equal(opts.createOnly,true);objects.set(key,Buffer.from(bytes));
      if(options.lostPut)throw new Error("Sensitive upstream message must never appear in report");},
    async metadata(key){return {size:objects.get(key).length,mime:"image/webp",version:'"fixture"'};},
    open(key,range,version){assert.equal(version,'"fixture"');return Readable.from(objects.get(key));},
    async delete(key){calls.push(["delete",key]);if(options.cleanupFailure)throw new Error("sensitive");objects.delete(key);},
    sign(){throw new Error();},
  };
  return {objects,calls,store};
};
test("offline gates stop before any store or fetch; no production credential fallback",async()=>{
  for(const change of [{MEDIA_STORAGE_ENVIRONMENT:"production"},{REPLIT_DEPLOYMENT:"1"},
    {R2_BUCKET:"vco-content-media"},{R2_JURISDICTION:"weur"},{MEDIA_STORAGE_PROVIDER:"r2"},
    {MEDIA_STORAGE_ROUTING:"enabled"},{R2_DEV_ACCESS_KEY_ID:""},{R2_BUCKET_SCOPED_TOKEN_REVIEWED:""},
    {R2_PROD_ACCESS_KEY_ID:"synthetic-forbidden"},{R2_BUCKET:"different-dev"}]) {
    const result=await runDevelopmentProbe({env:{...env,...change},authorized:true,
      makeStore(){assert.fail("store must not be constructed");},anonymousFetch(){assert.fail("no fetch");}});
    assert.equal(result.connectivity,"FAIL");assert.equal(result.probe,null);
  }
  const result=await runDevelopmentProbe({env,makeStore(){assert.fail("authorization required");}});
  assert.equal(result.connectivity,"FAIL");
});
test("object-only probe reports pending manual audit, checks actual SHA and deletes only own new key",async()=>{
  const f=fixture();
  const result=await runDevelopmentProbe({env,authorized:true,makeStore:()=>f.store,
    anonymousFetch:async(url,opts)=>{assert.match(url,/\.eu\.r2\.cloudflarestorage\.com\/vco-content-media-dev\/thumb-/);
      assert.equal(opts.redirect,"manual");return new Response(null,{status:403});}});
  assert.equal(result.connectivity,"PASS");assert.equal(result.cleanup,"PASS");
  assert.equal(result.probe.sourceSha256,result.probe.targetSha256);
  assert.equal(result.configurationAudit,"pending-manual-verification");assert.equal(result.isolation.accountApiUsed,false);
  assert.equal(f.objects.size,0);assert.equal(f.calls.filter(x=>x[0]==="put").length,1);
  assert.deepEqual(f.calls.filter(x=>x[0]==="delete"),[["delete",result.probe.key]]);
});
test("collisions are never overwritten/deleted; anonymous leak and cleanup failure are explicit failures",async()=>{
  for(const options of [{collision:true},{anonymousLeak:true},{unexpectedAnonymous:true},{cleanupFailure:true}]) {
    const f=fixture(options),result=await runDevelopmentProbe({env,authorized:true,makeStore:()=>f.store,
      anonymousFetch:async()=>new Response(null,{status:options.anonymousLeak?200:options.unexpectedAnonymous?400:403})});
    assert.equal(result.connectivity,"FAIL");
    if(options.collision)assert.equal(f.calls.filter(x=>["put","delete"].includes(x[0])).length,0);
    if(options.anonymousLeak)assert.equal(result.cleanup,"PASS");
    if(options.unexpectedAnonymous) {
      assert.equal(result.anonymous.status,"FAIL");assert.equal(result.anonymous.httpStatus,400);
      assert.equal(result.cleanup,"PASS");
    }
    if(options.cleanupFailure)assert.equal(result.cleanup,"FAIL");
  }
});
test("lost PUT response stays failure but exact unique payload proves safe cleanup",async()=>{
  const f=fixture({lostPut:true}),result=await runDevelopmentProbe({env,authorized:true,makeStore:()=>f.store,
    anonymousFetch(){assert.fail("stop on upload error");}});
  assert.equal(result.connectivity,"FAIL");assert.equal(result.cleanup,"PASS");
  assert.equal(f.objects.size,0);assert.ok(!JSON.stringify(result).includes("Sensitive"));
});
