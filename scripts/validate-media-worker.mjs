// Focused development-only validation; no deployment changes or live AI calls.
// Stop the preview worker first. Run: node --import tsx scripts/validate-media-worker.mjs
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { db, pool } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import { events, users, mediaAnalysisJobs } from "../shared/schema.ts";
import { cleanupVideoTemps } from "../server/video-sampling.ts";
import { monitorGroup, halfCoreThrottle } from "./helpers/process-resources.mjs";

if (process.env.NODE_ENV === "production") throw new Error("Worker validation is development-only");
const delay = ms => new Promise(r => setTimeout(r, ms));
const execute = promisify(execFile);
const directory = await mkdtemp(path.join(tmpdir(), "vco-worker-validation-"));
const childPath = new URL("./helpers/media-worker-fixture.mjs", import.meta.url).pathname;
const albums = [];
let owner, current;
const results = [];
const affinity = (await readFile("/proc/self/status", "utf8")).match(/Cpus_allowed_list:\s*(\S+)/)[1];
const cpu = affinity.split(/[,-]/)[0];
const videoRoot = path.join(tmpdir(), "vco-video-analysis");
const originalTemps = new Set(await readdir(videoRoot).catch(() => []));
const until = async (check, timeout = 120000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(150); }
  throw new Error("Validation condition timed out");
};

async function childFor(dir, concurrency, mode = "normal", throttle = false) {
  const child = spawn("taskset", ["-c", cpu, process.execPath, "--import", "tsx", childPath, dir, String(owner.id), mode], {
    detached: true, env: { ...process.env, MEDIA_ANALYSIS_CONCURRENCY: String(concurrency) },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout.on("data", bytes => { output += bytes; });
  child.stderr.on("data", bytes => { output += bytes; });
  const messages = [];
  child.on("message", message => messages.push(message));
  const take = async type => {
    let value;
    await until(() => {
      const index = messages.findIndex(m => m.type === type);
      if (index >= 0) { value = messages.splice(index, 1)[0]; return true; }
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Fixture exited: ${output}`);
    });
    return value;
  };
  const release = throttle ? halfCoreThrottle(child.pid) : () => {};
  current = { child, release };
  const { port } = await take("ready");
  const api = async (route, body) => {
    const start = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}${route}`, body ? { method: "POST", body } : {});
    const value = await response.json();
    assert.ok(response.ok, JSON.stringify(value) + "\n" + output.slice(-6000));
    return { value, ms: Math.round(performance.now() - start) };
  };
  const statuses = async ids => { child.send({ type: "status", ids }); return (await take("status")).results; };
  const stop = async (kill = false) => {
    release();
    const ended = once(child, "exit");
    if (kill) process.kill(-child.pid, "SIGKILL");
    else child.send({ type: "stop" });
    await ended; current = undefined;
  };
  return { child, take, api, statuses, stop };
}
async function album(title) {
  const event = await storage.createEvent({ title, description: "Disposable development validation",
    date: new Date(), isPremium: false, creatorId: owner.id });
  albums.push(event.id); return event;
}
function upload(bytes, type, autoTag = false) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: type === "video" ? "video/mp4" : "image/png" }),
    type === "video" ? "clip.mp4" : "photo.png");
  form.append("type", type); form.append("autoTag", String(autoTag));
  form.append("caption", "Fixture caption"); form.append("tags", '["manual"]');
  return form;
}
async function waitCompleted(worker, ids, maxActive = 2, timeout = 120000) {
  let seenRunning = 0;
  await until(async () => {
    const jobs = await worker.statuses(ids);
    const running = jobs.filter(j => j.status === "running").length;
    seenRunning = Math.max(seenRunning, running);
    assert.ok(running <= maxActive, "Configured global analysis limit exceeded");
    assert.ok(jobs.every(j => j.status !== "failed"), JSON.stringify(jobs));
    return jobs.every(j => j.status === "completed");
  }, timeout);
  return { jobs: await worker.statuses(ids), maxRunning: seenRunning };
}

try {
  // Refuse to consume the operator's work or run alongside another queue test.
  const pending = await db.execute(sql`select count(*)::int as count from media_analysis_jobs j
    left join media_items m on m.id=j.media_id left join events e on e.id=m.event_id
    where j.status in ('queued','running') or
    (j.status='completed' and j.recognition is not null and e.reference_revision>j.reference_revision)`);
  assert.equal(pending.rows[0].count, 0, "Stop other workers and finish existing development jobs before validation");
  const imports = await db.execute(sql`select count(*)::int as count from nextcloud_jobs where status in ('queued','running')`);
  assert.equal(imports.rows[0].count, 0, "Finish existing development imports before validation");
  [owner] = await db.insert(users).values({ username: `worker-${randomUUID()}`,
    email: `${randomUUID()}@example.invalid`, password: "fixture-not-a-login",
    isCreator: true, creatorStatus: "approved" }).returning();
  const videoPath = path.join(directory, "1080p.mp4");
  // Ordinary upload-resolution clip with changing content and eight retained frames.
  await execute("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
    "testsrc2=size=1920x1080:rate=5:duration=60,hue=h=t*37", "-threads", "1",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p", videoPath],
    { timeout: 90000 });
  const video = await readFile(videoPath);
  assert.ok(video.length < 50 * 1048576);
  const photos = await Promise.all(["#89_3.png", "IMG_7464.png"].map(name => readFile(path.join("attached_assets", name))));
  const dimensions = await Promise.all(photos.map(async bytes => {
    const { width, height } = await sharp(bytes).metadata(); return { width, height, bytes: bytes.length };
  }));

  // One hard crash, no artificial lease aging: the new process waits out 90s.
  const restartDir = path.join(directory, "restart");
  await mkdir(restartDir);
  const restartAlbum = await album("Worker restart fixture");
  const first = await childFor(restartDir, 1, "interrupt");
  const saved = (await first.api(`/api/events/${restartAlbum.id}/media/upload`, upload(video, "video"))).value;
  await first.take("interrupt-ready");
  const [partial] = await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, saved.id));
  assert.equal(partial.videoEvidence.frames.length, 4);
  assert.equal(partial.status, "running");
  const firstHashes = JSON.parse((await readFile(path.join(restartDir, "requests.jsonl"), "utf8")).split("\n")[0]).hashes;
  const firstPid = first.child.pid;
  await first.stop(true);
  const restartedAt = performance.now();
  const second = await childFor(restartDir, 1);
  assert.notEqual(second.child.pid, firstPid);
  const recovered = await waitCompleted(second, [saved.id], 1, 160000);
  const recoveryMs = Math.round(performance.now() - restartedAt);
  const log = (await readFile(path.join(restartDir, "requests.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  const resumed = log.filter(call => call.pid !== firstPid);
  assert.equal(resumed.length, 1, "Only the remaining batch should be requested on restart");
  assert.ok(resumed[0].hashes.every(hash => !firstHashes.includes(hash)), "Persisted successful frames were resent");
  assert.equal(recovered.jobs[0].frames, 8);
  const count = log.length;
  await second.api(`/api/media/${saved.id}/analyze`, new Blob(["{}"], { type: "application/json" }));
  await delay(1000);
  assert.equal((await readFile(path.join(restartDir, "requests.jsonl"), "utf8")).trim().split("\n").length, count,
    "Completed work was resubmitted");
  results.push({ scenario: "SIGKILL and fresh process", realLeaseWait: true, firstPid, restartedPid: second.child.pid,
    recoveryMs, persistedFramesBeforeCrash: 4, completedFrames: 8, requestsAfterRestart: resumed.length,
    successfulBatchesDuplicated: 0, attempts: recovered.jobs[0].attempts });
  await second.stop();

  for (const scenario of [
    { name: "two-jobs-one-core", concurrency: 2, halfCore: false },
    { name: "two-jobs-half-core-approximation", concurrency: 2, halfCore: true },
    { name: "one-job-half-core-approximation", concurrency: 1, halfCore: true },
  ]) {
    const dir = path.join(directory, scenario.name);
    await mkdir(dir);
    const event = await album(scenario.name);
    const worker = await childFor(dir, scenario.concurrency, "normal", scenario.halfCore);
    let monitor = monitorGroup(worker.child.pid);
    const photoStart = performance.now();
    const imageUploads = [];
    for (const bytes of photos)
      imageUploads.push(await worker.api(`/api/events/${event.id}/media/upload`, upload(bytes, "image", true)));
    const imagesDone = await waitCompleted(worker, imageUploads.map(r => r.value.id), scenario.concurrency);
    const imageMetrics = await monitor.finish();
    const imageMs = Math.round(performance.now() - photoStart);

    // Same third photo, idle baseline vs concurrent video decoding/analysis.
    const baseline = await worker.api(`/api/events/${event.id}/media/upload`, upload(photos[1], "image"));
    assert.equal((await worker.statuses([baseline.value.id]))[0].status, "not_requested",
      "Default image behavior changed");
    monitor = monitorGroup(worker.child.pid);
    const videoStart = performance.now();
    const videoUploads = [];
    for (let i = 0; i < 2; i++)
      videoUploads.push(await worker.api(`/api/events/${event.id}/media/upload`, upload(video, "video")));
    await until(async () => (await worker.statuses(videoUploads.map(r => r.value.id))).some(j => j.status === "running"));
    const activeBefore = await worker.statuses(videoUploads.map(r => r.value.id));
    const during = await worker.api(`/api/events/${event.id}/media/upload`, upload(photos[1], "image"));
    assert.equal((await worker.statuses([during.value.id]))[0].status, "not_requested");
    const activeAfter = await worker.statuses(videoUploads.map(r => r.value.id));
    assert.ok(activeBefore.some(j => j.status === "running") && activeAfter.some(j => j.status === "running"),
      "Upload must overlap actual video work");
    const videosDone = await waitCompleted(worker, videoUploads.map(r => r.value.id), scenario.concurrency);
    const videoMetrics = await monitor.finish();
    const videoMs = Math.round(performance.now() - videoStart);
    results.push({ ...scenario, images: { ...imageMetrics, totalMs: imageMs, maxRunning: imagesDone.maxRunning,
      uploadMs: imageUploads.map(r => r.ms), failed: 0 },
    videosAndConcurrentUpload: { ...videoMetrics, totalMs: videoMs, maxRunning: videosDone.maxRunning,
      videoUploadMs: videoUploads.map(r => r.ms), imageUploadIdleMs: baseline.ms,
      imageUploadDuringVideoMs: during.ms, frames: videosDone.jobs.map(j => j.frames), failed: 0 } });
    await worker.stop();
  }
  // Only this run's abandoned directories: confirm startup/tick cleanup policy.
  const abandoned = (await readdir(videoRoot)).filter(name => !originalTemps.has(name));
  for (const name of abandoned) {
    const old = new Date(Date.now() - 6 * 60000);
    await utimes(path.join(videoRoot, name), old, old);
  }
  await cleanupVideoTemps();
  assert.ok((await readdir(videoRoot)).every(name => originalTemps.has(name)));
  const report = { environment: "development; production routes/queue and real FFmpeg/Sharp; mock storage and provider",
    cpuLimit: "one-core taskset affinity; optional 100ms stop/100ms resume duty cycle, not a real VM quota",
    memoryLimit: "not enforced; sampled combined process-group RSS including FFmpeg, excludes client/generator",
    provider: "mock responses with 2s latency; no billable calls; not recognition-quality or live-network validation",
    fixtures: { images: dimensions, video: { width: 1920, height: 1080, durationSeconds: 60, fps: 5, bytes: video.length } },
    staleTemporaryCleanupVerified: true, results };
  await mkdir("generated-artifacts", { recursive: true });
  await writeFile("generated-artifacts/media-worker-validation.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (current) {
    current.release();
    const ended = once(current.child, "exit");
    try { process.kill(-current.child.pid, "SIGKILL"); } catch {}
    if (current.child.exitCode === null && current.child.signalCode === null) await ended;
  }
  for (const id of albums) await db.delete(events).where(eq(events.id, id));
  if (owner) await db.delete(users).where(eq(users.id, owner.id));
  await pool.end();
  for (const name of await readdir(videoRoot).catch(() => []))
    if (!originalTemps.has(name)) await rm(path.join(videoRoot, name), { recursive: true, force: true });
  await rm(directory, { recursive: true, force: true });
}
