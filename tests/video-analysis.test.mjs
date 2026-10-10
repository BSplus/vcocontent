import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm, readdir, mkdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { Client } from "@replit/object-storage";
import { db, pool } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import { mediaAnalysisJobs, events, referenceDocuments } from "../shared/schema.ts";
import { frameTarget, sampleVideo, cleanupVideoTemps, videoTool } from "../server/video-sampling.ts";
import { mediaPolicy } from "../server/media-policy.ts";
import { aggregateVideo, recognizeVideoBatch } from "../server/video-recognition.ts";
import { enqueueAnalysis, analysisStatus, drainAnalysisQueue, stopAnalysisWorker, itemAnalysisFingerprint, setAnalysisQueueTestScope } from "../server/analysis-jobs.ts";
import sharp from "sharp";

const execute = promisify(execFile);
const directory = await mkdtemp(path.join(tmpdir(), "video-test-"));
const albums = [];
const ownedMediaIds = [];
const realFetch = globalThis.fetch;
const originalReader = Client.prototype.downloadAsStream;
const previousBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const previousKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
let videoBytes;
let requests = 0;
const metrics = [];
const url = () => `/api/media/files/media-${randomUUID()}.mp4`;
const observation = (number, extra = {}) => ({ number, team: "", drivers: "", vehicle: "",
  manufacturer: "", racingClass: "", discipline: "", source: "visual", ...extra });
const until = async check => {
  for (let i = 0; i < 600; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 30)); }
  throw new Error("Video job did not settle");
};
async function clip(duration, kind = "testsrc2", extension = "mp4") {
  const filename = path.join(directory, `${randomUUID()}.${extension}`);
  await execute("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
    kind === "static" ? `color=red:size=320x180:rate=1:duration=${duration}` :
      `testsrc2=size=320x180:rate=1:duration=${duration},hue=h=t*37`,
    "-threads", "1", "-c:v", extension === "webm" ? "libvpx-vp9" : "libx264",
    "-pix_fmt", "yuv420p", "-y", filename], { timeout: 20000 });
  return readFile(filename);
}
function mockProvider(work = async () => {}) {
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://video-test.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-only";
  globalThis.fetch = async (input, options) => {
    if (!String(input).startsWith("https://video-test.invalid/")) return realFetch(input, options);
    requests++;
    const request = JSON.parse(options.body);
    const frames = request.messages[1].content.filter(c => c.type === "image_url");
    assert.ok(frames.length >= 1 && frames.length <= 4);
    assert.ok(frames.every(f => f.image_url.url.startsWith("data:image/jpeg;base64,")));
    assert.ok(request.max_tokens <= 2400);
    await work(request);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      frames: frames.map((_, index) => ({ index, tags: ["Day", "Race Car", "Front View"], vehicles: [
        { number: index % 2 ? "90" : "089", numberReadable: true, classReadable: false, racingClass: "GT3" },
        { number: "8?", numberReadable: false },
      ] })),
    }) } }], usage: { prompt_tokens: 200, completion_tokens: 100 } }),
    { headers: { "content-type": "application/json" } });
  };
}
async function media() {
  const album = await storage.createEvent({ title: "Disposable video test", description: "Synthetic clip",
    date: new Date(), isPremium: false });
  albums.push(album.id);
  const item=await storage.createMediaItem({ eventId: album.id, type: "video", url: url(), thumbnail: "generic-poster",
    caption: "Approved caption", tags: ["manual"], isPremium: false });
  ownedMediaIds.push(item.id);
  setAnalysisQueueTestScope([],ownedMediaIds);
  return item;
}
test.before(() => {
  setAnalysisQueueTestScope([]);
  Client.prototype.downloadAsStream = () => Readable.from([videoBytes]);
  mockProvider();
});
test.after(async () => {
  await stopAnalysisWorker();
  globalThis.fetch = realFetch; Client.prototype.downloadAsStream = originalReader;
  for (const [key, value] of [["AI_INTEGRATIONS_OPENAI_BASE_URL", previousBase], ["AI_INTEGRATIONS_OPENAI_API_KEY", previousKey]])
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  for (const id of albums) await db.delete(events).where(eq(events.id, id));
  await pool.end();
  await rm(directory, { recursive: true, force: true });
  console.log("VIDEO_VALIDATION", JSON.stringify({ clips: metrics, liveRecognition: "unavailable: no authorized reviewed video set",
    billingCost: "unavailable", provider: "mocked managed OpenAI transport" }));
});

test("duration bands have hard frame ceilings", () => {
  assert.equal(frameTarget(0.5), 3); assert.equal(frameTarget(30), 5);
  assert.equal(frameTarget(31), 8); assert.equal(frameTarget(180), 8);
  assert.equal(frameTarget(181), 12); assert.equal(frameTarget(21600), 12);
});
test("real static/very-short/short/medium/long MP4 and WebM clips decode with bounded unique frames", { timeout: 90000 }, async () => {
  for (const [duration, kind, extension] of [[1, "static", "mp4"], [1, "static", "mov"], [12, "static", "mp4"],
    [20, "testsrc2", "mp4"], [60, "testsrc2", "webm"], [181, "testsrc2", "mp4"]]) {
    const bytes = await clip(duration, kind, extension);
    await sampleVideo({ url: url().replace(/mp4$/, extension) }, async result => {
      assert.equal(result.sourceHash, createHash("sha256").update(bytes).digest("hex"));
      assert.ok(result.frames.length > 0 && result.frames.length <= frameTarget(duration));
      if (kind === "static") assert.equal(result.frames.length, 1);
      for (const frame of result.frames) {
        assert.ok(frame.timestamp >= 0 && frame.timestamp < result.duration);
        const buffer = Buffer.from(frame.image.split(",")[1], "base64");
        const dimensions = await sharp(buffer).metadata();
        assert.ok(dimensions.width <= 960 && dimensions.height <= 960);
        assert.ok(buffer.length <= 524288);
      }
      if (kind !== "static") {
        assert.ok(result.frames.length >= 3);
        assert.ok(result.frames.at(-1).timestamp > duration * 0.75);
      }
      metrics.push({ duration: result.duration, frames: result.frames.length, timestamps: result.frames.map(f => f.timestamp),
        extractionMs: result.samplingMs, bytes: bytes.length });
    }, () => Readable.from([bytes]));
  }
  assert.deepEqual(await readdir(path.join(tmpdir(), "vco-video-analysis")), []);
});
test("unsafe URLs, corrupt input, failure and interrupted leftovers cannot leave temporary files", async () => {
  await assert.rejects(sampleVideo({ url: "https://example.com/video.mp4" }, async () => {}), /private/);
  await assert.rejects(sampleVideo({ url: url() }, async () => {}, () => Readable.from([Buffer.from("corrupt")])), /decoding/);
  const bytes = await clip(1, "static");
  await assert.rejects(sampleVideo({ url: url() }, async () => { throw new Error("provider failed"); },
    () => Readable.from([bytes])), /provider failed/);
  const stale = path.join(tmpdir(), "vco-video-analysis", "job-deadWorker");
  await mkdir(stale); await utimes(stale, new Date(0), new Date(0));
  await cleanupVideoTemps();
  assert.deepEqual(await readdir(path.join(tmpdir(), "vco-video-analysis")), []);
});
test("scene windows prefer a visible cut and retain its presentation timestamp", async () => {
  const filename = path.join(directory, "scene.mp4");
  await execute("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=red:s=160x90:r=30:d=0.5",
    "-f", "lavfi", "-i", "color=blue:s=160x90:r=30:d=4.5", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map", "[v]", "-threads", "1", "-c:v", "libx264", "-y", filename]);
  const bytes = await readFile(filename);
  await sampleVideo({ url: url() }, async sample => {
    assert.ok(Math.abs(sample.frames[0].timestamp - 0.5) < 0.05, "prefer the cut at 0.5s rather than the temporal frame at 0s");
  }, () => Readable.from([bytes]));
});
test("download byte limits, rapid-restart disk admission and process interruption are bounded", async () => {
  await assert.rejects(sampleVideo({ url: url() }, async () => {}, () => Readable.from((async function* () {
    for (let n = 0; n <= Math.ceil(mediaPolicy.videoBytes / 1048576); n++) yield Buffer.alloc(1048576);
  })())), /byte limit/);
  const root = path.join(tmpdir(), "vco-video-analysis");
  const occupied = Array.from({ length: 4 }, (_, index) => path.join(root, `job-occupied${index}`));
  try {
    for (const folder of occupied) await mkdir(folder);
    await assert.rejects(sampleVideo({ url: url() }, async () => {}), /storage budget/);
  } finally { for (const folder of occupied) await rm(folder, { recursive: true, force: true }); }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(videoTool("ffmpeg", ["-v", "error", "-re", "-f", "lavfi",
      "-i", "testsrc=size=16x16:rate=1", "-f", "null", "-"], controller.signal), /interrupted|decoding/);
  } finally { clearTimeout(timer); }
  assert.deepEqual(await readdir(root), []);
});
test("aggregation retains multiple numbers, clears contradictory identities and global labels", () => {
  const frame = (tags, vehicles) => ({ timestamp: 0, hash: randomUUID(), tags, vehicles });
  const result = aggregateVideo([
    frame(["Day", "GT Car", "Dry Track"], [observation("089", { team: "Team A", vehicle: "GT Car" }), observation("90")]),
    frame(["Night", "Stock Car", "Rain", "Wet Track"], [observation("089", { team: "Team B", vehicle: "Stock Car" })]),
  ]);
  assert.deepEqual(result.vehicles.map(v => v.number), ["90"]);
  assert.ok(!result.tags.includes("Day") && !result.tags.includes("Night"));
  assert.ok(!result.tags.includes("GT Car") && !result.tags.includes("Stock Car"));
  assert.ok(!result.tags.includes("Dry Track"));
  const agreed = aggregateVideo([frame(["Day"], [observation("089")]), frame(["Day"], [observation("89")])]);
  assert.equal(agreed.vehicles.length, 1); assert.equal(agreed.vehicles[0].drivers, "");
});
test("a deterministic corrupt original fails once without AI calls or changing its original/manual metadata", async () => {
  videoBytes=Buffer.from("not a decodable container");
  const item=await media();
  const before=requests;
  await enqueueAnalysis(item);
  await until(async()=> (await analysisStatus(item.id)).status==="failed");
  const job=await analysisStatus(item.id);
  assert.equal(job.attempts,1);
  assert.match(job.error,/probe \(INPUT_UNSUPPORTED\)/);
  assert.equal(requests,before,"decoder rejection must not call the provider");
  assert.equal(await drainAnalysisQueue(),false,"permanent failure must not be retried automatically");
  const saved=await storage.getMediaItem(item.id);
  assert.equal(saved.url,item.url);
  assert.equal(saved.thumbnail,item.thumbnail);
  assert.equal(saved.caption,item.caption);
  assert.deepEqual(saved.tags,item.tags);
  assert.deepEqual(videoBytes,Buffer.from("not a decodable container"));
});
test("provider batches preserve timestamps, token usage and readability gates", async () => {
  videoBytes = await clip(20);
  await sampleVideo({ url: url() }, async sample => {
    const result = await recognizeVideoBatch(sample.frames.slice(0, 4));
    assert.deepEqual(result.usage, { prompt: 200, completion: 100 });
    assert.deepEqual(result.frames.map(f => f.timestamp), sample.frames.slice(0, 4).map(f => f.timestamp));
    assert.ok(result.frames.every(f => f.vehicles.every(v => v.number !== "8?" && v.racingClass === "" && v.drivers === "")));
  });
});
test("durable batches survive retries, edits, reference revisions and failed new generations", { timeout: 90000 }, async () => {
  videoBytes = await clip(60);
  const item = await media();
  let localCalls = 0, release, entered = false;
  const gate = new Promise(resolve => { release = resolve; });
  mockProvider(async () => {
    localCalls++; entered = true;
    if (localCalls === 1) await gate;
    if (localCalls === 2) throw new Error("controlled second-batch failure");
  });
  await enqueueAnalysis(item);
  await until(() => entered);
  await enqueueAnalysis(item); // No duplicate.
  await storage.updateMediaItem(item.id, { tags: ["manual edited"], manualTags: ["manual edited"],
    suppressedAITags: ["Day"], caption: "Caption edited during analysis",
    identification: [observation("7", { source: "manual", team: "Confirmed" })], identificationManual: true });
  release();
  await until(async () => (await analysisStatus(item.id)).status === "queued");
  const [partial] = await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id));
  assert.equal(partial.videoEvidence.frames.length, 4);
  assert.equal(partial.videoEvidence.providerRequests, 2);
  mockProvider();
  await db.update(mediaAnalysisJobs).set({ availableAt: new Date() }).where(eq(mediaAnalysisJobs.mediaId, item.id));
  const before = requests;
  await drainAnalysisQueue();
  assert.equal(requests - before, 1, "successful batch must not be resent");
  let saved = await storage.getMediaItem(item.id);
  assert.ok(saved.tags.includes("manual edited")); assert.ok(!saved.tags.includes("Day"));
  assert.equal(saved.caption, "Caption edited during analysis");
  assert.equal(saved.identification[0].team, "Confirmed");
  const [completed] = await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id));
  assert.equal(completed.videoEvidence.providerRequests, 3);
  assert.equal(completed.videoEvidence.promptTokens, 400);
  assert.equal(completed.videoEvidence.usageUnavailableRequests, 1);
  assert.ok(completed.videoEvidence.analyzedFrames <= 8);
  const reused = requests;
  await enqueueAnalysis(saved); assert.equal(requests, reused);
  await storage.updateMediaItem(item.id, { identificationManual: false, recognitionSession: "Race 2" });
  await db.insert(referenceDocuments).values({ eventId: item.eventId, ownerId: null, seasonYear: 2026,
    scope: "event", kind: "result", session: "Race 2", title: "Synthetic lineup", fingerprint: randomUUID(), identityKey: randomUUID(),
    rows: [{ number: "89", team: "Matched", car: "Stock Car", drivers: "Registered lineup" }] });
  await db.update(events).set({ referenceRevision: 1 }).where(eq(events.id, item.eventId));
  await drainAnalysisQueue();
  assert.equal(requests, reused);
  saved = await storage.getMediaItem(item.id);
  assert.ok(saved.identification.some(v => v.team === "Matched" && v.drivers === "Registered lineup"));
  assert.ok(saved.tags.includes("manual edited")); assert.ok(!saved.tags.includes("Day"));
  mockProvider(async () => { throw new Error("failed reanalysis"); });
  await enqueueAnalysis(saved, { reanalyse: true });
  await until(async () => (await analysisStatus(item.id)).status === "queued");
  await db.update(mediaAnalysisJobs).set({ attempts: 2, availableAt: new Date() }).where(eq(mediaAnalysisJobs.mediaId, item.id));
  await drainAnalysisQueue();
  assert.equal((await analysisStatus(item.id)).status, "failed");
  assert.deepEqual((await storage.getMediaItem(item.id)).identification, saved.identification);
  assert.deepEqual((await storage.getMediaItem(item.id)).tags, saved.tags);
  assert.equal(itemAnalysisFingerprint(item), itemAnalysisFingerprint({ ...item, thumbnail: "changed poster" }));
  assert.notEqual(itemAnalysisFingerprint(item), itemAnalysisFingerprint({ ...item, url: url() }));
  metrics.push({ job: "partial retry", frames: completed.videoEvidence.analyzedFrames,
    calls: completed.videoEvidence.providerRequests, knownPromptTokens: completed.videoEvidence.promptTokens,
    knownCompletionTokens: completed.videoEvidence.completionTokens, unknownUsageRequests: 1, billingCost: "unavailable" });
  mockProvider();
});
test("a running video renews its lease, rejects a second claimant and fences a lost worker", { timeout: 40000 }, async () => {
  videoBytes = await clip(2, "static");
  const item = await media();
  let release, entered = false;
  const gate = new Promise(resolve => { release = resolve; });
  mockProvider(async () => { entered = true; await gate; });
  await enqueueAnalysis(item);
  await until(() => entered);
  const [first] = await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id));
  await new Promise(resolve => setTimeout(resolve, 15500));
  const [renewed] = await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id));
  assert.ok(renewed.updatedAt > first.updatedAt, "heartbeat must renew the lease during a provider request");
  assert.equal(await drainAnalysisQueue(), false, "live work is not reclaimed");
  await db.update(mediaAnalysisJobs).set({ workerToken: "replacement-worker" }).where(eq(mediaAnalysisJobs.mediaId, item.id));
  release(); await stopAnalysisWorker();
  assert.deepEqual((await storage.getMediaItem(item.id)).tags, ["manual"], "lost worker cannot publish");
  const [fenced] = await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id));
  assert.equal(fenced.videoEvidence.frames.length, 0, "lost worker cannot persist partial observations");
  await db.update(mediaAnalysisJobs).set({ updatedAt: new Date(Date.now() - 120000) }).where(eq(mediaAnalysisJobs.mediaId, item.id));
  mockProvider();
  await drainAnalysisQueue();
  assert.equal((await analysisStatus(item.id)).status, "completed");
});
