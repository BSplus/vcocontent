import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { Readable } from "node:stream";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Client } from "@replit/object-storage";
import { downloadStream } from "../server/media-delivery.ts";
import { fitLowResolution, prepareLowResolution, lowResolutionDownload, LOW_SOURCE_BYTES } from "../server/low-resolution-download.ts";
import { withMediaWorkBudget, MediaBusyError } from "../server/media-work-budget.ts";
import { mockMediaStorage } from "./helpers/memory-media-storage.mjs";

const store = mockMediaStorage();
test.after(() => store.restore());
const key = "media-00000000-0000-4000-8000-000000000000.png";
const item = { id: 42, type: "image", url: `/api/media/files/${key}`, thumbnail: "unreadable-thumbnail" };
async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
const tempFiles = async () => (await readdir(tmpdir())).filter(name => name.startsWith("vco-low-download-")).sort();

test("modern and historical Low-Res read the large photo, orient, never upscale or persist", async () => {
  const source = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#cc8855" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  store.objects.set(key, source);
  const writes = store.writes.length;
  const original = Buffer.from(source);
  for (const photo of [item, { ...item, url: `data:image/jpeg;base64,${source.toString("base64")}` }]) {
    const result = await downloadStream(photo, "low");
    assert.equal(result.contentType, "image/webp");
    assert.equal(result.filename, "media-42-low.webp");
    const bytes = await collect(result.stream);
    assert.ok(bytes.length <= 500_000);
    const m = await sharp(bytes).metadata();
    assert.deepEqual([m.width, m.height], [800, 1600]);
  }
  assert.equal(store.writes.length, writes);
  assert.deepEqual(store.objects.get(key), original);
  const tiny = await sharp({ create: { width: 40, height: 25, channels: 3, background: "red" } }).png().toBuffer();
  store.objects.set(key, tiny);
  const result = await downloadStream(item, "low");
  const bytes = await collect(result.stream);
  const m = await sharp(bytes).metadata();
  assert.deepEqual([m.width, m.height], [40, 25]);
  assert.ok(bytes.length < 10_000, "No minimum size or artificial padding");
});

test("Low-Res quality ladder accepts exact decimal limit before bounded resolution fallback", async () => {
  const calls = [];
  const bytes = await fitLowResolution(async (edge, quality) => {
    calls.push([edge, quality]);
    return Buffer.alloc(quality === 95 ? 500_000 : 500_001);
  });
  assert.equal(bytes.length, 500_000);
  assert.deepEqual(calls, [[1600, 100], [1600, 98], [1600, 95]]);
  calls.length = 0;
  await fitLowResolution(async (edge, quality) => {
    calls.push([edge, quality]);
    return Buffer.alloc(edge === 1280 ? 1 : 500_001);
  });
  assert.deepEqual(calls, [100, 98, 95, 90, 85, 80].map(q => [1600, q]).concat([[1280, 100]]));
  await assert.rejects(fitLowResolution(async () => Buffer.alloc(500_001)), /cannot fit/);
});

test("missing, corrupt, truncated, oversized and pixel-bomb inputs fail with temporary cleanup", async () => {
  const before = await tempFiles();
  store.objects.delete(key);
  await assert.rejects(downloadStream(item, "low"), /Media storage upstream/);
  store.objects.set(key, Buffer.from("not a photo"));
  await assert.rejects(downloadStream(item, "low"));
  const source = await sharp({ create: { width: 400, height: 300, channels: 3, background: "red" } }).png().toBuffer();
  store.objects.set(key, source.subarray(0, source.length - 30));
  await assert.rejects(downloadStream(item, "low"));
  const bomb = await sharp({ create: { width: 6500, height: 6500, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(lowResolutionDownload(() => Readable.from(bomb)));
  await assert.rejects(lowResolutionDownload(() => Readable.from([])), /empty/);
  let emitted = 0;
  const oversized = new Readable({ read() {
    if (emitted++ < 101) this.push(Buffer.alloc(1048576));
    else this.push(null);
  } });
  await assert.rejects(lowResolutionDownload(() => oversized), /input limit/);
  assert.equal(oversized.destroyed, true);
  assert.equal(LOW_SOURCE_BYTES, 100 * 1048576);
  assert.deepEqual(await tempFiles(), before);
});

test("source timeout/abort and stream errors destroy streams and release slots/temp files", async () => {
  const before = await tempFiles();
  const hung = new Readable({ read() {} });
  const controller = new AbortController();
  const work = lowResolutionDownload(() => hung, controller.signal);
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(work);
  assert.equal(hung.destroyed, true);
  const timed = new Readable({ read() {} });
  // AbortSignal.timeout is unref'd; a hung synthetic Readable has no socket
  // keeping Node alive like an actual HTTP download does.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(lowResolutionDownload(() => timed, AbortSignal.timeout(30))); }
  finally { clearTimeout(keepAlive); }
  assert.equal(timed.destroyed, true);
  await assert.rejects(lowResolutionDownload(() => new Readable({ read() { this.destroy(new Error("fixture read error")); } })), /fixture read error/);
  assert.deepEqual(await tempFiles(), before);
});

test("shared CPU slots allow only two readers, bound queue and remove disconnected queued jobs", async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const active = [withMediaWorkBudget(() => hold), withMediaWorkBudget(() => hold)];
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  let opened = 0;
  const queued = controllers.map(c => lowResolutionDownload(() => { opened++; return Readable.from([]); }, c.signal));
  await assert.rejects(lowResolutionDownload(() => Readable.from([])), MediaBusyError);
  assert.equal(opened, 0, "Queued downloads must not open or buffer sources");
  const rejected = queued.map(work => assert.rejects(work));
  controllers.forEach(c => c.abort());
  await Promise.all(rejected);
  release();
  await Promise.all(active);
  assert.equal(await withMediaWorkBudget(async () => "released"), "released");
});

test("storage reader errors do not write objects", async () => {
  const old = Client.prototype.downloadAsStream;
  const writes = store.writes.length;
  Client.prototype.downloadAsStream = () => new Readable({ read() { this.destroy(new Error("offline source")); } });
  try { await assert.rejects(downloadStream(item, "low"), /Media storage upstream/); }
  finally { Client.prototype.downloadAsStream = old; }
  assert.equal(store.writes.length, writes);
});

test("abort during native Sharp encoding is handled without uncaught stream errors or delivery", async () => {
  const controller = new AbortController();
  const old = sharp.prototype.toBuffer;
  let encoding = false;
  sharp.prototype.toBuffer = function(...args) {
    encoding = true;
    const operation = old.apply(this, args);
    setImmediate(() => controller.abort());
    return operation;
  };
  try {
    await assert.rejects(prepareLowResolution("attached_assets/#89_3.png", controller.signal), /failed|cancelled/);
    assert.equal(encoding, true);
  } finally { sharp.prototype.toBuffer = old; }
});
