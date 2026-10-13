import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import { mediaItems, mediaAnalysisJobs, events, insertMediaItemSchema } from "../shared/schema.ts";
import { isRetiredMediaTag, retiredTagMessage } from "../shared/media-tag-policy.ts";
import { retiredTagCleanupPlan, applyRetiredTagCleanup } from "../server/retired-tag-cleanup.ts";
import { registerRoutes } from "../server/routes.ts";
import { registerRequestParsers } from "../server/request-parsers.ts";
import { parseRecognition, extractMotorsportImage } from "../server/utils/motorsport-recognition.ts";
import sharp from "sharp";

let gallery, item, server, base;
const variants = ["Real Motorsport", "real motorsport", " REAL   MOTORSPORT ", "\tReal\nMotorsport\r"];
const kept = ["Sim Racing", "Esports", "custom", "custom", "Real Motorsport Festival", "Motorsport"];
const query = (text, values) => pool.query(text, values);
test.before(async () => {
  assert.ok(process.env.VCO_TEST_PG_PROXY, "Use the disposable local PostgreSQL test runner");
  gallery = await storage.createEvent({ title: "Retired tag fixture", description: "Real Motorsport description is untouched",
    date: new Date(), isPremium: false });
  [item] = await db.insert(mediaItems).values({eventId:gallery.id, type:"image",
    url:"https://example.test/photo.jpg", thumbnail:"https://example.test/thumb.jpg",
    caption:"Real Motorsport in free text", tags:[...kept, ...variants], manualTags:[...variants, ...kept],
    suppressedAITags:[...variants, "Day"], identification:[{number:"7", team:"Real Motorsport", drivers:"",
      vehicle:"",manufacturer:"",racingClass:"",discipline:"Real Motorsport",source:"manual"}]}).returning();
  await db.insert(mediaAnalysisJobs).values({mediaId:item.id, fingerprint:"fixture",status:"completed",
    generatedTags:[...variants, ...kept], videoEvidence:{historical:"Real Motorsport",frames:[{tags:variants}]}});
  const app = express();
  registerRequestParsers(app);
  app.use((req, _res, next) => {
    req.user={id:990001,isAdmin:true,creatorStatus:"approved",suspended:false};
    req.isAuthenticated=()=>true;
    next();
  });
  server = await registerRoutes(app,{workers:false});
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if(server) await new Promise(resolve=>server.close(resolve));
  if(gallery) {
    await db.delete(mediaItems).where(eq(mediaItems.eventId,gallery.id));
    await db.delete(events).where(eq(events.id,gallery.id));
  }
  storage.sessionStore.close();
  await pool.end();
});

test("only the whole retired tag is forbidden; free text and custom tags stay legal", () => {
  variants.forEach(tag=>assert.equal(isRetiredMediaTag(tag),true));
  kept.forEach(tag=>assert.equal(isRetiredMediaTag(tag),false));
  const metadata={eventId:gallery.id,type:"image",url:"https://example.test/a.jpg",
    thumbnail:"https://example.test/b.jpg",caption:"Real Motorsport",tags:kept};
  assert.deepEqual(insertMediaItemSchema.parse(metadata).tags,kept);
  for(const field of ["tags","manualTags","suppressedAITags"])
    assert.equal(insertMediaItemSchema.safeParse({...metadata,[field]:variants}).success,false);
});
test("image recognition rejects unexpected retired labels and prompt uses the central vocabulary", async () => {
  assert.deepEqual(parseRecognition(JSON.stringify({tags:["Real Motorsport","Sim Racing","Esports"],vehicles:[]})).tags,
    ["Sim Racing","Esports"]);
  const originalFetch=globalThis.fetch;
  const previous=[process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,process.env.AI_INTEGRATIONS_OPENAI_API_KEY];
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL="https://retired-tag-test.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY="synthetic-key";
  globalThis.fetch=async (_url,options)=>{
    assert.doesNotMatch(JSON.parse(options.body).messages[0].content,/Real Motorsport/);
    return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{
      content:JSON.stringify({tags:["Real Motorsport","Sim Racing","Esports"],vehicles:[]})}}]}),
    {headers:{"content-type":"application/json"}});
  };
  try {assert.deepEqual((await extractMotorsportImage("data:image/png;base64,AAA")).tags,["Sim Racing","Esports"]);}
  finally {
    globalThis.fetch=originalFetch;
    ["AI_INTEGRATIONS_OPENAI_BASE_URL","AI_INTEGRATIONS_OPENAI_API_KEY"].forEach((key,index)=>{
      if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];
    });
  }
});
test("upload and edit reject the retired tag with a correction message and leave the item unchanged", async () => {
  const [before]=await db.select().from(mediaItems).where(eq(mediaItems.id,item.id));
  for(const tag of variants) {
    const edit=await fetch(`${base}/api/media/${item.id}`,{method:"PUT",headers:{"content-type":"application/json"},
      body:JSON.stringify({tags:["custom",tag],caption:"Must not be saved"})});
    assert.equal(edit.status,400); assert.equal((await edit.json()).error,retiredTagMessage);
    const form=new FormData();
    form.append("file",new Blob(["not decoded because metadata must fail first"],{type:"image/png"}),"fixture.png");
    form.append("type","image");form.append("tags",JSON.stringify(["custom",tag]));
    const upload=await fetch(`${base}/api/events/${gallery.id}/media/upload`,{method:"POST",body:form});
    assert.equal(upload.status,400);assert.equal((await upload.json()).error,retiredTagMessage);
  }
  assert.deepEqual((await db.select().from(mediaItems).where(eq(mediaItems.id,item.id)))[0],before);
  for(const field of ["tags","manualTags","suppressedAITags"]) {
    await assert.rejects(storage.createMediaItem({...item,id:undefined,[field]:variants}),{message:retiredTagMessage});
    await assert.rejects(storage.updateMediaItem(item.id,{[field]:variants}),{message:retiredTagMessage});
    await assert.rejects(storage.finishMedia("no-reservation",{...item,[field]:variants}),{message:retiredTagMessage});
  }
});
test("legacy tags are absent from galleries, detail, analysis status and tag-only search before cleanup", async () => {
  assert.deepEqual((await storage.getMediaItem(item.id)).tags,kept);
  assert.deepEqual((await storage.getMediaItems(gallery.id))[0].tags,kept);
  assert.deepEqual((await storage.getPublicEventMediaItems(gallery.id))[0].tags,kept);
  const [retiredOnly]=await db.insert(mediaItems).values({eventId:gallery.id,type:"image",url:"fixture",
    thumbnail:"fixture",tags:variants}).returning();
  try {
    const results=await storage.listPublicMedia(1,48,"Real Motorsport","image",["tags"]);
    assert.equal(results.some(row=>row.id===retiredOnly.id),false);
    assert.equal(results.some(row=>row.id===item.id),true,"legitimate custom phrase remains searchable");
    assert.equal(await storage.countPublicMedia("Real Motorsport","image",["tags"]),1);
  } finally {await db.delete(mediaItems).where(eq(mediaItems.id,retiredOnly.id));}
  const status=await fetch(`${base}/api/media/${item.id}/analysis`);
  assert.equal(status.status,200);
  assert.deepEqual((await status.json()).generatedTags,kept);
});
test("cleanup is read-only by default, checks drift, removes only targeted array entries and is idempotent", async () => {
  const [before]=await db.select().from(mediaItems).where(eq(mediaItems.id,item.id));
  const [jobBefore]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,item.id));
  const plan=await retiredTagCleanupPlan(query);
  assert.equal(plan.affected.media_items,1);
  assert.equal(plan.affected["media_items.tags"],4);
  assert.equal(plan.affected["media_analysis_jobs.generated_tags"],4);
  assert.deepEqual((await db.select().from(mediaItems).where(eq(mediaItems.id,item.id)))[0],before);
  const client=await pool.connect();
  const run=(text,values)=>client.query(text,values);
  try {
    await run("begin");
    await assert.rejects(applyRetiredTagCleanup(run,"0".repeat(64)),/plan changed/);
    await run("rollback");
    await run("begin");
    const result=await applyRetiredTagCleanup(run,plan.fingerprint);
    assert.ok(Object.values(result.after.affected).every(n=>n===0));
    await run("commit");
    const [after]=await db.select().from(mediaItems).where(eq(mediaItems.id,item.id));
    const [jobAfter]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,item.id));
    assert.deepEqual(after,{...before,tags:kept,manualTags:kept,suppressedAITags:["Day"]});
    assert.deepEqual(jobAfter,{...jobBefore,generatedTags:kept});
    const empty=await retiredTagCleanupPlan(query);
    await run("begin");await applyRetiredTagCleanup(run,empty.fingerprint);await run("commit");
    assert.deepEqual((await db.select().from(mediaItems).where(eq(mediaItems.id,item.id)))[0],after);
    // Unaffected NULL arrays and metadata remain exactly unchanged.
    const [untouched]=await db.insert(mediaItems).values({eventId:gallery.id,type:"image",url:"fixture",
      thumbnail:"fixture",tags:null,manualTags:[],caption:"Real Motorsport"}).returning();
    await run("begin");await applyRetiredTagCleanup(run,empty.fingerprint);await run("commit");
    assert.deepEqual((await db.select().from(mediaItems).where(eq(mediaItems.id,untouched.id)))[0],untouched);
  } finally {await run("rollback");client.release();}
});
test("valid custom tags, Sim Racing and Esports can still be edited", async () => {
  const response=await fetch(`${base}/api/media/${item.id}`,{method:"PUT",headers:{"content-type":"application/json"},
    body:JSON.stringify({tags:["arbitrary custom tag","Sim Racing","Esports"]})});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).tags,["arbitrary custom tag","Sim Racing","Esports"]);
  const image=await sharp({create:{width:4,height:4,channels:3,background:"white"}}).png().toBuffer();
  const form=new FormData();
  form.append("file",new Blob([image],{type:"image/png"}),"valid.png");
  form.append("type","image");form.append("tags",JSON.stringify(["custom","Sim Racing","Esports"]));
  form.append("autoTag","false");
  const previous=process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED;
  process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED="true";
  try {
    const upload=await fetch(`${base}/api/events/${gallery.id}/media/upload`,{method:"POST",body:form});
    assert.equal(upload.status,201,await upload.clone().text());
    assert.deepEqual((await upload.json()).tags,["custom","Sim Racing","Esports"]);
  } finally {
    if(previous===undefined)delete process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED;
    else process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED=previous;
  }
});
