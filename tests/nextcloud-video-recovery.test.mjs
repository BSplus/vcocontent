import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm, symlink, open, readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { Client } from "@replit/object-storage";
import { eq } from "drizzle-orm";
import { storage } from "../server/storage.ts";
import { db, pool } from "../server/db.ts";
import { nextcloudFiles, mediaAnalysisJobs, mediaReservations } from "../shared/schema.ts";
import { startImport, updateGallery, resumeImport, importStatus, discover, stopImportWorker } from "../server/nextcloud.ts";
import { stopAnalysisWorker, setAnalysisQueueTestScope } from "../server/analysis-jobs.ts";
import { mediaPolicy } from "../server/media-policy.ts";
import { createVideoPreview } from "../server/video-preview.ts";
import { importFailure, encodeImportFailure, decodeImportFailure } from "../server/nextcloud-failures.ts";
import { VideoAnalysisFailure } from "../server/video-failures.ts";

const exec = promisify(execFile);
const origin = "https://nextcloud.bs-plus.de";
const root = "/public.php/dav/files/RECOVERY_FIXTURE/";
const sources = [{ link: origin + "/s/RECOVERY_FIXTURE", photographer: "Fixture credit" }];
const transport = globalThis.fetch;
const policy = { ...mediaPolicy };
let directory, clip, photo;
const albums = [];
let entries = new Map(), downloads = [], failDownload = false;
const listing = () => `<d:multistatus xmlns:d="DAV:">${[...entries].map(([name, value]) =>
  `<d:response><d:href>${root}${name}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:resourcetype/><d:getcontentlength>${value.size ?? value.length}</d:getcontentlength></d:prop></d:propstat></d:response>`
).join("")}</d:multistatus>`;
async function album() {
  const value = await storage.createEvent({ title: "Offline video recovery", description: "Disposable fixture", date: new Date() });
  albums.push(value.id); return value;
}
async function settled(id) {
  for (let i = 0; i < 600; i++) {
    const state = await importStatus(id);
    if (["completed", "partial", "error"].includes(state.status)) { await stopImportWorker(); return state; }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error("Import did not settle");
}
test.before(async () => {
  assert.ok(process.env.VCO_TEST_OBJECTS, "Use the disposable database/object runner");
  await stopAnalysisWorker();
  setAnalysisQueueTestScope([], []);
  directory = await mkdtemp(path.join(tmpdir(), "nc-recovery-"));
  const filename = path.join(directory, "clip.mp4");
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=red:size=160x90:rate=8:duration=2",
    "-threads", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", filename]);
  clip = await readFile(filename);
  photo = await sharp({ create: { width: 32, height: 32, channels: 3, background: "green" } }).jpeg().toBuffer();
  globalThis.fetch = async (url, options) => {
    // The SDK's default-bucket sidecar lookup is separate from object I/O.
    // Keep unrelated transport intact; scope analysis consumers to no media.
    if (new URL(url).origin !== origin) return transport(url, options);
    if (options.method === "PROPFIND") return new Response(listing(), { status: 207 });
    const name = new URL(url).pathname.split("/").pop();
    downloads.push(name);
    if (failDownload) throw new Error("private credentials and URL must never escape");
    const value = entries.get(name);
    return value.filename
      ? new Response(Readable.toWeb(createReadStream(value.filename)), { headers: { "content-length": String(value.size) } })
      : new Response(value, { headers: { "content-length": String(value.length) } });
  };
});
test.after(async () => {
  await stopImportWorker(); await stopAnalysisWorker();
  globalThis.fetch = transport;
  Object.assign(mediaPolicy, policy);
  for (const id of albums) await storage.deleteEvent(id);
  await storage.cleanupObjects();
  assert.deepEqual(await readdir(process.env.VCO_TEST_OBJECTS), [], "All disposable objects must be cleaned");
  assert.equal((await readdir(tmpdir())).some(name => name.startsWith("nextcloud-") || name.startsWith("vco-video-preview-")), false);
  await rm(directory, { recursive: true, force: true });
  await pool.end();
});
test.beforeEach(() => { Object.assign(mediaPolicy, policy); entries = new Map(); downloads = []; failDownload = false; });

test("mixed import survives poster tool failure; resume preserves photos, credit, manual metadata and analysis admission", async () => {
  const event = await album();
  entries = new Map([["photo.jpg", photo], ["clip.mp4", clip]]);
  const tools = path.join(directory, "tools");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(tools);
  const probe = (await exec("which", ["ffprobe"])).stdout.trim();
  await symlink(probe, path.join(tools, "ffprobe"));
  await writeFile(path.join(tools, "ffmpeg"), "#!/bin/sh\nprintf 'Unrecognized option fixture-only' >&2\nexit 1\n", { mode: 0o755 });
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = tools;
    await startImport(event.id, sources);
    const failed = await settled(event.id);
    assert.equal(failed.status, "partial");
    assert.equal(failed.importedImages, 1);
    assert.deepEqual(failed.files.find(f => f.name === "clip.mp4").failure,
      { stage: "poster", code: "TOOL_OPTION_UNSUPPORTED", message: "Installed video tools do not support the required options. Check FFmpeg compatibility." });
    assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.eventId, event.id))).length, 0);
    const [savedPhoto] = await storage.getMediaItems(event.id);
    await storage.updateMediaItem(savedPhoto.id, { caption: "Manual caption", photographer: "Manual credit", tags: ["Race Car"] });
    const before = await storage.getMediaItem(savedPhoto.id);
    process.env.PATH = previousPath;
    downloads = [];
    await resumeImport(event.id);
    const recovered = await settled(event.id);
    assert.equal(recovered.status, "completed");
    assert.deepEqual(downloads, ["clip.mp4"]);
    assert.equal(recovered.importedVideos, 1);
    assert.deepEqual(await storage.getMediaItem(savedPhoto.id), before);
    const video = (await storage.getMediaItems(event.id)).find(item => item.type === "video");
    assert.equal(video.photographer, "Fixture credit");
    const [analysis] = await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, video.id));
    assert.ok(analysis, "Successful save has a durable analysis request, even if AI is unavailable");
    // Force analysis admission failure; it must not revert the saved import.
    assert.equal(recovered.files.find(f => f.name === "clip.mp4").status, "saved");
    downloads = [];
    entries.set("new.mp4", clip);
    await updateGallery(event.id); await settled(event.id);
    assert.deepEqual(downloads, ["new.mp4"]);
    assert.equal((await storage.getMediaItems(event.id)).length, 3);
  } finally { process.env.PATH = previousPath; }
});

test("true source sizes of 51 and 234.5 MiB stream through MP4 validation, poster generation and storage", { timeout: 60000 }, async () => {
  const event = await album();
  // A valid MP4 with a trailing ISO free box, sparsely allocated on disk. No
  // oversized buffers or permanent fixture objects are committed.
  for (const size of [51 * 1048576, 234.5 * 1048576]) {
    const filename = path.join(directory, `${size}.mp4`);
    const handle = await open(filename, "w");
    try {
      await handle.write(clip);
      const box = Buffer.alloc(8);
      box.writeUInt32BE(size - clip.length); box.write("free", 4);
      await handle.write(box);
      await handle.truncate(size);
    } finally { await handle.close(); }
    entries.set(`${size}.mp4`, { filename, size });
  }
  entries.set("photo.jpg", photo);
  await startImport(event.id, sources);
  const result = await settled(event.id);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.importedVideos, 2);
  const media = await storage.getMediaItems(event.id);
  assert.deepEqual(media.filter(m => m.type === "video").map(m => m.highBytes).sort((a,b)=>a-b),
    [51 * 1048576, 234.5 * 1048576]);
});

test("exact original plus actual poster fits event storage; concurrent reservations prevent cumulative overflow", async () => {
  const event = await album();
  const poster = await createVideoPreview(path.join(directory, "clip.mp4"));
  mediaPolicy.eventBytes = clip.length + poster.length;
  entries.set("clip.mp4", clip);
  await startImport(event.id, sources);
  assert.equal((await settled(event.id)).status, "completed", "No blanket 100 KiB poster over-reservation");
  const second = await album();
  mediaPolicy.eventBytes = 2 * clip.length + poster.length;
  entries.set("second.mp4", clip);
  await startImport(second.id, sources);
  const result = await settled(second.id);
  // Discovery source bytes fit; original + poster for two items does not.
  assert.equal(result.status, "partial");
  assert.equal(result.importedVideos, 1);
  assert.equal(result.files.find(f => f.status === "error").failure.code, "EVENT_LIMIT");
});

test("event reservations include existing items and active work; failures leave no leaked reservation", async () => {
  const event = await album();
  entries.set("photo.jpg", photo);
  await startImport(event.id, sources); await settled(event.id);
  const [image] = await storage.getMediaItems(event.id);
  const poster = await createVideoPreview(path.join(directory, "clip.mp4"));
  mediaPolicy.eventBytes = image.storedBytes + clip.length + poster.length - 1;
  entries.set("clip.mp4", clip);
  await updateGallery(event.id);
  const result = await settled(event.id);
  assert.equal(result.importedImages, 1);
  assert.equal(result.files.find(f => f.name === "clip.mp4").failure.code, "EVENT_LIMIT");
  assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.eventId, event.id))).length, 0);
  assert.deepEqual(await storage.getMediaItem(image.id), image);
});

test("discovery accepts configured budgets above 2 GiB, excludes saved transfers and keeps the per-video boundary", async () => {
  mediaPolicy.eventBytes = 4096 * 1048576;
  entries = new Map(Array.from({length: 10}, (_,i) => [`${i}.mp4`, { size: 300 * 1048576 }]));
  const found = await discover(sources);
  assert.equal(found.files.length, 10);
  entries.set("oversized.mp4", { size: 300 * 1048576 + 1 });
  assert.equal((await discover(sources)).skipped, 1);
  mediaPolicy.eventBytes = 2048 * 1048576;
  await assert.rejects(() => discover(sources), /Import limit reached/);
});

test("saved sources consume no retry transfer budget; byte-exact per-file boundary and cumulative received bytes stay enforced", async () => {
  const event = await album();
  entries.set("clip.mp4", clip);
  mediaPolicy.videoBytes = clip.length;
  await startImport(event.id, sources);
  assert.equal((await settled(event.id)).status, "completed");
  const [saved] = await storage.getMediaItems(event.id);
  mediaPolicy.eventBytes = 2 * saved.storedBytes;
  mediaPolicy.videoBytes = policy.videoBytes;
  entries.set("clip.mp4", { size: policy.videoBytes });
  entries.set("new.mp4", clip);
  assert.equal((await discover(sources, event.id)).files.length, 2);
  downloads = [];
  await updateGallery(event.id);
  assert.equal((await settled(event.id)).status, "completed");
  assert.deepEqual(downloads, ["new.mp4"]);
  assert.deepEqual(await storage.getMediaItem(saved.id), saved);

  const overflow = await album();
  entries = new Map([["first.mp4", clip], ["second.mp4", clip]]);
  mediaPolicy.eventBytes = 2 * clip.length - 1;
  const fetch = globalThis.fetch;
  globalThis.fetch = (url, options) => options.method === "PROPFIND"
    ? Promise.resolve(new Response(listing().replaceAll(String(clip.length), "1"), { status: 207 }))
    : fetch(url, options);
  try {
    await startImport(overflow.id, sources);
    const state = await settled(overflow.id);
    assert.equal(state.status, "partial");
    assert.equal(state.files.filter(file => file.failure?.code === "TRANSFER_LIMIT").length, 1);
    assert.equal(state.importedVideos, 1);
  } finally { globalThis.fetch = fetch; }
});

test("invalid signature, invalid video data, download and storage failures retain distinct safe diagnoses", async t => {
  for (const kind of ["signature", "probe", "download", "storage", "commit", "empty", "truncated", "file_limit", "transfer_limit"]) {
    await t.test(kind, async () => {
      Object.assign(mediaPolicy, policy);
      const event = await album();
      entries = new Map([["clip.mp4", kind === "signature" ? Buffer.from("invalid") :
        kind === "probe" ? Buffer.concat([clip.subarray(0, 24), Buffer.from("invalid")]) : clip]]);
      failDownload = kind === "download";
      if (kind === "file_limit") mediaPolicy.videoBytes = clip.length - 1;
      // Advertised size lies; streaming counters, not just discovery, must enforce limits.
      const originalFetch = globalThis.fetch;
      if (kind === "empty" || kind === "truncated") {
        globalThis.fetch = (url, options) => options.method === "PROPFIND" ? originalFetch(url, options) :
          Promise.resolve(kind === "empty" ? new Response(null) : new Response(clip, { headers: { "content-length": String(clip.length + 1) } }));
      }
      if (kind === "file_limit" || kind === "transfer_limit") {
        if (kind === "transfer_limit") mediaPolicy.eventBytes = clip.length - 1;
        globalThis.fetch = (url, options) => options.method === "PROPFIND"
          ? Promise.resolve(new Response(listing().replaceAll(String(clip.length), "1"), { status: 207 }))
          : originalFetch(url, options);
      }
      const put = Client.prototype.uploadFromBytes;
      const finish = storage.finishMedia;
      if (kind === "storage") Client.prototype.uploadFromBytes = async () => { throw new Error("secret URL must not escape"); };
      if (kind === "commit") storage.finishMedia = async () => { throw new Error("secret URL must not escape"); };
      try {
        await startImport(event.id, sources);
        const result = await settled(event.id);
        const failure = result.files[0].failure;
        const codes = { signature: "VALIDATION_FAILED", probe: "VIDEO_INVALID", download: "DOWNLOAD_FAILED",
          storage: "STORAGE_FAILED", commit: "COMMIT_FAILED", empty: "DOWNLOAD_EMPTY", truncated: "DOWNLOAD_TRUNCATED",
          file_limit: "FILE_LIMIT", transfer_limit: "TRANSFER_LIMIT" };
        assert.equal(failure.code, codes[kind], JSON.stringify(result));
        assert.ok(!JSON.stringify(result).includes("secret URL"));
        assert.equal((await storage.getMediaItems(event.id)).length, 0);
        assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.eventId, event.id))).length, 0);
        await storage.cleanupObjects();
      } finally { storage.finishMedia = finish; Client.prototype.uploadFromBytes = put; globalThis.fetch = originalFetch; failDownload = false; }
    });
  }
});

test("error envelopes accept only bounded known codes, preserve historical messages, and never store raw tool output", () => {
  for (const code of ["TOOL_MISSING", "CODEC_UNAVAILABLE", "TOOL_TIMEOUT"]) {
    const failure = importFailure(new VideoAnalysisFailure("probe", code, false), "poster");
    assert.deepEqual(decodeImportFailure(encodeImportFailure(failure)).failure, failure);
  }
  assert.deepEqual(decodeImportFailure("The file could not be imported."), { message: "The file could not be imported." });
  assert.ok(!decodeImportFailure('nc-failure-v1:{"stage":"poster","code":"private URL"}').failure);
});
