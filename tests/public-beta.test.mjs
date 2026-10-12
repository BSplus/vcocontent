import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import { once } from "node:events";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import sharp from "sharp";
import { Client } from "@replit/object-storage";

// Entirely synthetic credentials and content. No real email/provider calls.
process.env.RESEND_API_KEY = "synthetic-mail-key";
process.env.RESEND_FROM = "verify@example.test";
process.env.PUBLIC_SITE_URL = "https://example.test";
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://mock-openai.invalid";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "synthetic-ai-key";
process.env.MEDIA_ANALYSIS_CONCURRENCY = "2"; // Exercise the shared policy ceiling, independent of hosting settings.
const { db, pool } = await import("../server/db.ts");
const { eq, sql, inArray } = await import("drizzle-orm");
const { users, series, events, mediaItems, mediaReservations, referenceDocuments, emailVerifications, betaRateLimits, safetyResults, safetyReviews, mediaAnalysisJobs, mediaCleanup, transactionalEmails } = await import("../shared/schema.ts");
const { drainTransactionalEmails, enqueueTransactionalEmail } = await import("../server/transactional-emails.ts");
const { storage } = await import("../server/storage.ts");
const { setupAuth } = await import("../server/auth.ts");
const { registerRoutes } = await import("../server/routes.ts");
const { creatorUsage, lockedCreatorBudget, takeBetaRate, safeState, SAFETY_POLICY } = await import("../server/beta-policy.ts");
const { parseSafetyResult, checkContent, reviewMediaSafety } = await import("../server/content-safety.ts");
const { stopAnalysisWorker, drainAnalysisQueue, analysisStatus, setAnalysisQueueTestScope } = await import("../server/analysis-jobs.ts");
const { stopImportWorker } = await import("../server/nextcloud.ts");
const { seoHtml } = await import("../server/seo.ts");
const { searchData } = await import("../server/public-search-data.ts");

const originalFetch = globalThis.fetch;
const mail = [];
const mailRequests = [];
const objects = new Map();
const accountIds = [];
const fixtureNames = [];
setAnalysisQueueTestScope(fixtureNames);
const cleanupFixtures=storage.cleanupObjects.bind(storage);
storage.cleanupObjects=()=>cleanupFixtures(accountIds);
const eventIds = [];
const seriesIds = [];
const safetyHashes = [];
const rateKeys = [];
let safetyMode = "clear", releaseSafety, reachedSafety, safetyCalls = 0, mailFails = false, mailStatus = 200;
const clear = {sexualized:"clear",pornography:"clear",racistOrDehumanizing:"clear",hateSymbolsOrGlorification:"clear",visibleTextAndSymbolsReviewed:true};
globalThis.fetch = async (input,init) => {
  const url = String(input?.url || input);
  if (url.startsWith("https://api.resend.com/")) {
    mail.push(JSON.parse(init.body));
    mailRequests.push({body:JSON.parse(init.body),key:init.headers["Idempotency-Key"]});
    return new Response('{"detail":"provider-private-information"}',{status:mailFails?500:mailStatus});
  }
  if (url.startsWith("https://mock-openai.invalid")) {
    const request = JSON.parse(init.body);
    const isSafety = request.messages[0].content.includes("publication safety reviewer");
    let content = "Day, Race Car";
    if (isSafety) {
      safetyCalls++;
      const user = request.messages[1].content;
      const text = user.find(part=>part.type==="text").text;
      const image = user.find(part=>part.type==="image_url")?.image_url.url.split(",")[1] || "";
      safetyHashes.push(createHash("sha256").update(SAFETY_POLICY).update(request.model).update(text).update(Buffer.from(image,"base64")).digest("hex"));
      if (safetyMode==="hold") {
        reachedSafety?.();
        await new Promise(resolve=>{releaseSafety=resolve;});
      }
      if (safetyMode==="provider-error") return new Response("{}",{status:500});
      if (safetyMode==="timeout") throw new Error("Synthetic transport failure");
      content = safetyMode==="malformed" ? "{}" : JSON.stringify({...clear,
        ...(safetyMode==="blocked"?{pornography:"prohibited"}:{}),
        ...(safetyMode==="incomplete"?{visibleTextAndSymbolsReviewed:false,hateSymbolsOrGlorification:"uncertain"}:{}),
        ...(safetyMode==="review"?{hateSymbolsOrGlorification:"uncertain"}:{})});
    }
    return new Response(JSON.stringify({id:"synthetic",choices:[{finish_reason:"stop",message:{content}}]}),
      {headers:{"Content-Type":"application/json"}});
  }
  return originalFetch(input,init);
};
const originalObjectMethods = {};
for (const name of ["uploadFromFilename","uploadFromBytes","downloadAsStream","delete"]) originalObjectMethods[name]=Client.prototype[name];
Client.prototype.uploadFromFilename = async function(key,path) {objects.set(key,await readFile(path));return {ok:true,value:null};};
Client.prototype.uploadFromBytes = async function(key,data) {objects.set(key,Buffer.from(data));return {ok:true,value:null};};
Client.prototype.downloadAsStream = function(key) {
  return objects.has(key)?Readable.from(objects.get(key)):new Readable({read(){this.destroy(new Error("Synthetic missing object"));}});
};
Client.prototype.delete = async function(key) {objects.delete(key);return {ok:true,value:null};};
const app = express();
// Separate abuse-limit namespace per run; never reset a real visitor's bucket.
const testIp=`198.18.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)+1}`;
app.set("trust proxy",true);
app.use(express.json({limit:"2mb"}));
app.use(session({secret:"synthetic-beta-session",resave:false,saveUninitialized:false}));
setupAuth(app);
const server = await registerRoutes(app,{workers:false});
server.listen(0,"127.0.0.1"); await once(server,"listening");
const base = `http://127.0.0.1:${server.address().port}`;
async function request(path,{cookie,method="GET",body,form,ip=testIp}={}) {
  const response = await originalFetch(base+path,{method,headers:{
    "X-Forwarded-For":ip,
    ...(cookie?{cookie}:{}),...(body?{"Content-Type":"application/json"}:{})},
    body:form || (body?JSON.stringify(body):undefined)});
  const data = await response.json().catch(()=>null);
  return {status:response.status,data,cookie:response.headers.get("set-cookie")?.split(";")[0]};
}
async function account({verified=true,admin=false,creator=false}={}) {
  await stopAnalysisWorker();
  const ip=`198.19.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)+1}`;
  rateKeys.push(`register:${createHash("sha256").update(ip).digest("hex")}`);
  const id = randomUUID().slice(0,8);
  const result = await request("/api/register",{ip,method:"POST",body:{username:`betatest_${id}`,email:`betatest_${id}@example.test`,password:"Synthetic123!",isAdmin:true,credits:"900",emailVerifiedAt:new Date()}});
  assert.equal(result.status,201); accountIds.push(result.data.id);
  fixtureNames.push(result.data.username);
  setAnalysisQueueTestScope(fixtureNames);
  assert.equal(result.data.isAdmin,false);assert.equal(result.data.emailVerifiedAt,null);assert.equal(result.data.credits,"0");
  if (verified) {
    const token = mail.at(-1).text.match(/#verify=([a-f0-9]{64})/)[1];
    rateKeys.push(`verify-confirm:${createHash("sha256").update(ip).digest("hex")}`);
    assert.equal((await request("/api/email-verification/confirm",{ip,method:"POST",body:{token}})).status,200);
  }
  if (admin || creator) await db.update(users).set({isAdmin:admin,isCreator:creator,creatorStatus:creator?"approved":"none"}).where(eq(users.id,result.data.id));
  return {id:result.data.id,cookie:result.cookie};
}
async function gallery(owner,title="Synthetic racing photography") {
  const result = await request("/api/creator/events",{cookie:owner.cookie,method:"POST",body:{title,description:"Community event",date:new Date(),visibility:"published",safetyStatus:"approved"}});
  assert.equal(result.status,201,JSON.stringify(result.data));
  eventIds.push(result.data.id);return result.data;
}
async function upload(owner,eventId,{mode="clear",caption=randomUUID(),autoTag="false",data,mime="image/png",type="image",keepMode=false}={}) {
  safetyMode = mode;
  const bytes = data || await sharp({create:{width:64,height:48,channels:3,background:"#2e765f"}}).png().toBuffer();
  const form = new FormData();form.append("file",new Blob([bytes],{type:mime}),"synthetic.png");
  form.append("type",type);form.append("caption",caption);form.append("autoTag",autoTag);
  const result = await request(`/api/events/${eventId}/media/upload`,{cookie:owner.cookie,method:"POST",form});
  if (mode!=="hold" && !keepMode) safetyMode = "clear";
  return result;
}
async function publish(owner,id,published=true) {
  return request(`/api/events/${id}/publish`,{cookie:owner.cookie,method:"POST",body:{published}});
}
test.after(async()=>{
  await stopAnalysisWorker(); await stopImportWorker();
  await new Promise(resolve=>server.close(resolve));
});
// Cleanup explicitly scoped to disposable fixtures; never existing data.
test.after(async()=>{
  globalThis.fetch=originalFetch;
  for (const [key,value] of Object.entries(originalObjectMethods)) Client.prototype[key]=value;
  if (accountIds.length) {
    await db.execute(sql`delete from media_items where event_id in (select id from events where creator_id in (${sql.join(accountIds.map(id=>sql`${id}`),sql`, `)}))`);
    await db.delete(mediaReservations).where(inArray(mediaReservations.creatorId,accountIds));
    await db.delete(referenceDocuments).where(inArray(referenceDocuments.ownerId,accountIds));
    await db.delete(mediaCleanup).where(inArray(mediaCleanup.creatorId,accountIds));
    await db.delete(events).where(inArray(events.creatorId,accountIds));
    if (seriesIds.length) await db.delete(series).where(inArray(series.id,seriesIds));
    await db.delete(safetyReviews).where(inArray(safetyReviews.adminId,accountIds));
    await db.delete(users).where(inArray(users.id,accountIds));
    for (const id of accountIds) for (const prefix of ["verify-send:","verify-daily:","gallery:","upload:","safety:","analysis:","reference:","safety-admin:","storage-check:"])
      rateKeys.push(prefix+id);
  }
  if (safetyHashes.length) await db.delete(safetyResults).where(inArray(safetyResults.fingerprint,safetyHashes));
  if (rateKeys.length) await db.delete(betaRateLimits).where(inArray(betaRateLimits.key,rateKeys));
  await db.delete(betaRateLimits).where(eq(betaRateLimits.key,`verify-confirm:${createHash("sha256").update(testIp).digest("hex")}`));
  await pool.end();
});
test("strict safety categories fail closed and never use protected traits as a decision",()=>{
  assert.equal(parseSafetyResult(clear).status,"approved");
  for (const key of ["sexualized","pornography","racistOrDehumanizing","hateSymbolsOrGlorification"]) {
    assert.equal(parseSafetyResult({...clear,[key]:"prohibited"}).status,"blocked");
    assert.equal(parseSafetyResult({...clear,[key]:"uncertain"}).status,"review");
  }
  assert.equal(parseSafetyResult({...clear,visibleTextAndSymbolsReviewed:false}).status,"error");
  assert.equal(parseSafetyResult({...clear,hateSymbolsOrGlorification:"uncertain",visibleTextAndSymbolsReviewed:false}).status,"error");
  assert.equal(parseSafetyResult({}).status,"error");
  assert.equal(parseSafetyResult({...clear,race:"synthetic"}).status,"error");
});
test("admin series PNG updates persist, ignore administrative fields and return safe validation errors", async () => {
  const admin = await account({admin:true}), stranger = await account({creator:true}), viewer = await account();
  const [record] = await db.insert(series).values({name:"Synthetic official series "+randomUUID(),logo:null,description:null}).returning();
  seriesIds.push(record.id);
  const path = `/api/series/${record.id}`;
  const logo = "data:image/png;base64," + (await sharp({create:{width:16,height:16,channels:4,background:"#0088ff"}}).png().toBuffer()).toString("base64");
  for (const cookie of [undefined, stranger.cookie, viewer.cookie]) {
    assert.equal((await request(path,{cookie,method:"PUT",body:{logo}})).status, cookie ? 403 : 401);
  }
  const full = await request(path,{cookie:admin.cookie,method:"PUT",body:{...record,logo}});
  assert.equal(full.status,200,JSON.stringify(full.data));
  const edited = await request(path,{cookie:admin.cookie,method:"PUT",body:{
    name:"Renamed synthetic series",description:"",id:record.id+1000,creatorId:stranger.id,createdAt:"invalid timestamp",
  }});
  assert.equal(edited.status,200);
  const saved = (await request(path)).data;
  assert.equal(saved.logo,logo); assert.equal(saved.name,"Renamed synthetic series"); assert.equal(saved.description,"");
  assert.equal(saved.id,record.id); assert.equal(saved.creatorId,null);
  assert.equal(saved.createdAt,record.createdAt.toISOString());
  const replacementLogo = "data:image/png;base64," + (await sharp({create:{width:16,height:16,channels:4,background:"#00aa55"}}).png().toBuffer()).toString("base64");
  assert.equal((await request(path,{cookie:admin.cookie,method:"PUT",body:{logo:replacementLogo}})).status,200);
  assert.equal((await request(path)).data.logo,replacementLogo);
  for (const body of [{name:" "},{description:"x".repeat(1001)},{logo:"private-invalid-payload"},{logo:123},{creatorId:123}]) {
    const result = await request(path,{cookie:admin.cookie,method:"PUT",body});
    assert.equal(result.status,400); assert.notEqual(result.data.error,"Failed to update series");
    assert.doesNotMatch(JSON.stringify(result.data),/private-invalid-payload|ZodError|sql|createdAt/);
  }
  const originalUpdate = storage.updateSeries;
  storage.updateSeries = async () => {throw new Error("synthetic private SQL and payload");};
  try {
    const failed = await request(path,{cookie:admin.cookie,method:"PUT",body:{logo}});
    assert.equal(failed.status,500);
    assert.deepEqual(failed.data,{error:"Could not save the series. Please try again."});
  } finally {storage.updateSeries=originalUpdate;}
});
test("community series retain owner, verification, moderation and no-logo rules", async () => {
  const owner = await account({creator:true}), stranger = await account({creator:true}), unverified = await account({creator:true,verified:false});
  for (const creator of [owner,unverified]) {
    const [record] = await db.insert(series).values({name:"Synthetic community series "+randomUUID(),creatorId:creator.id}).returning();
    seriesIds.push(record.id);
    const path = `/api/series/${record.id}`;
    assert.equal((await request(path,{cookie:stranger.cookie,method:"PUT",body:{name:"Unauthorized"}})).status,403);
    if (creator === unverified) {
      assert.equal((await request(path,{cookie:creator.cookie,method:"PUT",body:{name:"Neutral synthetic name"}})).status,403);
      continue;
    }
    assert.equal((await request(path,{cookie:owner.cookie,method:"PUT",body:{logo:"https://example.test/logo.png"}})).status,400);
    assert.equal((await request(path,{cookie:owner.cookie,method:"PUT",body:{description:null,logo:""}})).status,200);
    safetyMode = "blocked";
    try {
      assert.equal((await request(path,{cookie:owner.cookie,method:"PUT",body:{name:"Synthetic moderated "+randomUUID()}})).status,400);
    } finally {safetyMode="clear";}
    delete process.env.RESEND_API_KEY;
    try {
      assert.equal((await request(path,{cookie:owner.cookie,method:"PUT",body:{name:"Synthetic verified config"}})).status,403);
    } finally {process.env.RESEND_API_KEY="synthetic-mail-key";}
    const saved = (await storage.getSeries(record.id));
    assert.equal(saved.name,record.name); assert.equal(saved.creatorId,owner.id);
  }
});
test("public gallery pagination selects visible photos before offset and keeps owner/admin quarantine views",async()=>{
  const owner=await account({creator:true}),admin=await account({admin:true}),event=await gallery(owner);
  assert.equal((await publish(owner,event.id)).status,200);
  const photo=status=>({
    eventId:event.id,type:"image",url:`/api/media/files/media-${randomUUID()}.webp`,
    thumbnail:`/api/media/files/thumb-${randomUUID()}.webp`,caption:"Synthetic pagination fixture",
    tags:[],isPremium:false,safetyStatus:status,safetyPolicy:SAFETY_POLICY,contentVersion:1,safetyVersion:1,
  });
  const approved=await db.insert(mediaItems).values(Array.from({length:49},()=>photo("approved"))).returning();
  const hidden=await db.insert(mediaItems).values([
    photo("pending"),photo("review"),photo("error"),photo("blocked"),
    {...photo("approved"),safetyPolicy:"old-policy"},
    {...photo("approved"),safetyVersion:0},
  ]).returning();
  const first=await request(`/api/events/${event.id}/media?page=1`);
  const second=await request(`/api/events/${event.id}/media?page=2`);
  assert.equal(first.status,200);assert.equal(first.data.length,48,"A mixed page must not prematurely disable Next");
  assert.equal(second.data.length,1);
  assert.deepEqual([...first.data,...second.data].map(item=>item.id),approved.map(item=>item.id).reverse());
  for(const viewer of [owner,admin]) {
    const managed=await request(`/api/events/${event.id}/media?page=1`,{cookie:viewer.cookie});
    assert.equal(managed.data.length,48);
    assert.ok(hidden.every(item=>managed.data.some(row=>row.id===item.id)),"Managers retain private quarantine");
  }
  await db.update(mediaItems).set({safetyStatus:"pending"}).where(inArray(mediaItems.id,approved.slice(1).map(item=>item.id)));
  const lone=await request(`/api/events/${event.id}/media?page=1`);
  assert.deepEqual(lone.data.map(item=>item.id),[approved[0].id],"Pending first-page rows must not conceal a later approved photo");
  assert.deepEqual((await request(`/api/events/${event.id}/media?page=2`)).data,[]);
});
test("incomplete visual inspection cannot be approved, including review results from the previous policy",async()=>{
  const owner=await account({creator:true}),admin=await account({admin:true}),event=await gallery(owner);
  assert.equal((await publish(owner,event.id)).status,200);
  try {
    const result=await upload(owner,event.id,{mode:"incomplete",keepMode:true});
    await stopAnalysisWorker();
    let item=await storage.getMediaItem(result.data.id);
    assert.equal(item.safetyStatus,"error");
    const approve=()=>request(`/api/admin/safety/media/${item.id}/review`,{cookie:admin.cookie,method:"POST",
      body:{decision:"approve",reason:"Synthetic approval must not bypass incomplete inspection.",version:item.contentVersion,policy:SAFETY_POLICY}});
    assert.equal((await approve()).status,409);
    for(const path of [`/api/media/${item.id}`,item.url,item.thumbnail])
      assert.equal((await originalFetch(base+path)).status,404);
    await db.update(mediaItems).set({safetyStatus:"review",safetyPolicy:"vco-community-safety-1"}).where(eq(mediaItems.id,item.id));
    assert.equal((await approve()).status,409,"An older policy's incomplete review cannot be grandfathered into approval");
    const privateList=await request("/api/creator/media",{cookie:owner.cookie});
    assert.equal(privateList.data.find(row=>row.id===item.id).safetyRetryAllowed,true);
    const retried=await request(`/api/media/${item.id}/safety/retry`,{cookie:owner.cookie,method:"POST"});
    assert.equal(retried.status,200);assert.equal(retried.data.safetyStatus,"error");
    item=retried.data;
    assert.equal(item.safetyPolicy,SAFETY_POLICY);
    assert.equal((await approve()).status,409);
    assert.equal((await storage.getMediaItem(item.id)).url,result.data.url);
  } finally {await stopAnalysisWorker();safetyMode="clear";}
});
test("transactional welcome, creator and first-publication emails are confirmed, deduplicated and retried safely",async()=>{
  // This suite runs only against its disposable PostgreSQL instance.
  await db.delete(transactionalEmails);
  const user=await account({verified:false});
  const token=mail.at(-1).text.match(/#verify=([a-f0-9]{64})/)[1];
  assert.equal((await db.select().from(transactionalEmails)).length,0);
  const confirmed=await Promise.all([1,2].map(()=>request("/api/email-verification/confirm",{method:"POST",body:{token}})));
  assert.deepEqual(confirmed.map(r=>r.status).sort(),[200,400]);
  const activated=await Promise.all([1,2].map(()=>request("/api/creator/request",{cookie:user.cookie,method:"POST"})));
  // The existing shared safety-review lease can reject an overlapping request.
  assert.ok(activated.some(r=>r.status===200));
  assert.ok(activated.every(r=>[200,403].includes(r.status)));
  assert.equal((await request("/api/creator/request",{cookie:user.cookie,method:"POST"})).status,200);
  assert.equal((await db.select().from(transactionalEmails)).length,2);
  const event=await gallery(user);
  const stranger=await account({creator:true});
  // Remove this unrelated fixture's welcome event, not the test recipient's.
  await db.delete(transactionalEmails).where(eq(transactionalEmails.userId,stranger.id));
  assert.equal((await publish(stranger,event.id)).status,403);
  assert.equal((await db.select().from(transactionalEmails)).length,2);
  assert.equal((await publish(user,event.id)).status,200);
  assert.equal((await publish(user,event.id)).status,200);
  assert.equal((await publish(user,event.id,false)).status,200);
  assert.equal((await publish(user,event.id)).status,200);
  assert.equal((await db.select().from(transactionalEmails)).length,3);
  const originalKey=process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  await drainTransactionalEmails();
  process.env.RESEND_API_KEY=originalKey;
  assert.ok((await db.select().from(transactionalEmails)).every(row=>row.attempts===0));
  const start=mailRequests.length;
  mailFails=true;
  try {await drainTransactionalEmails();} finally {mailFails=false;}
  assert.ok((await db.select().from(transactionalEmails)).every(row=>row.status==="pending" && row.attempts===1));
  assert.equal((await request("/api/user",{cookie:user.cookie})).data.isCreator,true);
  assert.equal((await request(`/api/events/${event.id}`)).status,200);
  assert.equal((await request(`/api/events/${event.id}`,{cookie:user.cookie,method:"PUT",
    body:{title:"Changed after transient provider failure"}})).status,200);
  await db.update(transactionalEmails).set({nextAttemptAt:new Date(0)});
  await Promise.all([drainTransactionalEmails(),drainTransactionalEmails()]);
  const rows=await db.select().from(transactionalEmails);
  assert.ok(rows.every(row=>row.status==="accepted" && row.acceptedAt && row.attempts===2));
  assert.ok(rows.every(row=>row.content===null && row.recipient===null));
  const sent=mailRequests.slice(start);
  assert.equal(sent.length,6);
  for (const row of rows) {
    const attempts=sent.filter(request=>request.key===`vco-${row.key}`);
    assert.equal(attempts.length,2);
    assert.deepEqual(attempts[0].body,attempts[1].body,"Retries must preserve the idempotent payload");
    assert.equal(attempts[1].body.from,process.env.RESEND_FROM);
    assert.ok(attempts[1].body.text.includes(process.env.PUBLIC_SITE_URL));
    assert.doesNotMatch(attempts[1].body.text,/#verify=|#reset=|provider-private/);
  }
  const creator=sent.find(request=>request.key===`vco-creator-welcome:${user.id}`);
  assert.match(creator.body.text,/5 galleries[\s\S]*1,000 photos[\s\S]*500 MB/);
  const before=mail.length;
  await drainTransactionalEmails();
  await publish(user,event.id,false);
  await publish(user,event.id);
  await request("/api/creator/request",{cookie:user.cookie,method:"POST"});
  await drainTransactionalEmails();
  assert.equal(mail.length,before,"Ordinary repeated events must not send again");

  const hidden=await gallery(user);
  await publish(user,hidden.id);
  await db.update(events).set({adminHidden:true}).where(eq(events.id,hidden.id));
  await drainTransactionalEmails();
  assert.equal(mail.length,before,"A now-hidden gallery must not be promoted");
  assert.equal((await db.select().from(transactionalEmails).where(eq(transactionalEmails.galleryId,hidden.id)))[0].status,"skipped");

  const failedUser=await account();
  mailStatus=422;
  try {await drainTransactionalEmails();} finally {mailStatus=200;}
  assert.equal((await db.select().from(transactionalEmails).where(eq(transactionalEmails.userId,failedUser.id)))[0].status,"failed");
  assert.ok((await request("/api/user",{cookie:failedUser.cookie})).data.emailVerifiedAt);
  await db.transaction(async tx=>{
    await tx.update(users).set({bio:"Account state survives queue failure"}).where(eq(users.id,user.id));
    await enqueueTransactionalEmail(tx,"gallery-published",user.id,2147483647);
  });
  assert.equal((await db.select().from(users).where(eq(users.id,user.id)))[0].bio,"Account state survives queue failure");
  const admin=await account({admin:true});
  for (let i=0;i<2;i++) assert.equal((await request(`/api/admin/users/${failedUser.id}`,{cookie:admin.cookie,
    method:"PATCH",body:{action:"approve_creator"}})).status,200);
  assert.equal((await db.select().from(transactionalEmails)
    .where(eq(transactionalEmails.key,`creator-welcome:${failedUser.id}`))).length,1);
  const earlyApproved=await account({verified:false});
  const earlyToken=mail.at(-1).text.match(/#verify=([a-f0-9]{64})/)[1];
  assert.equal((await request(`/api/admin/users/${earlyApproved.id}`,{cookie:admin.cookie,
    method:"PATCH",body:{action:"approve_creator"}})).status,200);
  assert.equal((await db.select().from(transactionalEmails).where(eq(transactionalEmails.userId,earlyApproved.id))).length,0);
  assert.equal((await request("/api/email-verification/confirm",{method:"POST",body:{token:earlyToken}})).status,200);
  assert.deepEqual((await db.select().from(transactionalEmails).where(eq(transactionalEmails.userId,earlyApproved.id)))
    .map(row=>row.kind).sort(),["creator-welcome","welcome"]);
});

test("register → single-use email verification → self activation, including failure and cooldown",async()=>{
  const user = await account({verified:false});
  const email = mail.at(-1);
  assert.equal(email.from, process.env.RESEND_FROM);
  assert.equal(email.subject, "Verify your email | VCO");
  assert.match(email.html, />VERIFY EMAIL</);
  assert.match(email.html, /cid:vco-logo/);
  assert.equal(email.attachments[0].content_id, "vco-logo");
  assert.equal(email.attachments[0].content_type, "image/png");
  assert.ok(Buffer.from(email.attachments[0].content, "base64").subarray(0, 8)
    .equals(Buffer.from([137,80,78,71,13,10,26,10])));
  const textLink = email.text.match(/https:\/\/example\.test\/auth#verify=[a-f0-9]{64}/)?.[0];
  assert.ok(textLink);
  assert.ok(email.html.includes(textLink));
  assert.equal((await request("/api/creator/request",{cookie:user.cookie,method:"POST"})).status,403);
  assert.equal((await request("/api/email-verification/send",{cookie:user.cookie,method:"POST"})).status,429);
  const token = mail.at(-1).text.match(/#verify=([a-f0-9]{64})/)[1];
  const stored = await db.select().from(emailVerifications).where(eq(emailVerifications.userId,user.id));
  assert.notEqual(stored[0].tokenHash,token);
  const redeemed = await Promise.all([1,2].map(()=>request("/api/email-verification/confirm",{method:"POST",body:{token}})));
  assert.deepEqual(redeemed.map(r=>r.status).sort(),[200,400]);
  assert.equal((await request("/api/creator/request",{cookie:user.cookie,method:"POST"})).status,200);
  await db.update(users).set({creatorStatus:"rejected",isCreator:true}).where(eq(users.id,user.id));
  assert.equal((await request("/api/creator/request",{cookie:user.cookie,method:"POST"})).status,403);
  assert.equal((await request("/api/creator/events",{cookie:user.cookie})).status,403);
  const expired = await account({verified:false});
  const expiredToken = mail.at(-1).text.match(/#verify=([a-f0-9]{64})/)[1];
  await db.update(emailVerifications).set({expiresAt:new Date(0)}).where(eq(emailVerifications.userId,expired.id));
  assert.equal((await request("/api/email-verification/confirm",{method:"POST",body:{token:expiredToken}})).status,400);
  assert.equal((await db.select().from(transactionalEmails).where(eq(transactionalEmails.userId,expired.id))).length,0);
  await db.delete(betaRateLimits).where(eq(betaRateLimits.key,`verify-send:${expired.id}`));
  mailFails=true;
  assert.equal((await request("/api/email-verification/send",{cookie:expired.cookie,method:"POST"})).status,502);
  mailFails=false;
  assert.equal((await db.select().from(emailVerifications).where(eq(emailVerifications.userId,expired.id))).length,0);
});
test("photo approval, draft/publish, manual text versions, private quarantine and every delivery path",async()=>{
  const owner=await account({creator:true}), admin=await account({admin:true}), stranger=await account({creator:true});
  const event=await gallery(owner);
  assert.equal(event.visibility,"draft");assert.equal(event.safetyStatus,"approved");
  assert.equal((await request(`/api/events/${event.id}`)).status,404);
  const safe=await upload(owner,event.id);
  assert.equal(safe.status,201);assert.equal(safe.data.safetyStatus,"approved");
  assert.equal((await publish(owner,event.id)).status,200);
  assert.equal((await request(`/api/media/${safe.data.id}`)).status,200);
  assert.equal((await request(`/api/media/${safe.data.id}/download`,{method:"POST"})).status,401);
  assert.equal((await request(`/api/media/${safe.data.id}/download`,{method:"POST",cookie:owner.cookie})).status,200);
  const blocked=await upload(owner,event.id,{mode:"blocked"});
  assert.equal(blocked.status,201);assert.equal(blocked.data.safetyStatus,"blocked");
  for (const path of [`/api/media/${blocked.data.id}`,blocked.data.thumbnail,blocked.data.url,
    `/api/media/${blocked.data.id}/download?quality=low`,`/api/media/${blocked.data.id}/download?quality=high`,
    `/api/media/legacy/${blocked.data.id}/thumbnail`,`/api/media/legacy/${blocked.data.id}/file`]) {
    assert.equal((await originalFetch(base+path,{headers:{cookie:stranger.cookie}})).status,404,path);
  }
  assert.equal((await originalFetch(base+blocked.data.thumbnail,{headers:{cookie:owner.cookie}})).status,200);
  assert.equal((await originalFetch(base+blocked.data.thumbnail,{headers:{cookie:admin.cookie}})).status,200);
  assert.equal((await request(`/api/events/${event.id}/media`)).data.some(m=>m.id===blocked.data.id),false);
  assert.equal((await request("/api/media?q="+blocked.data.caption)).data.some(m=>m.id===blocked.data.id),false);
  assert.equal((await request("/api/media/creator-top")).data.some(m=>m.id===blocked.data.id),false);
  assert.equal((await request(`/api/admin/safety/media/${blocked.data.id}/review`,{cookie:admin.cookie,method:"POST",body:{decision:"approve",reason:"Synthetic review explanation",version:blocked.data.contentVersion,policy:SAFETY_POLICY}})).status,409);
  assert.equal((await request(`/api/events/${event.id}`,{cookie:stranger.cookie,method:"PUT",body:{title:"Unauthorized"}})).status,403);
  assert.equal((await request(`/api/media/${safe.data.id}`,{cookie:owner.cookie,method:"PUT",body:{safetyStatus:"approved"}})).status,400);
  const edited=await request(`/api/media/${safe.data.id}`,{cookie:owner.cookie,method:"PUT",body:{caption:"Edited neutral caption",tags:["manual"]}});
  assert.equal(edited.status,200);assert.equal(edited.data.caption,"Edited neutral caption");assert.equal(edited.data.safetyVersion,edited.data.contentVersion);
  assert.equal((await request(`/api/events/${event.id}`,{cookie:owner.cookie,method:"PUT",body:{coverImage:"https://example.test/bypass.png"}})).status,400);
  const uncertain=await upload(owner,event.id,{mode:"review"});
  assert.equal(uncertain.data.safetyStatus,"review");
  assert.equal((await request(`/api/admin/safety/media/${uncertain.data.id}/review`,{cookie:admin.cookie,method:"POST",
    body:{decision:"approve",reason:"Stale version must not be approved.",version:uncertain.data.contentVersion+1,policy:SAFETY_POLICY}})).status,409);
  assert.equal((await request(`/api/admin/safety/media/${uncertain.data.id}/review`,{cookie:admin.cookie,method:"POST",body:{decision:"approve",reason:"Neutral synthetic picture; false alarm.",version:uncertain.data.contentVersion,policy:SAFETY_POLICY}})).status,200);
  assert.equal((await request(`/api/media/${uncertain.data.id}`)).status,200);
  const discoverablePhotos = await searchData.images(event.id);
  assert.ok(discoverablePhotos.some(item => item.id === safe.data.id));
  assert.ok(discoverablePhotos.some(item => item.id === uncertain.data.id));
  assert.ok(!discoverablePhotos.some(item => item.id === blocked.data.id));
  assert.ok(discoverablePhotos.every(item => !("url" in item) && !("identification" in item)));
  assert.ok((await searchData.events("all",1,500,owner.id)).some(item=>item.id===event.id));
  const restarted=await promisify(execFile)(process.execPath,["--import","tsx","--input-type=module","-e",
    `const {storage}=await import('./server/storage.ts');const {safeState}=await import('./server/beta-policy.ts');
    const {pool}=await import('./server/db.ts');console.log(JSON.stringify([safeState(await storage.getMediaItem(${uncertain.data.id})),safeState(await storage.getMediaItem(${blocked.data.id}))]));await pool.end();`],
    {cwd:process.cwd(),timeout:15000});
  assert.deepEqual(JSON.parse(restarted.stdout.trim()),[true,false],"A fresh server process uses durable approval/quarantine, not an in-memory permit");
  assert.equal((await request(`/api/admin/events/${event.id}/visibility`,{cookie:admin.cookie,method:"PATCH",body:{hidden:true}})).status,200);
  assert.equal((await publish(owner,event.id)).status,403);
  assert.equal((await searchData.images(event.id)).length,0);
  assert.ok(!(await searchData.events("all",1,500,owner.id)).some(item=>item.id===event.id));
  for (const path of [`/api/events/${event.id}`,`/api/media/${safe.data.id}`,safe.data.thumbnail]) assert.equal((await originalFetch(base+path)).status,404);
  assert.equal((await request(`/api/admin/events/${event.id}/visibility`,{cookie:admin.cookie,method:"PATCH",body:{hidden:false}})).status,200);
  await request(`/api/admin/users/${owner.id}`,{cookie:admin.cookie,method:"PATCH",body:{action:"suspend_creator"}});
  assert.equal((await searchData.images(event.id)).length,0);
  assert.ok(!(await searchData.creators()).some(item=>item.id===owner.id));
  assert.equal((await request("/api/creator/events",{cookie:owner.cookie})).status,403);
  assert.equal((await request(`/api/events/${event.id}`)).status,404);
  const seo=await seoHtml({originalUrl:`/media/${safe.data.id}`}, "<head></head>");
  assert.equal(seo.status,404);assert.equal(seo.html.includes("Edited neutral caption"),false);
  assert.equal((await request("/api/credits/purchase",{cookie:admin.cookie,method:"POST"})).status,503);
  assert.equal((await request("/api/webhook/stripe",{method:"POST"})).status,503);
  assert.equal((await request("/api/creator/earnings",{cookie:admin.cookie})).status,503);
});
test("provider failure, missing configuration, race with publish and policy/version invalidation stay private",async()=>{
  const owner=await account({creator:true}), event=await gallery(owner);
  for (const mode of ["provider-error","malformed","timeout"]) {
    const result=await upload(owner,event.id,{mode});
    assert.equal(result.status,201);assert.equal(result.data.safetyStatus,"error");
    assert.equal((await originalFetch(base+result.data.thumbnail)).status,404);
  }
  safetyMode="clear";
  const result=await upload(owner,event.id);
  await db.update(mediaItems).set({safetyPolicy:"old-policy"}).where(eq(mediaItems.id,result.data.id));
  assert.equal((await originalFetch(base+result.data.thumbnail)).status,404);
  await db.update(mediaItems).set({safetyPolicy:SAFETY_POLICY,contentVersion:1,safetyVersion:0}).where(eq(mediaItems.id,result.data.id));
  assert.equal((await originalFetch(base+result.data.thumbnail)).status,404);
  let ready;
  const arrived=new Promise(resolve=>{ready=resolve;});
  reachedSafety=ready;
  const pending=upload(owner,event.id,{mode:"hold"});
  await arrived;
  const published=await publish(owner,event.id);
  assert.equal(published.status,200); // Gallery may publish; pending photo cannot.
  const rows=await db.select().from(mediaItems).where(eq(mediaItems.eventId,event.id));
  const pendingItem=rows.at(-1);
  assert.equal(pendingItem.safetyStatus,"error");
  assert.equal((await originalFetch(base+pendingItem.thumbnail)).status,404);
  safetyMode="clear";releaseSafety();await pending;
  const unsafe=await upload(owner,event.id,{mode:"provider-error"});
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  await reviewMediaSafety(unsafe.data.id,owner.id);
  assert.equal((await storage.getMediaItem(unsafe.data.id)).safetyStatus,"error");
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY="synthetic-ai-key";
  delete process.env.RESEND_API_KEY;
  assert.equal((await publish(owner,event.id)).status,403);
  assert.equal((await request("/api/email-verification/send",{cookie:(await account({creator:true,verified:false})).cookie,method:"POST"})).status,503);
  process.env.RESEND_API_KEY="synthetic-mail-key";
});
test("exact decimal limits, atomic galleries, photos and references, shared-object accounting",async()=>{
  const owner=await account({creator:true});
  const outcomes=await Promise.all(Array.from({length:7},(_,i)=>request("/api/creator/events",{cookie:owner.cookie,method:"POST",body:{title:`Concurrent ${i}`,description:"Synthetic gallery",date:new Date()}})));
  assert.equal(outcomes.filter(r=>r.status===201).length,5);
  for (const result of outcomes.filter(r=>r.status===201)) eventIds.push(result.data.id);
  const event=outcomes.find(r=>r.status===201).data;
  const tooLarge=await upload(owner,event.id,{data:Buffer.alloc(5_000_001)});
  assert.equal(tooLarge.status,413);
  const video=await upload(owner,event.id,{mime:"video/mp4",type:"video",data:Buffer.from("000000186674797069736f6d0000020069736f6d6d703431","hex")});
  assert.equal(video.status,413);
  const image=await upload(owner,event.id);
  assert.equal(image.status,201);
  const raw=await db.select().from(mediaItems).where(eq(mediaItems.id,image.data.id));
  assert.equal((await creatorUsage(db,owner.id)).bytes,raw[0].highBytes+raw[0].lowBytes);
  // An immutable shared object is counted once even with two database records.
  await db.insert(mediaItems).values({...raw[0],id:undefined});
  assert.equal((await creatorUsage(db,owner.id)).bytes,raw[0].highBytes+raw[0].lowBytes);
  const key=`ref-${randomUUID()}.csv`;
  await db.insert(referenceDocuments).values({eventId:event.id,ownerId:owner.id,seasonYear:2026,scope:"event",kind:"entry",title:"Synthetic",sourceKey:key,fingerprint:randomUUID(),identityKey:randomUUID(),rows:[],storedBytes:100});
  assert.equal((await creatorUsage(db,owner.id)).bytes,raw[0].highBytes+raw[0].lowBytes+100);
  await db.update(referenceDocuments).set({storedBytes:500_000_000-(raw[0].highBytes+raw[0].lowBytes)-1}).where(eq(referenceDocuments.sourceKey,key));
  const reservations=await Promise.all([1,2].map(async()=>{
    try {
      return await db.transaction(async tx=>{
        await lockedCreatorBudget(tx,owner.id,1);
        const id=randomUUID();
        await tx.insert(mediaReservations).values({id,eventId:event.id,creatorId:owner.id,reservedBytes:1,storageKey:`ref-${id}.csv`,thumbnailKey:`ref-${id}.csv`});
        return true;
      });
    } catch {return false;}
  }));
  assert.deepEqual(reservations.sort(),[false,true]);
  assert.equal((await creatorUsage(db,owner.id)).bytes,500_000_000);
  await assert.rejects(db.transaction(tx=>lockedCreatorBudget(tx,owner.id,1)),/storage is full/);
  const usage=await request("/api/creator/usage",{cookie:owner.cookie});
  assert.equal(usage.data.limits.bytes,500_000_000);assert.equal(usage.data.limits.photos,1000);assert.equal(usage.data.galleries,5);
  await db.delete(mediaReservations).where(eq(mediaReservations.creatorId,owner.id));
  await db.update(referenceDocuments).set({storedBytes:0}).where(eq(referenceDocuments.sourceKey,key));
  await db.insert(mediaItems).values(Array.from({length:998},()=>({eventId:event.id,type:"image",url:image.data.url,thumbnail:image.data.thumbnail,tags:[],highBytes:raw[0].highBytes,lowBytes:raw[0].lowBytes})));
  assert.equal((await creatorUsage(db,owner.id)).photos,1000);
  await assert.rejects(db.transaction(tx=>lockedCreatorBudget(tx,owner.id,0,1)),/1,000 photos/);
});
test("rate buckets are durable/atomic and unchanged safety outcomes reuse provider work",async()=>{
  const key="beta-test-"+randomUUID();rateKeys.push(key);
  const results=await Promise.all(Array.from({length:5},()=>takeBetaRate(key,2,60000)));
  assert.equal(results.filter(Boolean).length,2);
  const text="Neutral reusable fixture "+randomUUID();
  const before=safetyCalls;
  assert.equal((await checkContent(text)).status,"approved");
  assert.equal((await checkContent(text)).status,"approved");
  assert.equal(safetyCalls-before,1);
});
test("verified status is required for new files in grandfathered galleries, without changing old premium rights",async()=>{
  const owner=await account({creator:true,verified:false}),admin=await account({admin:true});
  await db.update(users).set({isCreator:false,creatorStatus:"approved"}).where(eq(users.id,owner.id));
  const event=await gallery(owner);
  await db.update(events).set({visibility:"published",safetyStatus:"legacy"}).where(eq(events.id,event.id));
  const legacyId=randomUUID();
  const legacyKey=`media-${legacyId}.webp`,thumbKey=`thumb-${legacyId}.webp`;
  const bytes=await sharp({create:{width:16,height:16,channels:3,background:"blue"}}).webp().toBuffer();
  objects.set(legacyKey,bytes);objects.set(thumbKey,bytes);
  const [historical]=await db.insert(mediaItems).values({eventId:event.id,type:"image",url:`/api/media/files/${legacyKey}`,
    thumbnail:`/api/media/files/${thumbKey}`,highBytes:bytes.length,lowBytes:bytes.length,safetyStatus:"legacy",isPremium:true,creditCost:8}).returning();
  assert.equal((await request(`/api/events/${event.id}`)).status,200);
  assert.equal((await originalFetch(base+historical.url,{headers:{cookie:owner.cookie}})).status,403);
  const added=await upload(owner,event.id);
  assert.equal(added.data.safetyStatus,"approved");
  assert.equal((await request(`/api/media/${added.data.id}`)).status,404,"New approval does not bypass unverified owner");
  assert.equal((await originalFetch(base+added.data.thumbnail)).status,404);
  const publicResults=await request("/api/media");
  assert.equal(publicResults.data.some(m=>m.id===added.data.id),false);
  const userBefore=await storage.getUser(owner.id);
  await request(`/api/admin/users/${owner.id}`,{cookie:admin.cookie,method:"PATCH",body:{action:"quota_exception",enabled:true}});
  const usage=await request("/api/creator/usage",{cookie:owner.cookie});
  assert.equal(usage.status,200,"Approved creator without historical role flag remains authorized");
  assert.equal(usage.data.limits.bytes,1_000_000_000);
  assert.equal(usage.data.limits.imageBytes,5_000_000);
  assert.equal((await storage.getUser(owner.id)).credits,userBefore.credits);
  assert.equal((await storage.getMediaItem(historical.id)).isPremium,true);
  assert.equal((await request(`/api/admin/events/${event.id}/nextcloud`,{cookie:admin.cookie,method:"POST",body:{sources:[]}})).status,404);
});
test("real reference uploads count once, duplicate reuse adds nothing and replacement charges only unique delta",async()=>{
  const owner=await account({creator:true}),event=await gallery(owner);
  async function importRef(text,replaceId) {
    const form=new FormData();
    form.append("file",new Blob([text],{type:"text/csv"}),"lineup.csv");
    form.append("scope","event");form.append("kind","entry");form.append("title","Synthetic lineup");form.append("seasonYear","2026");
    if (replaceId) form.append("replaceId",String(replaceId));
    return request(`/api/events/${event.id}/references`,{cookie:owner.cookie,method:"POST",form});
  }
  const csv="Number,Team,Car,Drivers\n7,Neutral,GT3,Driver One\n";
  const first=await importRef(csv);
  assert.equal(first.status,201,JSON.stringify(first.data));
  const initialBytes=Buffer.byteLength(csv);
  assert.equal((await creatorUsage(db,owner.id)).bytes,initialBytes);
  const repeated=await importRef(csv);
  assert.equal(repeated.data.reused,true);assert.equal((await creatorUsage(db,owner.id)).bytes,initialBytes);
  const [doc]=await db.select().from(referenceDocuments).where(eq(referenceDocuments.id,first.data.id));
  // At the cap a same-size replacement consumes no additional durable bytes.
  const fillerKey=`ref-${randomUUID()}.csv`;
  await db.insert(referenceDocuments).values({...doc,id:undefined,title:"Synthetic filler",identityKey:randomUUID(),
    fingerprint:randomUUID(),sourceKey:fillerKey,storedBytes:500_000_000-initialBytes});
  const replaced=await importRef(csv.replace("One","Two"),first.data.id);
  assert.equal(replaced.status,201,JSON.stringify(replaced.data));
  await storage.cleanupObjects();
  assert.equal((await creatorUsage(db,owner.id)).bytes,500_000_000);
  assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.creatorId,owner.id))).length,0);
  assert.equal((await request(`/api/events/${event.id}/references/${first.data.id}/source`)).status,401);
  assert.equal((await request(`/api/events/${event.id}/references/${first.data.id}`,{cookie:owner.cookie,method:"DELETE"})).status,200);
  await storage.cleanupObjects();
  assert.equal((await creatorUsage(db,owner.id)).bytes,500_000_000-initialBytes);
});
test("photo file boundaries, animation rejection and interrupted upload cleanup are server enforced",async()=>{
  const owner=await account({creator:true}),event=await gallery(owner);
  const png=await sharp({create:{width:32,height:32,channels:3,background:"blue"}}).png().toBuffer();
  const exact=await upload(owner,event.id,{data:Buffer.concat([png,Buffer.alloc(5_000_000-png.length)])});
  assert.equal(exact.status,201,"The exact 5,000,000-byte boundary is accepted");
  const fakeAnimated=Buffer.concat([png,Buffer.from("acTL")]); // safe synthetic multi-frame marker
  assert.equal((await upload(owner,event.id,{data:fakeAnimated})).status,413);
  assert.equal((await upload(owner,event.id,{data:Buffer.from("not an image")})).status,400);
  assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.creatorId,owner.id))).length,0);
  const prior=Client.prototype.uploadFromFilename;
  Client.prototype.uploadFromFilename=async()=>({ok:false,error:{message:"Synthetic write failure"}});
  const failed=await upload(owner,event.id);
  Client.prototype.uploadFromFilename=prior;
  assert.equal(failed.status,502);
  await storage.cleanupObjects();
  assert.equal((await creatorUsage(db,owner.id)).photos,1);
  assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.creatorId,owner.id))).length,0);
});
test("failed physical cleanup retains bytes and one photo slot, preventing replacement-credit reuse",async()=>{
  safetyMode="clear";
  const owner=await account({creator:true}),event=await gallery(owner);
  const item=(await upload(owner,event.id)).data;
  const before=await creatorUsage(db,owner.id);
  const totals=await request("/api/creator/usage",{cookie:owner.cookie});
  assert.equal(totals.data.eventStats.find(row=>row.eventId===event.id).photos,1);
  const normalDelete=Client.prototype.delete;
  try {
    Client.prototype.delete=async()=>({ok:false,error:{message:"Synthetic cleanup failure"}});
    await storage.deleteMediaItem(item.id);
    await storage.cleanupObjects();
    const held=await creatorUsage(db,owner.id);
    assert.equal(held.bytes,before.bytes);
    assert.equal(held.photos,1);
    assert.ok(held.pendingCleanup>=2);
    await assert.rejects(db.transaction(tx=>lockedCreatorBudget(tx,owner.id,500_000_000)),/storage is full/i);
    await assert.rejects(db.transaction(tx=>lockedCreatorBudget(tx,owner.id,0,1000)),/1,000 photos/i);
    await assert.rejects(db.transaction(tx=>lockedCreatorBudget(tx,owner.id,0,0,0,500_000_000)),/storage is full/i);
    Client.prototype.delete=async function(key) {
      if (key.startsWith("thumb-")) return {ok:false,error:{message:"Synthetic thumbnail cleanup failure"}};
      return normalDelete.call(this,key);
    };
    await storage.cleanupObjects();
    const thumbnailHeld=await creatorUsage(db,owner.id);
    assert.equal(thumbnailHeld.bytes,item.lowBytes);
    assert.equal(thumbnailHeld.photos,1);
  } finally {Client.prototype.delete=normalDelete;}
  await storage.cleanupObjects();
  assert.equal((await creatorUsage(db,owner.id)).bytes,0);
  assert.equal((await creatorUsage(db,owner.id)).photos,0);
});
test("a newly stored private account avatar stays private through self activation and counts toward storage",async()=>{
  safetyMode="clear";
  const owner=await account();
  const picture=await sharp({create:{width:64,height:64,channels:3,background:"#15694e"}}).webp().toBuffer();
  await db.update(users).set({creatorStatus:null,profileImage:`data:image/webp;base64,${picture.toString("base64")}`}).where(eq(users.id,owner.id));
  assert.equal((await request(`/api/users/${owner.id}`)).status,404,"Ordinary accounts have no public creator profile before activation");
  assert.equal((await request("/api/creator/request",{cookie:owner.cookie,method:"POST",body:{}})).status,200);
  assert.equal((await request(`/api/users/${owner.id}`)).data.profileImage,null);
  assert.equal((await creatorUsage(db,owner.id)).bytes,picture.length);
  assert.ok((await storage.getUser(owner.id)).profileImage,"The stored image is preserved, not deleted");
});
test("unsupported frame sources cannot receive a manual bypass and missing safety configuration prevents new releases",async()=>{
  const owner=await account({creator:true}),admin=await account({admin:true});
  const event=await gallery(owner);
  const png=await sharp({create:{width:64,height:64,channels:3,background:"#15694e"}}).png().toBuffer();
  const source=`data:image/png;base64,${Buffer.concat([png,Buffer.from("acTL")]).toString("base64")}`;
  const [item]=await db.insert(mediaItems).values({type:"image",url:source,thumbnail:source,eventId:event.id,
    safetyStatus:"error",contentVersion:1}).returning();
  await reviewMediaSafety(item.id,owner.id);
  assert.equal((await storage.getMediaItem(item.id)).safetyStatus,"blocked");
  const decision={decision:"approve",reason:"Synthetic review of the displayed source",version:1,policy:SAFETY_POLICY};
  assert.equal((await request(`/api/admin/safety/media/${item.id}/review`,{cookie:admin.cookie,method:"POST",body:decision})).status,409);
  const uncertain=await upload(owner,event.id,{mode:"review"});
  const key=process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  try {
    assert.equal((await request(`/api/admin/safety/media/${uncertain.data.id}/review`,{cookie:admin.cookie,method:"POST",body:decision})).status,503);
    assert.equal((await request(`/api/events/${event.id}/publish`,{cookie:owner.cookie,method:"POST",body:{published:true}})).status,503);
  } finally {process.env.AI_INTEGRATIONS_OPENAI_API_KEY=key;}
});
test("exclusive shared queue rotates creators and preserves manual captions and tags",async()=>{
  const a=await account({creator:true}),b=await account({creator:true});
  const ea=await gallery(a),eb=await gallery(b);
  // All other disposable fixture jobs are removed from consideration. Refuse
  // to consume any unrelated queued/running work, rather than mock its provider.
  const other=await db.execute(sql`select count(*)::int as count from media_analysis_jobs j
    join media_items m on m.id=j.media_id join events e on e.id=m.event_id
    where j.status in ('queued','running') and (e.creator_id is null or e.creator_id not in (${sql.join(accountIds.map(id=>sql`${id}`),sql`, `)}))`);
  assert.equal(Number(other.rows[0].count),0,"Queue tests require an exclusive consumer");
  await db.execute(sql`update media_analysis_jobs set status='failed',worker_token=null
    where media_id in (select m.id from media_items m join events e on e.id=m.event_id
      where e.creator_id in (${sql.join(accountIds.map(id=>sql`${id}`),sql`, `)}))`);
  const items=[];
  for(let i=0;i<3;i++) items.push((await upload(a,ea.id,{caption:"Manual caption "+i})).data);
  const neighbor=(await upload(b,eb.id)).data;
  await db.update(mediaItems).set({tags:["manual"],manualTags:["manual"],caption:"Manual caption 0"}).where(eq(mediaItems.id,items[0].id));
  await Promise.all([drainAnalysisQueue(),drainAnalysisQueue()]);
  assert.equal((await analysisStatus(neighbor.id)).status,"completed","A neighbor is not delayed behind a creator's entire batch");
  assert.equal((await analysisStatus(items[0].id)).status,"completed");
  const saved=await storage.getMediaItem(items[0].id);
  assert.equal(saved.caption,"Manual caption 0");assert.ok(saved.tags.includes("manual"));
});
