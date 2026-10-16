// Disposable application process. No provider traffic, real identities or live DB.
import "./beta-provider-preload.mjs";
import assert from "node:assert/strict";
import express from "express";
import {once} from "node:events";
import {eq} from "drizzle-orm";
import {db} from "../../server/db.ts";
import {users} from "../../shared/schema.ts";
import {storage} from "../../server/storage.ts";
import {R2Store} from "../../server/object-store.ts";
import {registerRoutes} from "../../server/routes.ts";
import {cleanupUploadSessions} from "../../server/resumable-uploads.ts";
import {fixtureRoots} from "./r2-cli-preload.mjs";
import {nativeR2HttpFixture} from "./native-r2-http-fixture.mjs";
import {mockMediaStorage} from "./memory-media-storage.mjs";

assert.ok(process.env.VCO_TEST_PG_PROXY&&process.env.VCO_TEST_OBJECTS&&process.send);
assert.equal(new URL(process.env.DATABASE_URL).hostname,"127.0.0.1");
const [mode,sessionId,actorId]=process.argv.slice(2);
assert.ok(["thumbnail","before-register","after-register","recover"].includes(mode));
const native=nativeR2HttpFixture(fixtureRoots.r2);
mockMediaStorage();
const send=value=>new Promise(resolve=>process.send(value,resolve));
// The parent SIGKILLs this process only after the durable boundary is reached.
const boundary=async()=>{
  await send({kind:"boundary",pid:process.pid});
  await new Promise(()=>{});
};
native.failAfter=async name=>{await send({kind:"provider",name});};
const put=R2Store.prototype.put;
R2Store.prototype.put=async function(key,...args){
  await put.call(this,key,...args);
  await send({kind:"put"});
  if(mode==="thumbnail"&&key.startsWith("thumb-"))await boundary();
};
const finish=storage.finishMedia;
storage.finishMedia=async function(...args){
  if(mode==="before-register")await boundary();
  const result=await finish.apply(this,args);
  if(mode==="after-register")await boundary();
  return result;
};
const [actor]=await db.select().from(users).where(eq(users.id,Number(actorId)));
assert.ok(actor);
const app=express();
app.use((req,_res,next)=>{req.user=actor;req.isAuthenticated=()=>true;next();});
const server=await registerRoutes(app,{workers:false});
server.listen(0,"127.0.0.1");await once(server,"listening");
if(mode==="recover"){
  await cleanupUploadSessions();
  await send({kind:"recovered",pid:process.pid});
}else{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/upload-sessions/${sessionId}/complete`,
    {method:"POST"});
  await send({kind:"unexpected-response",status:response.status});
}
