// Opt-in, serial development-only live pilot. Never part of automated validation.
// Originals stay on disk; disposable private media rows exercise the real worker.
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Client } from "@replit/object-storage";
import { db, pool } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import { events, mediaAnalysisJobs } from "../shared/schema.ts";
import { mediaPolicy } from "../server/media-policy.ts";
import { enqueueAnalysis, stopAnalysisWorker } from "../server/analysis-jobs.ts";
import { TAG_MODEL } from "../server/utils/ai-tagger.ts";

if (!process.argv.includes("--authorized-live"))
  throw new Error("Requires explicit operator authorization and --authorized-live; sends sampled images to managed AI.");
if (process.env.NODE_ENV === "production") throw new Error("This pilot is development-only.");
const output = "generated-artifacts/video-review/live-results.json";
const created = [];
const originals = new Map();
const originalReader = Client.prototype.downloadAsStream;
const results = [];
await mkdir("generated-artifacts/video-review", { recursive: true });
// Refuse accidental repeated billing; remove/rename results only after reviewing them.
assert.equal(await stat(output).catch(() => null), null, "Live results already exist; do not repeat calls silently.");
const save = () => writeFile(output, JSON.stringify({
  date: new Date().toISOString(), model: TAG_MODEL, provider: "existing managed OpenAI",
  editorialStatus: "unreviewed", validatedAccuracy: null, billingCost: null,
  referenceScope: "None: no verified clip/event/season association; no global number matching",
  method: "Real production queue with local original reader; saved database values exported before disposable fixture cleanup",
  results,
}, null, 2));
try {
  await stopAnalysisWorker();
  const pending = await db.execute(sql`select count(*)::int as count from media_analysis_jobs where status in ('queued','running')`);
  assert.equal(Number(pending.rows[0].count), 0, "Requires an idle development queue and stopped preview worker.");
  Client.prototype.downloadAsStream = function(key, ...args) {
    if (originals.has(key)) return createReadStream(originals.get(key));
    return originalReader.call(this, key, ...args);
  };
  for (const file of (await readdir("attached_assets")).filter(f => /1791615863.*\.(mp4|mov)$/.test(f)).sort()) {
    const bytes = (await stat(`attached_assets/${file}`)).size;
    if (bytes > mediaPolicy.videoBytes) {
      results.push({ file, bytes, status: "excluded", reason: "Exceeds unchanged video byte policy" });
      await save();
      continue;
    }
    const event = await storage.createEvent({ title: "Disposable authorized video pilot", description: "Unscoped provisional results",
      date: new Date(), isPremium: true });
    created.push(event.id);
    const key = `media-${randomUUID()}.${file.split(".").pop()}`;
    originals.set(key, `attached_assets/${file}`);
    const item = await storage.createMediaItem({ eventId: event.id, type: "video",
      url: `/api/media/files/${key}`, thumbnail: "generic-poster", caption: "",
      tags: [], isPremium: true });
    await enqueueAnalysis(item);
    const started = Date.now();
    let job;
    while (Date.now() - started < 180000) {
      [job] = await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id));
      if (["completed", "failed"].includes(job?.status)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const saved = await storage.getMediaItem(item.id);
    results.push({ file, bytes, status: job?.status || "unknown", attempts: job?.attempts,
      elapsedMs: Date.now() - started, tags: saved.tags, identification: saved.identification,
      rawRecognition: job?.recognition, evidence: job?.videoEvidence, caption: saved.caption,
      referenceScope: "None; no reference documents attached; registered drivers intentionally unresolved",
      editorialReview: { tags: "pending", identifications: "pending" } });
    await save();
    console.log(JSON.stringify({ file, status: job?.status, frames: job?.videoEvidence?.analyzedFrames,
      requests: job?.videoEvidence?.providerRequests, tags: saved.tags, identification: saved.identification }));
    assert.equal(job?.status, "completed", "Live pilot did not complete; partial evidence exported, no hidden retry loop.");
    assert.equal(saved.caption, "", "Pilot must not generate captions automatically.");
    assert.ok(saved.identification.every(v => !v.drivers), "Unscoped pilot must not infer drivers.");
  }
} finally {
  await stopAnalysisWorker();
  Client.prototype.downloadAsStream = originalReader;
  for (const id of created) await db.delete(events).where(eq(events.id, id));
  await pool.end();
}
