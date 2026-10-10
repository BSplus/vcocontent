import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { Client } from "@replit/object-storage";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import { registerRoutes } from "../server/routes.ts";
import { stopAnalysisWorker, analysisStatus, drainAnalysisQueue } from "../server/analysis-jobs.ts";
import { startImport, importStatus, stopImportWorker, drainImportQueue } from "../server/nextcloud.ts";
import { events, mediaItems, mediaAnalysisJobs, users } from "../shared/schema.ts";
import sharp from "sharp";

const actual = { fetch: globalThis.fetch, upload: Client.prototype.uploadFromFilename,
  bytes: Client.prototype.uploadFromBytes, read: Client.prototype.downloadAsStream, delete: Client.prototype.delete };
const previousBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL, previousKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const objects = new Map();
const albums = [], accounts = [];
let server, base, owner, outsider, admin, clip, temp, calls = 0, gate;
const until = async check => {
  for (let i = 0; i < 500; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 30)); }
  throw new Error("State did not settle");
};
const api = (path, role = "owner", body, method = body === undefined ? "GET" : "POST") =>
  actual.fetch(base + path, { method, headers: { ...(role && { "x-fixture-role": role }),
    ...(body && !(body instanceof FormData) && { "content-type": "application/json" }) },
    ...(body && { body: body instanceof FormData ? body : JSON.stringify(body) }) });
async function album() {
  const value = await storage.createEvent({ title: "Video ingestion fixture", description: "Disposable",
    date: new Date(), isPremium: false, creatorId: owner.id });
  albums.push(value.id); return value;
}
function upload(bytes, type = "video", extra = {}) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: type === "video" ? "video/mp4" : "image/png" }), type === "video" ? "clip.mp4" : "photo.png");
  form.append("type", type); form.append("caption", "Saved caption"); form.append("tags", '["manual"]');
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return form;
}
test.before(async () => {
  assert.equal((await db.select().from(mediaAnalysisJobs)).some(j => ["queued", "running"].includes(j.status)), false,
    "No competing requested analysis may be present");
  temp = await mkdtemp(path.join(tmpdir(), "video-ingestion-"));
  const filename = path.join(temp, "clip.mp4");
  await promisify(execFile)("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=red:size=160x90:rate=2:duration=2",
    "-threads", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", filename]);
  clip = await readFile(filename);
  for (const role of ["owner", "outsider", "admin"]) {
    const [user] = await db.insert(users).values({ username: `video-${randomUUID()}`,
      email: `${randomUUID()}@example.invalid`, password: "not-a-login-password",
      isCreator: true, creatorStatus: "approved", isAdmin: role === "admin" }).returning();
    accounts.push(user.id); if (role === "owner") owner = user; else if (role === "outsider") outsider = user; else admin = user;
  }
  Client.prototype.uploadFromFilename = async (key, filename) => { objects.set(key, await readFile(filename)); return { ok: true }; };
  Client.prototype.uploadFromBytes = async (key, bytes) => { objects.set(key, Buffer.from(bytes)); return { ok: true }; };
  Client.prototype.downloadAsStream = key => Readable.from([objects.get(key) || Buffer.alloc(0)]);
  Client.prototype.delete = async key => { objects.delete(key); return { ok: true }; };
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://video-ingestion.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-only";
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://video-ingestion.invalid/")) {
      calls++; if (gate) await gate;
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        frames: [{ index: 0, tags: ["Day", "Race Car"], vehicles: [] }],
      }) } }], usage: { prompt_tokens: 80, completion_tokens: 20 } }),
      { headers: { "content-type": "application/json" } });
    }
    if (String(url).startsWith("https://nextcloud.bs-plus.de/public.php/dav/files/VIDEO_TEST/")) {
      if (options.method === "PROPFIND") return new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response>
        <d:href>/public.php/dav/files/VIDEO_TEST/clip.mp4</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status>
        <d:prop><d:resourcetype/><d:getcontentlength>${clip.length}</d:getcontentlength></d:prop></d:propstat>
        </d:response></d:multistatus>`, { status: 207 });
      return new Response(clip, { headers: { "content-length": String(clip.length) } });
    }
    return actual.fetch(url, options);
  };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { owner, outsider, admin }[req.headers["x-fixture-role"]];
    req.isAuthenticated = () => !!req.user; next();
  });
  server = await registerRoutes(app); await stopImportWorker(); await stopAnalysisWorker();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await stopImportWorker(); await stopAnalysisWorker();
  server?.close(); if (server) await once(server, "close");
  for (const id of albums) await storage.deleteEvent(id);
  await storage.cleanupObjects();
  for (const id of accounts) await db.delete(users).where(eq(users.id, id));
  Client.prototype.uploadFromFilename = actual.upload; Client.prototype.uploadFromBytes = actual.bytes;
  Client.prototype.downloadAsStream = actual.read; Client.prototype.delete = actual.delete; globalThis.fetch = actual.fetch;
  for (const [key, value] of [["AI_INTEGRATIONS_OPENAI_BASE_URL", previousBase], ["AI_INTEGRATIONS_OPENAI_API_KEY", previousKey]])
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  await pool.end(); await rm(temp, { recursive: true, force: true });
});
test("video upload saves promptly before AI, permissions apply to status/retry/batch, images stay opt-in", async () => {
  const event = await album();
  assert.equal((await api(`/api/events/${event.id}/media/upload`, null, upload(clip))).status, 401);
  assert.equal((await api(`/api/events/${event.id}/media/upload`, "outsider", upload(clip))).status, 403);
  let release; gate = new Promise(r => { release = r; });
  const response = await api(`/api/events/${event.id}/media/upload`, "owner", upload(clip, "video", { autoTag: "false" }));
  assert.equal(response.status, 201);
  const saved = await response.json();
  assert.deepEqual(objects.get(saved.url.split("/").at(-1)), clip, "original unchanged");
  await until(() => calls === 1);
  assert.equal((await api(`/api/media/${saved.id}/analysis`, "outsider")).status, 403);
  assert.equal((await api(`/api/media/${saved.id}/analyze`, "outsider", { retry: true })).status, 403);
  const batchDenied = await (await api("/api/media/batch-analyze", "outsider", { mediaIds: [saved.id] })).json();
  assert.equal(batchDenied.errors[0].error, "Forbidden");
  assert.equal((await api(`/api/media/${saved.id}/analyze`, "admin", {})).status, 202);
  assert.equal(calls, 1);
  release(); gate = null;
  await until(async () => (await analysisStatus(saved.id)).status === "completed");
  const status = await (await api(`/api/media/${saved.id}/analysis`)).json();
  assert.deepEqual(status.tags.sort(), ["Day", "Race Car", "manual"].sort());
  const photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).png().toBuffer();
  const image = await (await api(`/api/events/${event.id}/media/upload`, "owner", upload(photo, "image"))).json();
  assert.equal((await analysisStatus(image.id)).status, "not_requested");
  const batch = await (await api("/api/media/batch-analyze", "owner", { mediaIds: [saved.id] })).json();
  assert.equal(batch.results[0].status, "completed"); assert.equal(calls, 1);
});
test("unavailable provider isolates analysis failure; retry resumes without losing the saved video", async () => {
  const event = await album(); const before = calls;
  delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const response = await api(`/api/events/${event.id}/media/upload`, "owner", upload(clip));
  assert.equal(response.status, 201); const media = await response.json();
  assert.equal((await analysisStatus(media.id)).status, "failed");
  assert.equal(calls, before); assert.deepEqual(objects.get(media.url.split("/").at(-1)), clip);
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://video-ingestion.invalid/v1";
  assert.equal((await api(`/api/media/${media.id}/analyze`, "owner", { retry: true })).status, 202);
  await until(async () => (await analysisStatus(media.id)).status === "completed");
  const unrequested = await storage.createMediaItem({ eventId: event.id, type: "video", url: media.url,
    thumbnail: media.thumbnail, caption: "Old video", tags: [], isPremium: false });
  await drainAnalysisQueue();
  assert.equal((await analysisStatus(unrequested.id)).status, "not_requested");
});
test("new Nextcloud video imports commit a video analysis request with the media", async () => {
  // Existing import behavior always opts newly saved media into analysis.
  const event = await album();
  await startImport(event.id, [{ link: "https://nextcloud.bs-plus.de/s/VIDEO_TEST" }]);
  await until(async () => (await importStatus(event.id)).status === "completed");
  const media = await storage.getMediaItems(event.id);
  assert.equal(media.length, 1); assert.equal(media[0].type, "video");
  assert.deepEqual(objects.get(media[0].url.split("/").at(-1)), clip);
  await until(async () => {
    await drainAnalysisQueue();
    return (await analysisStatus(media[0].id)).status === "completed";
  });
  await drainImportQueue(); assert.equal((await storage.getMediaItems(event.id)).length, 1);
});
test("a full analysis queue cannot discard a successful upload", async () => {
  const event = await album();
  const pending = await db.insert(mediaItems).values(Array.from({ length: 1000 }, () => ({
    eventId: event.id, type: "video", url: "/fixture/unrequested", thumbnail: "/fixture/poster", tags: [],
  }))).returning({ id: mediaItems.id });
  await db.insert(mediaAnalysisJobs).values(pending.map(item => ({
    mediaId: item.id, fingerprint: "fixture", status: "queued", availableAt: new Date(Date.now() + 3600000),
  })));
  try {
    const response = await api(`/api/events/${event.id}/media/upload`, "owner", upload(clip));
    // Existing event-count limits require this fixture to use another event.
    assert.equal(response.status, 413);
    const target = await album();
    const savedResponse = await api(`/api/events/${target.id}/media/upload`, "owner", upload(clip));
    assert.equal(savedResponse.status, 201);
    const media = await savedResponse.json();
    assert.equal((await analysisStatus(media.id)).status, "failed");
    assert.deepEqual(objects.get(media.url.split("/").at(-1)), clip);
    assert.equal((await api(`/api/media/${media.id}/analyze`, "owner", { retry: true })).status, 503);
  } finally {
    await db.delete(mediaItems).where(eq(mediaItems.eventId, event.id));
  }
});
