import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, readFile, rm, readdir, mkdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq, inArray } from "drizzle-orm";
import { Client } from "@replit/object-storage";
import { db, pool } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import { mediaAnalysisJobs, mediaItems, mediaReservations, mediaCleanup, events, referenceDocuments } from "../shared/schema.ts";
import { frameTarget, sampleVideo, cleanupVideoTemps, videoTool } from "../server/video-sampling.ts";
import { mediaPolicy } from "../server/media-policy.ts";
import { aggregateVideo, recognizeVideoBatch, VIDEO_NUMBER_PIPELINE } from "../server/video-recognition.ts";
import { enqueueAnalysis, analysisStatus, drainAnalysisQueue, stopAnalysisWorker, itemAnalysisFingerprint, setAnalysisQueueTestScope } from "../server/analysis-jobs.ts";
import sharp from "sharp";

const execute = promisify(execFile);
const directory = await mkdtemp(path.join(tmpdir(), "video-test-"));
const albums = [];
const ownedMediaIds = [];
const realFetch = globalThis.fetch;
const originalReader = Client.prototype.downloadAsStream;
const originalUpload = Client.prototype.uploadFromBytes;
const originalDelete = Client.prototype.delete;
const previews = new Map();
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
function mockProvider(work = async () => {},withMakes=false) {
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://video-test.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-only";
  globalThis.fetch = async (input, options) => {
    if (!String(input).startsWith("https://video-test.invalid/")) return realFetch(input, options);
    requests++;
    const request = JSON.parse(options.body);
    const frames = request.messages[1].content.filter(c => c.type === "image_url");
    if (request.model !== "gpt-4.1-mini") {
      const regions = [[0,0,500,1000],[500,0,500,1000]];
      const numbers = ["089","90"];
      const localization = request.messages[0].content.startsWith("Localize");
      const content = localization ? {scene:null,vehicles:numbers.map((number,index)=>({number,vehicleRegion:regions[index]}))}
        : {fullImageReadings:numbers.map((number,index)=>({number,vehicleRegion:regions[index],
          ...(withMakes?{manufacturer:"Porsche",manufacturerConfident:true}:{}),
          panelRegion:[regions[index][0]+100,200,100,100]})),
          vehicleReadings:request.messages[1].content.filter(c=>c.type==="text"&&c.text.startsWith("Vehicle crop"))
            .map(c=>({vehicleIndex:Number(c.text.split(" ").at(-1)),number:numbers[Number(c.text.split(" ").at(-1))],
              ...(withMakes?{manufacturer:"Porsche",manufacturerConfident:true}:{})}))};
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}],
        usage:{prompt_tokens:200,completion_tokens:100}}),{headers:{"content-type":"application/json"}});
    }
    assert.ok(frames.length >= 1 && frames.length <= 4);
    assert.ok(frames.every(f => f.image_url.url.startsWith("data:image/jpeg;base64,")));
    assert.ok(request.max_tokens <= 2400);
    assert.doesNotMatch(request.messages[0].content, /Real Motorsport/);
    await work(request);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      frames: frames.map((_, index) => ({ index, tags: ["Real Motorsport", "Day", "Race Car", "Front View", "Sim Racing", "Esports"], vehicles: [
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
  Client.prototype.uploadFromBytes = async (key, bytes) => { previews.set(key, Buffer.from(bytes)); return {ok:true}; };
  Client.prototype.delete = async key => { previews.delete(key); return {ok:true}; };
  mockProvider();
});
test.after(async () => {
  await stopAnalysisWorker();
  globalThis.fetch = realFetch; Client.prototype.downloadAsStream = originalReader;
  Client.prototype.uploadFromBytes = originalUpload;
  Client.prototype.delete = originalDelete;
  for (const [key, value] of [["AI_INTEGRATIONS_OPENAI_BASE_URL", previousBase], ["AI_INTEGRATIONS_OPENAI_API_KEY", previousKey]])
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  for (const id of albums) {
    await db.delete(mediaReservations).where(eq(mediaReservations.eventId, id));
    await db.delete(mediaItems).where(eq(mediaItems.eventId, id));
    await db.delete(events).where(eq(events.id, id));
  }
  if (previews.size) await db.delete(mediaCleanup).where(inArray(mediaCleanup.key, [...previews.keys()]));
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
  assert.ok(result.vehicles.every(v => !v.number), "weak numbers never certify identities");
  assert.equal(result.vehicles.length,3, "unknown cars are not discarded");
  assert.ok(!result.tags.includes("Day") && !result.tags.includes("Night"));
  assert.ok(!result.tags.includes("GT Car") && !result.tags.includes("Stock Car"));
  assert.ok(!result.tags.includes("Dry Track"));
  const agreed = aggregateVideo([frame(["Day"], [observation("089")]), frame(["Day"], [observation("89")])]);
  assert.equal(agreed.vehicles.length, 2); assert.ok(agreed.vehicles.every(v=>!v.number&&!v.drivers));
});
test("aggregation of historical frames drops retired tags without suppressing compatible virtual labels", () => {
  const result = aggregateVideo([
    { timestamp: 0, hash: "a", tags: ["Real Motorsport", "Sim Racing", "Esports"], vehicles: [] },
    { timestamp: 1, hash: "b", tags: ["Real Motorsport"], vehicles: [] },
    { timestamp: 2, hash: "c", tags: ["Real Motorsport"], vehicles: [] },
  ]);
  assert.deepEqual(result.tags, ["Sim Racing", "Esports"]);
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
test("preview replacement fences stale workers and journals unsuccessful object uploads", async () => {
  const item = await media();
  const token = randomUUID();
  await db.insert(mediaAnalysisJobs).values({mediaId:item.id, fingerprint:itemAnalysisFingerprint(item),
    status:"running",workerToken:token});
  const bytes = await sharp({create:{width:160,height:90,channels:3,background:"red"}}).webp().toBuffer();
  const count = previews.size;
  assert.equal(await storage.replaceVideoPreview(item, "lost-token", bytes), false);
  assert.equal(previews.size, count);
  const upload = Client.prototype.uploadFromBytes;
  let uploaded;
  Client.prototype.uploadFromBytes = async (key, buffer) => {
    uploaded = key; previews.set(key, Buffer.from(buffer));
    await db.update(mediaAnalysisJobs).set({workerToken:"replacement-worker"})
      .where(eq(mediaAnalysisJobs.mediaId,item.id));
    return {ok:true};
  };
  try {
    assert.equal(await storage.replaceVideoPreview(item, token, bytes), false);
    assert.equal((await storage.getMediaItem(item.id)).thumbnail, item.thumbnail);
    assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.eventId,item.eventId))).length,0);
    assert.equal((await db.select().from(mediaCleanup).where(eq(mediaCleanup.key,uploaded))).length,1);
  } finally {
    Client.prototype.uploadFromBytes = upload;
    await db.update(mediaAnalysisJobs).set({status:"failed",workerToken:null})
      .where(eq(mediaAnalysisJobs.mediaId,item.id));
  }
});
test("provider batches preserve timestamps, token usage and readability gates", async () => {
  videoBytes = await clip(20);
  await sampleVideo({ url: url() }, async sample => {
    const result = await recognizeVideoBatch(sample.frames.slice(0, 4));
    assert.deepEqual(result.usage, { prompt: 200, completion: 100 });
    assert.deepEqual(result.frames.map(f => f.timestamp), sample.frames.slice(0, 4).map(f => f.timestamp));
    assert.ok(result.frames.every(f => f.vehicles.every(v => v.number !== "8?" && v.racingClass === "" && v.drivers === "")));
    assert.ok(result.frames.every(f => !f.tags.includes("Real Motorsport") && f.tags.includes("Sim Racing") && f.tags.includes("Esports")));
  });
});
test("a no-list video saves a checked-make caption without inventing a model or entry", {timeout:60000},async()=>{
  videoBytes=await clip(1);const item=await media();
  await db.update(mediaItems).set({caption:"",captionSource:"auto_pending"}).where(eq(mediaItems.id,item.id));
  mockProvider(async()=>{},true);
  try{
    await enqueueAnalysis(item);
    await until(async()=>(await analysisStatus(item.id)).status==="completed");
    const saved=await storage.getMediaItem(item.id);
    assert.ok(saved.caption.endsWith(" | Porsche"));
    assert.ok(!saved.caption.includes("#")&&!saved.caption.includes("911"));
    assert.ok(saved.identification.every(v=>v.source==="visual"&&!v.drivers&&!v.team));
  }finally{mockProvider();}
});
test("malformed frame batches preserve originals and previews, then complete safely on retry", { timeout: 90000 }, async () => {
  videoBytes=await clip(20);
  const item=await media();
  const originalUrl=item.url;
  mockProvider();
  const validProvider=globalThis.fetch;
  let malformed=true;
  globalThis.fetch=async(input,options)=>{
    if(String(input).startsWith("https://video-test.invalid/") &&
      JSON.parse(options.body).model==="gpt-4.1-mini" && malformed) {
      malformed=false;
      // Valid JSON but only one returned frame for the four-frame request.
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:
        JSON.stringify({frames:[{index:0,tags:[],vehicles:[]}]})}}],
        usage:{prompt_tokens:200,completion_tokens:100}}),{headers:{"content-type":"application/json"}});
    }
    return validProvider(input,options);
  };
  await enqueueAnalysis(item);
  await until(async()=>{
    const status=await analysisStatus(item.id);
    return status.status==="queued" && status.attempts===1;
  });
  const [partial]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,item.id));
  assert.match(partial.error,/AI_OUTPUT_INVALID: frame_count/);
  assert.equal(partial.videoEvidence.frames.length,0,"Incomplete batches cannot fabricate missing frame evidence");
  assert.equal(partial.videoEvidence.promptTokens,200);
  assert.equal(partial.videoEvidence.completionTokens,100);
  const saved=await storage.getMediaItem(item.id);
  assert.equal(saved.url,originalUrl);
  assert.equal(saved.caption,"Approved caption");
  assert.notEqual(saved.thumbnail,"generic-poster","Real preview must survive failed optional recognition");
  await db.update(mediaAnalysisJobs).set({availableAt:new Date(0)}).where(eq(mediaAnalysisJobs.mediaId,item.id));
  await drainAnalysisQueue();
  await until(async()=>(await analysisStatus(item.id)).status==="completed");
  const complete=await storage.getMediaItem(item.id);
  assert.equal(complete.url,originalUrl);
  assert.equal(complete.caption,"Approved caption");
  assert.ok(complete.tags.includes("Day"));
  assert.ok(complete.identification.every(row=>!row.number || row.numberEvidence));
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
   await until(async () => {
     const status=await analysisStatus(item.id);
     return status.status==="queued" && status.attempts>=1;
   });
  const [partial] = await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id));
  assert.equal(partial.videoEvidence.frames.length, 4);
  assert.equal(partial.videoEvidence.providerRequests, 2);
  mockProvider();
  await db.update(mediaAnalysisJobs).set({ availableAt: new Date() }).where(eq(mediaAnalysisJobs.mediaId, item.id));
  const before = requests;
  await drainAnalysisQueue();
  assert.equal(requests - before, 9, "successful batch must not be resent; four frames receive two independent checks");
  let saved = await storage.getMediaItem(item.id);
  assert.ok(saved.tags.includes("manual edited")); assert.ok(!saved.tags.includes("Day"));
  assert.equal(saved.caption, "Caption edited during analysis");
  assert.equal(saved.identification[0].team, "Confirmed");
  const [completed] = await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id));
  assert.match(saved.thumbnail, /^\/api\/media\/files\/thumb-/);
  assert.ok(previews.get(saved.thumbnail.split("/").at(-1)).length < 100 * 1024);
  assert.ok(completed.videoEvidence.posterSourceHash);
  assert.equal(completed.videoEvidence.providerRequests, 11);
  assert.equal(completed.videoEvidence.numberRequests,8);
  assert.equal(completed.videoEvidence.numberPipeline,VIDEO_NUMBER_PIPELINE);
  assert.equal(completed.videoEvidence.promptTokens, 2000);
  assert.equal(completed.videoEvidence.usageUnavailableRequests, 1);
  assert.ok(completed.videoEvidence.analyzedFrames <= 8);
  const reused = requests;
  await enqueueAnalysis(saved); assert.equal(requests, reused);
  await storage.updateMediaItem(item.id, { identificationManual: false, recognitionSession: "Race 2" });
  await db.insert(referenceDocuments).values({ eventId: item.eventId, ownerId: null, seasonYear: 2026,
    scope: "event", kind: "result", session: "Race 2", title: "Synthetic lineup", fingerprint: randomUUID(), identityKey: randomUUID(),
    rows: [{ number: "89", team: "Matched", car: "Stock Car", drivers: "Registered lineup" }] });
  await db.update(events).set({ referenceRevision: 1 }).where(eq(events.id, item.eventId));
  await until(async()=>{
    await drainAnalysisQueue();
    const [rematched]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,item.id));
    return rematched.status==="completed" && rematched.referenceRevision===1;
  });
  assert.equal(requests, reused);
  saved = await storage.getMediaItem(item.id);
  assert.ok(saved.identification.some(v => v.team === "Matched" && v.drivers === "Registered lineup"));
  assert.ok(saved.tags.includes("manual edited")); assert.ok(!saved.tags.includes("Day"));
  mockProvider(async () => { throw new Error("failed reanalysis"); });
  await enqueueAnalysis(saved, { reanalyse: true });
   await until(async () => {
     const status=await analysisStatus(item.id);
     return status.status==="queued" && status.attempts>=1;
   });
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
test("historical policy rematches without AI, while explicit reanalysis and changed sources require fresh checked pixels",async()=>{
  videoBytes=await clip(1,"static");
  const item=await media();mockProvider();
  await enqueueAnalysis(item);
  await until(async()=>(await analysisStatus(item.id)).status==="completed");
  const [first]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,item.id));
  assert.ok(first.recognition.some(v=>v.number==="089"));
  await db.update(mediaAnalysisJobs).set({videoEvidence:{...first.videoEvidence,numberPipeline:"historical"}})
    .where(eq(mediaAnalysisJobs.mediaId,item.id));
  await db.insert(referenceDocuments).values({eventId:item.eventId,ownerId:null,seasonYear:2026,scope:"event",
    kind:"entry",session:null,title:"Historical regression",fingerprint:randomUUID(),identityKey:randomUUID(),
    rows:[{number:"89",team:"Do not infer",car:"Stock Car",drivers:"Registered only"}]});
  await db.update(events).set({referenceRevision:1}).where(eq(events.id,item.eventId));
  const before=requests;await drainAnalysisQueue();
  assert.equal(requests,before);
  assert.ok((await storage.getMediaItem(item.id)).identification.every(v=>!v.number&&!v.drivers));
  await enqueueAnalysis(await storage.getMediaItem(item.id),{reanalyse:true});
  await until(async()=>(await analysisStatus(item.id)).status==="completed");
  const [fresh]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,item.id));
  assert.equal(fresh.videoEvidence.numberPipeline,VIDEO_NUMBER_PIPELINE);
  assert.equal(requests-before,3,"one weak batch, one localization and one independent audit");
  assert.ok((await storage.getMediaItem(item.id)).identification.some(v=>v.team==="Do not infer"));
  const priorHash=fresh.videoEvidence.sourceHash;
  videoBytes=await clip(2);
  await storage.updateMediaItem(item.id,{url:url()});
  await enqueueAnalysis(await storage.getMediaItem(item.id));
  await until(async()=>(await analysisStatus(item.id)).status==="completed");
  const [changed]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,item.id));
  assert.notEqual(changed.videoEvidence.sourceHash,priorHash);
  assert.ok(changed.videoEvidence.frames.every(f=>f.numberCheck?.hash!==first.videoEvidence.frames[0].hash));
  assert.equal((await storage.getMediaItem(item.id)).caption,"Approved caption");
});
