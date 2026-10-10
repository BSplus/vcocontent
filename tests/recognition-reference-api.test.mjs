import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import express from "express";
import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { Client } from "@replit/object-storage";
import { db, pool } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import { users, events, series, mediaItems, mediaCleanup, mediaAnalysisJobs, referenceDocuments } from "../shared/schema.ts";
import { registerRoutes } from "../server/routes.ts";
import { analysisStatus, stopAnalysisWorker } from "../server/analysis-jobs.ts";
import { stopImportWorker } from "../server/nextcloud.ts";
import { matchReferences } from "../server/reference-matching.ts";

const realFetch = globalThis.fetch;
const previousAI = { base: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL, key: process.env.AI_INTEGRATIONS_OPENAI_API_KEY };
const objects = new Map();
const sourceKeys = new Set();
const originalStore = Client.prototype.uploadFromBytes;
const originalRead = Client.prototype.downloadAsStream;
const originalDelete = Client.prototype.delete;
const ownedEvents = [], ownedUsers = [], ownedSeries = [];
let server, base, owner, other, admin, providerCalls = 0, gate;
let providerResult = { tags: ["Day", "Race Car"], vehicles: [
  { number: "007", numberReadable: true, team: "", vehicle: "", manufacturer: "", racingClass: "", discipline: "" },
] };
const identity = { number: "007", team: "Manual team", drivers: "Manual driver", vehicle: "Manual car",
  manufacturer: "", racingClass: "", discipline: "", source: "manual" };
const csv = "Number,Team,Car,Drivers\n007,Apex,GT3,Ada One\n";
const image = `data:image/webp;base64,${(await sharp({ create: { width: 64, height: 64, channels: 3, background: "green" } }).webp().toBuffer()).toString("base64")}`;
const wait = async check => {
  for (let i = 0; i < 250; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Analysis did not settle");
};
async function api(path, role = "owner", body, method = body === undefined ? "GET" : "PUT") {
  return realFetch(base + path, { method, headers: {
    ...(role && { "x-fixture-role": role }), ...(body !== undefined && { "Content-Type": "application/json" }),
  }, ...(body !== undefined && { body: JSON.stringify(body) }) });
}
async function album(extra = {}) {
  const result = await storage.createEvent({ title: "Disposable reference API fixture", description: "Test only",
    date: new Date("2026-07-12"), creatorId: owner.id, isPremium: false, ...extra });
  ownedEvents.push(result.id); return result;
}
async function photo(eventId) {
  return storage.createMediaItem({ eventId, type: "image", url: image, thumbnail: image,
    caption: "Approved caption", tags: ["manual"], isPremium: false });
}
async function importFile(eventId, extra = {}, content = csv, role = "owner") {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/csv" }), "entries.csv");
  for (const [key, value] of Object.entries({ kind: "entry", scope: "event", seasonYear: "2026", session: "", ...extra })) form.append(key, String(value));
  return realFetch(`${base}/api/events/${eventId}/references`, {
    method: "POST", headers: role ? { "x-fixture-role": role } : {}, body: form,
  });
}
test.before(async () => {
  // Never consume unrelated queued jobs. Run serially with the preview stopped.
  const pending = await db.select().from(mediaAnalysisJobs);
  assert.equal(pending.some(job => ["queued", "running"].includes(job.status)), false, "Pause until existing analysis jobs finish before running isolated tests");
  for (const role of ["owner", "other", "admin"]) {
    const [user] = await db.insert(users).values({ username: `fixture-${randomUUID()}`,
      email: `${randomUUID()}@example.invalid`, password: "not-a-login-password",
      isCreator: role !== "admin", creatorStatus: "approved", isAdmin: role === "admin",
      quotaException:role==="owner" }).returning();
    ownedUsers.push(user.id);
    if (role === "owner") owner = user; else if (role === "other") other = user; else admin = user;
  }
  Client.prototype.uploadFromBytes = async function(key, bytes, ...args) {
    if (!/^(reference-|ref-)/.test(key)) return originalStore.call(this, key, bytes, ...args);
    sourceKeys.add(key); objects.set(key, Buffer.from(bytes)); return { ok: true, value: undefined };
  };
  Client.prototype.downloadAsStream = function(key, ...args) {
    if (!/^(reference-|ref-)/.test(key)) return originalRead.call(this, key, ...args);
    return Readable.from(objects.get(key) || []);
  };
  Client.prototype.delete = async function(key, ...args) {
    if (!/^(reference-|ref-)/.test(key)) return originalDelete.call(this, key, ...args);
    objects.delete(key); return { ok: true, value: undefined };
  };
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://recognition-test.example.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-only";
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://recognition-test.example.invalid/")) return realFetch(url, options);
    if (JSON.parse(options.body).messages[0]?.content?.includes("publication safety reviewer")) {
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        sexualized:"clear",pornography:"clear",racistOrDehumanizing:"clear",hateSymbolsOrGlorification:"clear",visibleTextAndSymbolsReviewed:true,
      })}}]}),{headers:{"Content-Type":"application/json"}});
    }
    providerCalls++;
    if (gate) await gate;
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(providerResult) }, finish_reason: "stop" }] }),
      { headers: { "Content-Type": "application/json" } });
  };
  const app = express();
  app.use(express.json());
  // This identity fixture exists only in this isolated test server.
  app.use((req, _res, next) => {
    req.user = { owner, other, admin }[req.headers["x-fixture-role"]];
    req.isAuthenticated = () => !!req.user; next();
  });
  server = await registerRoutes(app);
  await stopImportWorker(); await stopAnalysisWorker();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await stopImportWorker(); await stopAnalysisWorker();
  if (server?.listening) { server.close(); await once(server, "close"); }
  if (ownedEvents.length) {
    await db.delete(mediaItems).where(inArray(mediaItems.eventId, ownedEvents));
    await db.delete(events).where(inArray(events.id, ownedEvents));
  }
  if (ownedUsers.length) {
    await db.delete(referenceDocuments).where(inArray(referenceDocuments.ownerId, ownedUsers));
    if (ownedSeries.length) await db.delete(series).where(inArray(series.id, ownedSeries));
    await db.delete(users).where(inArray(users.id, ownedUsers));
  }
  if (sourceKeys.size) await db.delete(mediaCleanup).where(inArray(mediaCleanup.key, Array.from(sourceKeys)));
  globalThis.fetch = realFetch;
  Client.prototype.uploadFromBytes = originalStore; Client.prototype.downloadAsStream = originalRead; Client.prototype.delete = originalDelete;
  if (previousAI.base === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL; else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = previousAI.base;
  if (previousAI.key === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY; else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = previousAI.key;
  await pool.end();
});

test("caption/tag/identification edits persist with ownership and strict field validation", async () => {
  const event = await album(), item = await photo(event.id);
  const body = { caption: "Corrected caption", photographer: "Fixture photographer", tags: ["manual", "Day"],
    identification: [identity], recognitionSession: "Race 1" };
  assert.equal((await api(`/api/media/${item.id}`, null, body)).status, 401);
  assert.equal((await api(`/api/media/${item.id}`, "other", body)).status, 403);
  assert.equal((await api(`/api/media/${item.id}`, "owner", { ...body, eventId: 99 })).status, 400);
  assert.equal((await api(`/api/media/${item.id}`, "owner", { ...body, identification: [{ ...identity, number: "guess" }] })).status, 400);
  const saved = await api(`/api/media/${item.id}`, "owner", body);
  assert.equal(saved.status, 200);
  const row = await saved.json();
  assert.equal(row.caption, body.caption); assert.deepEqual(row.identification, [identity]);
  assert.equal(row.identificationManual, true); assert.equal(row.recognitionSession, "Race 1");
  const search = await api("/api/media?q=Manual%20team&fields=identification", null);
  assert.equal(search.status, 200);
  assert.ok(!(await search.json()).some(media => media.id === item.id),
    "Changed creator text remains private until its independent safety check succeeds");
  const captionOnly = await api("/api/media?q=Manual%20team&fields=caption", null);
  assert.equal(captionOnly.status, 200);
  assert.equal((await captionOnly.json()).some(media => media.id === item.id), false);
  assert.equal((await api("/api/media?q=Manual%20team&fields=not_a_field", null)).status, 400);
  assert.equal((await api(`/api/media/${item.id}`, "admin", { caption: "Admin caption" })).status, 200);
  assert.equal((await storage.getMediaItem(item.id)).caption, "Admin caption");
});
test("references support source download, atomic idempotent reimport, corrections and removal", async () => {
  const event = await album();
  assert.equal((await importFile(event.id, {}, csv, null)).status, 401);
  assert.equal((await importFile(event.id, {}, csv, "other")).status, 403);
  assert.equal((await importFile(event.id, { seasonYear: 1899 })).status, 400);
  const imported = await importFile(event.id); assert.equal(imported.status, 201);
  const importedBody = await imported.json();
  const doc = (await (await api(`/api/events/${event.id}/references`)).json()).documents.find(document => document.id === importedBody.id);
  const source = await api(doc.downloadUrl); assert.equal(source.status, 200); assert.equal(await source.text(), csv);
  assert.equal((await api(doc.downloadUrl, "other")).status, 403);
  const twice = await importFile(event.id, { replaceId: doc.id }); assert.ok([200, 201].includes(twice.status));
  const repeated = await twice.json();
  assert.equal(repeated.id, doc.id, "same-source reimport must not delete its own document");
  const replacement = await importFile(event.id, { replaceId: doc.id }, csv.replace("Apex", "Correct team"));
  assert.equal(replacement.status, 201);
  const replacementBody = await replacement.json();
  const current = (await (await api(`/api/events/${event.id}/references`)).json()).documents.find(document => document.id === replacementBody.id);
  const changes = { title: "Corrected reference", session: "Race 1", rows: [{ ...current.rows[0], drivers: "Corrected driver" }] };
  assert.equal((await api(`/api/events/${event.id}/references/${current.id}`, "other", changes, "PATCH")).status, 403);
  assert.equal((await api(`/api/events/${event.id}/references/${current.id}`, "owner", changes, "PATCH")).status, 200);
  const loaded = await (await api(`/api/events/${event.id}/references`)).json();
  assert.equal(loaded.documents.length, 1); assert.equal(loaded.documents[0].rows[0].drivers, "Corrected driver");
  assert.ok([200, 204].includes((await api(`/api/events/${event.id}/references/${current.id}`, "owner", undefined, "DELETE")).status));
  assert.equal((await api(current.downloadUrl)).status, 404);
  assert.equal((await (await api(`/api/events/${event.id}/references`)).json()).documents.length, 0);
  assert.ok((await storage.getEvent(event.id)).referenceRevision >= 4);
});
test("season sources inherit only within the same series, year and creator partition", async () => {
  const [championship] = await db.insert(series).values({ name: "Disposable championship", creatorId: owner.id }).returning();
  ownedSeries.push(championship.id);
  const first = await album({ seriesId: championship.id }), second = await album({ seriesId: championship.id });
  const foreign = await album({ seriesId: championship.id, creatorId: other.id });
  const nextYear = await album({ seriesId: championship.id, date: new Date("2027-07-12") });
  const imported = await importFile(first.id, { scope: "season" }); assert.equal(imported.status, 201);
  const importedBody = await imported.json();
  const doc = (await (await api(`/api/events/${first.id}/references`)).json()).documents.find(document => document.id === importedBody.id);
  assert.equal((await (await api(`/api/events/${second.id}/references`)).json()).documents.length, 1);
  assert.equal((await (await api(`/api/events/${foreign.id}/references`, "other")).json()).documents.length, 0);
  assert.equal((await (await api(`/api/events/${nextYear.id}/references`)).json()).documents.length, 0);
  assert.equal((await api(`/api/events/${foreign.id}/references/${doc.id}/source`, "other")).status, 404);
  assert.ok([200, 204].includes((await api(`/api/events/${second.id}/references/${doc.id}`, "owner", undefined, "DELETE")).status));
});
test("explicit reanalysis creates a new generation, rematches references and preserves concurrent manual edits", async () => {
  const event = await album(), item = await photo(event.id);
  await importFile(event.id);
  const path = `/api/media/${item.id}/analyze`;
  assert.equal((await api(path, "other", { reanalyse: true }, "POST")).status, 403);
  assert.equal((await api(path, "owner", { reanalyse: "yes" }, "POST")).status, 400);
  const before = providerCalls;
  assert.equal((await api(path, "owner", {}, "POST")).status, 202);
  await wait(async () => (await analysisStatus(item.id)).status === "completed");
  const initial = await (await api(`/api/media/${item.id}/analysis`)).json();
  assert.equal(initial.identification[0].drivers, "Ada One");
  assert.equal(initial.identification[0].source, "reference");
  assert.equal(initial.identificationManual, false);
  assert.equal(providerCalls, before + 1);
  assert.equal((await api(path, "owner", {}, "POST")).status, 202);
  assert.equal(providerCalls, before + 1, "ordinary request reuses the completed job");
  const [doc] = (await (await api(`/api/events/${event.id}/references`)).json()).documents;
  await api(`/api/events/${event.id}/references/${doc.id}`, "owner", { title: doc.title, session: null,
    rows: [{ ...doc.rows[0], drivers: "New reference driver" }] }, "PATCH");
  assert.equal((await api(path, "owner", { reanalyse: true }, "POST")).status, 202);
  await wait(async () => (await analysisStatus(item.id)).status === "completed");
  assert.equal((await storage.getMediaItem(item.id)).identification[0].drivers, "New reference driver");
  assert.equal((await analysisStatus(item.id)).generation, initial.generation + 1);
  let release;
  const beforeGatedAnalysis = providerCalls;
  gate = new Promise(resolve => { release = resolve; });
  try {
    await api(path, "owner", { reanalyse: true }, "POST");
    await wait(() => providerCalls === beforeGatedAnalysis + 1);
    const generation = (await analysisStatus(item.id)).generation;
    await api(path, "owner", { reanalyse: true }, "POST");
    assert.equal((await analysisStatus(item.id)).generation, generation, "active jobs are not replaced by repeated clicks");
    assert.equal((await api(`/api/media/${item.id}`, "owner", { caption: "Manual concurrent caption", tags: ["manual"],
      identification: [identity], recognitionSession: "Race 1" })).status, 200);
    release(); gate = undefined;
    await wait(async () => (await analysisStatus(item.id)).status === "completed");
    const saved = await storage.getMediaItem(item.id);
    assert.equal(saved.caption, "Manual concurrent caption"); assert.deepEqual(saved.identification, [identity]);
    assert.equal(saved.tags.includes("Day"), false, "explicitly removed generated tags must not reappear");
    assert.equal(saved.tags.includes("manual"), true);
  } finally { release(); gate = undefined; }
});
test("ambiguous numbers and unreadable/team-only observations never assign a driver", () => {
  const observed = { ...identity, source: "visual", drivers: "" };
  const rows = [{ number: "7", team: "Apex", car: "GT3", drivers: "Ada" }, { number: "007", team: "Other", car: "GT3", drivers: "Other" }];
  const docs = [{ scope: "event", kind: "entry", session: null, rows, updatedAt: new Date() }];
  assert.equal(matchReferences([observed], docs, null)[0].drivers, "");
  assert.equal(matchReferences([{ ...observed, number: "", team: "Apex" }], docs, null)[0].drivers, "");
});
