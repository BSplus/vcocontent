import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import { mediaAnalysisJobs, mediaItems, referenceDocuments, events as eventsTable, nextcloudJobs, nextcloudFiles, users } from "../shared/schema.ts";
import { enqueueAnalysis, analysisStatus, drainAnalysisQueue, stopAnalysisWorker, analysisFingerprint } from "../server/analysis-jobs.ts";
import { startImport, importStatus, drainImportQueue, stopImportWorker, resumeImport } from "../server/nextcloud.ts";
import { encryptManifest, decryptManifest } from "../server/import-manifest.ts";
import { withVisionBudget, VisionBusy } from "../server/ai-budget.ts";
import { registerRoutes } from "../server/routes.ts";
import { Client } from "@replit/object-storage";
import { Readable } from "node:stream";
import { withMediaWorkBudget, MediaBusyError } from "../server/media-work-budget.ts";

const realFetch = globalThis.fetch;
const previous = { base: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL, key: process.env.AI_INTEGRATIONS_OPENAI_API_KEY };
const events = [];
const image = `data:image/webp;base64,${(await sharp({ create: {
  width: 16, height: 16, channels: 3, background: "green",
} }).webp().toBuffer()).toString("base64")}`;
async function event() {
  const result = await storage.createEvent({ title: "Temporary process test", description: "Disposable test fixture", date: new Date(), isPremium: false });
  events.push(result.id); return result;
}
async function photo(eventId, extra = {}) {
  return storage.createMediaItem({ eventId, type: "image", url: image, thumbnail: image, caption: "Approved caption", tags: ["manual"], isPremium: false, ...extra });
}
const until = async (check, message = "State did not settle") => {
  for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 20)); }
  throw new Error(message);
};
function mockAI(work = async () => {}) {
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://queue-test.example.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-only";
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://queue-test.example.invalid/")) return realFetch(url, options);
    await work();
    const structured = String(options?.body || "").includes("classReadable");
    return new Response(JSON.stringify({ id: "test", object: "chat.completion", created: 0, model: "gpt-4.1-mini",
      choices: [{ index: 0, message: { role: "assistant", content: structured ? JSON.stringify({tags:["Day","Front View"],vehicles:[]}) : "Day, Front View" }, finish_reason: "stop" }] }),
      { headers: { "content-type": "application/json" } });
  };
}
test.after(async () => {
  await stopImportWorker(); await stopAnalysisWorker(); globalThis.fetch = realFetch;
  if (previous.base === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = previous.base;
  if (previous.key === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = previous.key;
  for (const id of events) await storage.deleteEvent(id);
  await storage.cleanupObjects();
  await pool.end();
});

test("import manifest is encrypted and authenticated", () => {
  const value = { auth: "test-private-value", files: ["test-file"] };
  const encoded = encryptManifest(value);
  assert.ok(!encoded.includes(value.auth));
  assert.deepEqual(decryptManifest(encoded), value);
  const parts = encoded.split("."); parts[2] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptManifest(parts.join(".")));
});

test("conversion budget admits two active and eight waiting files without extra buffering", async () => {
  let release, active = 0, peak = 0;
  const gate = new Promise(r => { release = r; });
  const admitted = Array.from({ length: 10 }, () => withMediaWorkBudget(async () => {
    active++; peak = Math.max(active, peak); await gate; active--;
  }));
  try { await assert.rejects(withMediaWorkBudget(async () => {}), MediaBusyError); }
  finally { release(); await Promise.all(admitted); }
  assert.equal(peak, 2);
});

test("shared vision budget bounds on-demand work across connections", async () => {
  let release; const gate = new Promise(r => { release = r; });
  let active = 0;
  const held = [withVisionBudget(async () => { active++; await gate; }),
    withVisionBudget(async () => { active++; await gate; })];
  try {
    await until(() => active === 2);
    await assert.rejects(withVisionBudget(async () => {}), VisionBusy);
  } finally { release(); await Promise.all(held); }
  await withVisionBudget(async () => {});
});

test("analysis is idempotent, preserves concurrent manual edits and approved captions", async () => {
  const album = await event(); const item = await photo(album.id);
  let calls = 0, release;
  const gate = new Promise(r => { release = r; });
  mockAI(async () => { calls++; await gate; });
  await enqueueAnalysis(item);
  await until(() => calls === 1);
  await enqueueAnalysis(item);
  await storage.updateMediaItem(item.id, { tags: ["manual edited during analysis"] });
  release();
  await until(async () => (await analysisStatus(item.id)).status === "completed");
  const saved = await storage.getMediaItem(item.id);
  assert.ok(saved.tags.includes("manual edited during analysis"));
  assert.ok(saved.tags.includes("Day"));
  assert.equal(saved.caption, "Approved caption");
  await enqueueAnalysis(saved);
  assert.equal(calls, 1, "completed results must be reused without another provider call");
});

test("expired analysis lease recovers and the global active cap remains two", async () => {
  const album = await event();
  let active = 0, peak = 0, calls = 0;
  mockAI(async () => { calls++; active++; peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 100)); active--; });
  const items = await Promise.all(Array.from({ length: 5 }, () => photo(album.id)));
  await db.insert(mediaAnalysisJobs).values({ mediaId: items[0].id, fingerprint: "old",
    status: "running", attempts: 1, workerToken: "terminated-worker", updatedAt: new Date(Date.now() - 120000) });
  await drainAnalysisQueue();
  assert.equal((await analysisStatus(items[0].id)).status, "completed");
  await Promise.all(items.slice(1).map(item => enqueueAnalysis(item)));
  await until(async () => {
    await Promise.all([drainAnalysisQueue(), drainAnalysisQueue()]);
    return (await Promise.all(items.map(item => analysisStatus(item.id)))).every(j => j.status === "completed");
  });
  assert.ok(peak <= 2); assert.equal(calls, 5);
});
test("reference corrections reuse persisted observations without provider calls or changing manual metadata", async()=>{
  let providerCalls=0;
  mockAI(async()=>{providerCalls++;});
  const media=await photo((await event()).id);
  const observation={number:"89",team:"",drivers:"",vehicle:"Race Car",manufacturer:"",racingClass:"",discipline:"",source:"visual"};
  await db.insert(mediaAnalysisJobs).values({mediaId:media.id,fingerprint:analysisFingerprint(media.thumbnail),
    status:"completed",generatedTags:["Day"],recognition:[observation],referenceRevision:0});
  await db.insert(referenceDocuments).values({eventId:media.eventId,ownerId:null,seasonYear:2026,scope:"event",kind:"entry",
    title:"local-reference",fingerprint:randomUUID(),identityKey:randomUUID(),
    rows:[{number:"89",team:"Reference Team",car:"Stock Car",drivers:"Listed A, Listed B"}]});
  await db.update(eventsTable).set({referenceRevision:1}).where(eq(eventsTable.id,media.eventId));
  const before=providerCalls;
  assert.equal((await analysisStatus(media.id)).status,"queued","stale references must keep the UI polling");
  await drainAnalysisQueue();
  assert.equal(providerCalls,before);
  let saved=await storage.getMediaItem(media.id);
  assert.equal(saved.identification[0].drivers,"Listed A, Listed B");
  assert.equal(saved.caption,"Approved caption");
  await db.update(mediaItems).set({identification:[{...saved.identification[0],drivers:"Editorial correction",source:"manual"}],
    identificationManual:true,suppressedAITags:["Day"]}).where(eq(mediaItems.id,media.id));
  await db.update(eventsTable).set({referenceRevision:2}).where(eq(eventsTable.id,media.eventId));
  await drainAnalysisQueue();
  saved=await storage.getMediaItem(media.id);
  assert.equal(saved.identification[0].drivers,"Editorial correction");assert.equal(providerCalls,before);
  await enqueueAnalysis(saved,false,true);
  await db.update(mediaAnalysisJobs).set({attempts:2,availableAt:new Date()}).where(eq(mediaAnalysisJobs.mediaId,media.id));
  mockAI(async()=>{providerCalls++;throw new Error("Controlled provider failure");});await drainAnalysisQueue();
  assert.equal((await analysisStatus(media.id)).status,"failed");
  assert.deepEqual((await storage.getMediaItem(media.id)).identification,saved.identification);
  const [job]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,media.id));
  assert.deepEqual(job.recognition,[observation]);
  mockAI();
});

test("terminal provider errors are sanitized, bounded and individually retryable", async () => {
  const album = await event(); const item = await photo(album.id);
  const saved = await photo(album.id);
  await db.insert(mediaAnalysisJobs).values({ mediaId: item.id, fingerprint: "retry-test",
    status: "queued", attempts: 2 });
  globalThis.fetch = async (url, options) => String(url).startsWith("https://queue-test.example.invalid/")
    ? new Response(JSON.stringify({ error: { message: "private-provider-body" } }), { status: 500, headers: { "content-type": "application/json" } })
    : realFetch(url, options);
  await drainAnalysisQueue();
  const status = await analysisStatus(item.id);
  assert.equal(status.status, "failed"); assert.equal(status.attempts, 3);
  assert.ok(!JSON.stringify(status).includes("private-provider-body"));
  assert.equal((await storage.getMediaItem(item.id)).caption, "Approved caption");
  mockAI();
  await enqueueAnalysis(await storage.getMediaItem(item.id), true);
  await until(async () => (await analysisStatus(item.id)).status === "completed");
  assert.equal((await analysisStatus(saved.id)).status, "not_requested");
});

test("recovered import skips saved media and clears its encrypted credentials", async () => {
  const album = await event(); const item = await photo(album.id);
  await enqueueAnalysis(item);
  await until(async () => (await analysisStatus(item.id)).status === "completed");
  const href = "https://cloud.example.invalid/public.php/dav/files/test/one.jpg";
  const { createHash } = await import("node:crypto");
  await db.insert(nextcloudFiles).values({ eventId: album.id, sourceKey: createHash("sha256").update(href).digest("hex"),
    name: "one.jpg", status: "saved", mediaId: item.id });
  await db.insert(nextcloudJobs).values({ eventId: album.id, status: "running",
    workerToken: "terminated-import", updatedAt: new Date(Date.now() - 120000),
    manifestExpiresAt: new Date(Date.now() + 3600000),
    manifest: encryptManifest({ sources: [{ base: "https://cloud.example.invalid/",
      root: "https://cloud.example.invalid/public.php/dav/files/test/", auth: "Basic test" }],
      files: [{ href, name: "one.jpg", bytes: 100, mime: "image/jpeg", type: "image" }] }),
  });
  let downloads = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://cloud.example.invalid")) { downloads++; throw new Error("Must not download saved media"); }
    return realFetch(url, options);
  };
  await drainImportQueue();
  assert.equal((await importStatus(album.id)).status, "completed");
  const [job] = await db.select().from(nextcloudJobs).where(eq(nextcloudJobs.eventId, album.id));
  assert.equal(job.manifest, null); assert.equal(downloads, 0);
  assert.equal((await storage.getMediaItem(item.id)).id, item.id);
  await assert.rejects(resumeImport(album.id));
});

test("native download reauthorizes access, counts delivery atomically and not authorization", async () => {
  const album = await event(); const item = await photo(album.id);
  const app = express();
  // Identity fixture for this isolated test server, never application auth.
  app.use((req, _res, next) => {
    req.isAuthenticated = () => req.headers["x-test-identity"] === "admin";
    req.user = req.isAuthenticated() ? { id: 1, isAdmin: true } : undefined; next();
  });
  const server = await registerRoutes(app); await stopImportWorker(); await stopAnalysisWorker();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await realFetch(`${base}/api/media/${item.id}/download?quality=high`)).status, 401);
    assert.equal((await realFetch(`${base}/api/media/${item.id}/download?quality=low`, { method: "POST" })).status, 200);
    assert.equal((await storage.getMediaItem(item.id)).downloadCount, 0);
    const response = await realFetch(`${base}/api/media/${item.id}/download?quality=low`);
    assert.match(response.headers.get("content-disposition"), /attachment; filename="media-\d+-low.webp"/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.ok((await response.arrayBuffer()).byteLength > 0);
    await until(async () => (await storage.getMediaItem(item.id)).downloadCount === 1);
    await Promise.all(Array.from({ length: 3 }, async () => {
      const result = await realFetch(`${base}/api/media/${item.id}/download?quality=high`, { headers: { "x-test-identity": "admin" } });
      assert.equal(result.status, 200); await result.arrayBuffer();
    }));
    await until(async () => (await storage.getMediaItem(item.id)).downloadCount === 4);
    assert.equal((await realFetch(`${base}/api/media/${item.id}/download?quality=invalid`)).status, 400);
    assert.equal((await realFetch(`${base}/api/media/${item.id}/analysis`)).status, 401);
  } finally { server.close(); await once(server, "close"); }
});

test("aborted streamed originals are destroyed and never counted", async () => {
  const album = await event();
  const item = await storage.createMediaItem({ eventId: album.id, type: "video",
    url: `/api/media/files/media-${randomUUID()}.mp4`, thumbnail: image,
    caption: "Disposable stream fixture", tags: [], isPremium: false });
  const original = Client.prototype.downloadAsStream;
  let stream;
  Client.prototype.downloadAsStream = () => {
    stream = Readable.from((async function* () {
      for (let i = 0; i < 200; i++) { await new Promise(r => setTimeout(r, 10)); yield Buffer.alloc(65536); }
    })());
    return stream;
  };
  const app = express();
  app.use((req, _res, next) => { req.isAuthenticated = () => true; req.user = { id: 1, isAdmin: true }; next(); });
  const server = await registerRoutes(app); await stopImportWorker(); await stopAnalysisWorker();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const response = await realFetch(`http://127.0.0.1:${server.address().port}/api/media/${item.id}/download`);
    assert.equal(response.status, 200);
    const reader = response.body.getReader(); await reader.read(); await reader.cancel();
    await until(() => stream.destroyed);
    assert.equal((await storage.getMediaItem(item.id)).downloadCount, 0);
  } finally { Client.prototype.downloadAsStream = original; server.close(); await once(server, "close"); }
});
