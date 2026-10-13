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
const event = { id: 7, title: "Ä Nürburgring / Finale", date: new Date("2026-10-13T00:00:00Z") };
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
    const result = await downloadStream(photo, event, "low");
    assert.equal(result.contentType, "image/jpeg");
    assert.equal(result.filename, "vco_2026-10-13_ae-nuerburgring-finale_m42_low.jpg");
    const bytes = await collect(result.stream);
    assert.ok(bytes.length <= 500_000);
    const m = await sharp(bytes).metadata();
    assert.equal(m.format, "jpeg");
    assert.deepEqual([...bytes.subarray(0, 3)], [255, 216, 255]);
    await sharp(bytes).stats();
    assert.deepEqual([m.width, m.height], [800, 1600]);
  }
  assert.equal(store.writes.length, writes);
  assert.deepEqual(store.objects.get(key), original);
  const tiny = await sharp({ create: { width: 40, height: 25, channels: 3, background: "red" } }).png().toBuffer();
  store.objects.set(key, tiny);
  const result = await downloadStream(item, event, "low");
  const bytes = await collect(result.stream);
  const m = await sharp(bytes).metadata();
  assert.deepEqual([m.width, m.height], [40, 25]);
  assert.ok(bytes.length < 10_000, "No minimum size or artificial padding");
});

test("high delivery preserves modern and historical photo/video bytes and actual extensions", async () => {
  for (const [mime, extension] of [
    ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"], ["image/gif", "gif"],
    ["video/mp4", "mp4"], ["video/quicktime", "mov"], ["video/webm", "webm"],
  ]) {
    const bytes = mime.startsWith("image/")
      ? await sharp({ create: { width: 20, height: 30, channels: 3, background: "#887744" } })
        .toFormat(extension === "jpg" ? "jpeg" : extension).toBuffer()
      : Buffer.from(`unchanged video fixture ${mime}`);
    const sourceKey = `media-00000000-0000-4000-8000-000000000000.${extension}`;
    store.objects.set(sourceKey, bytes);
    for (const url of [`/api/media/files/${sourceKey}`, `data:${mime};base64,${bytes.toString("base64")}`]) {
      const result = await downloadStream({ ...item, type: mime.startsWith("video/") ? "video" : "image", url }, event, "high");
      assert.equal(result.contentType, mime);
      assert.equal(result.filename, `vco_2026-10-13_ae-nuerburgring-finale_m42_high.${extension}`);
      assert.deepEqual(await collect(result.stream), bytes);
    }
  }
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

test("transparent PNG and WebP flatten onto white in a fully decodable JPEG", async () => {
  for (const format of ["png", "webp"]) {
    const input = await sharp({ create: { width: 40, height: 25, channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 } } })[format]().toBuffer();
    const bytes = await prepareLowResolution(input, new AbortController().signal);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.hasAlpha, false);
    assert.deepEqual([metadata.width, metadata.height], [40, 25]);
    const pixels = await sharp(bytes).raw().toBuffer();
    assert.ok(pixels.every(value => value >= 254));
  }
});

test("detail-rich deterministic input uses real JPEG resolution fallback without severe compression", async () => {
  const width = 1800, height = 1200, raw = Buffer.alloc(width * height * 3);
  let seed = 73;
  for (let i = 0; i < raw.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    raw[i] = Math.floor((seed >>> 24) * 160 / 256);
  }
  const input = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const output = await prepareLowResolution(input, new AbortController().signal);
  assert.ok(output.length <= 500_000);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.deepEqual([metadata.width, metadata.height], [960, 640]);
  const reference = await sharp(input).resize(metadata.width, metadata.height).raw().toBuffer();
  const decoded = await sharp(output).raw().toBuffer();
  let mse = 0;
  for (let i = 0; i < reference.length; i++) mse += (reference[i] - decoded[i]) ** 2;
  mse /= reference.length;
  assert.ok(10 * Math.log10(255 ** 2 / mse) > 25, "Detail-rich resized reference retains >25 dB PSNR");
});

test("uncompressible detail fails explicitly instead of exceeding the JPEG byte budget", async () => {
  const width = 960, height = 960, raw = Buffer.alloc(width * height * 3);
  let seed = 19;
  for (let i = 0; i < raw.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    raw[i] = seed >>> 24;
  }
  const input = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  await assert.rejects(prepareLowResolution(input, new AbortController().signal), /cannot fit.*High-Res/);
});

test("missing, corrupt, truncated, oversized and pixel-bomb inputs fail with temporary cleanup", async () => {
  const before = await tempFiles();
  store.objects.delete(key);
  await assert.rejects(downloadStream(item, event, "low"), /Media storage upstream/);
  store.objects.set(key, Buffer.from("not a photo"));
  await assert.rejects(downloadStream(item, event, "low"));
  const source = await sharp({ create: { width: 400, height: 300, channels: 3, background: "red" } }).png().toBuffer();
  store.objects.set(key, source.subarray(0, source.length - 30));
  await assert.rejects(downloadStream(item, event, "low"));
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
  try { await assert.rejects(downloadStream(item, event, "low"), /Media storage upstream/); }
  finally { Client.prototype.downloadAsStream = old; }
  assert.equal(store.writes.length, writes);
});

test("abort during native Sharp encoding is handled without uncaught stream errors or delivery", async () => {
  const source = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#774433" } }).png().toBuffer();
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
    await assert.rejects(prepareLowResolution(source, controller.signal), /failed|cancelled/);
    assert.equal(encoding, true);
  } finally { sharp.prototype.toBuffer = old; }
});

test("cancelled native JPEG work retains its CPU slot until its bounded operation settles", async () => {
  const source = await sharp({ create: { width: 40, height: 25, channels: 3, background: "red" } }).png().toBuffer();
  const controller = new AbortController();
  const old = sharp.prototype.toBuffer;
  let started, release;
  const encodingStarted = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  sharp.prototype.toBuffer = async function(...args) {
    const result = await old.apply(this, args);
    started();
    await held;
    return result;
  };
  let releaseOther;
  const other = withMediaWorkBudget(() => new Promise(resolve => { releaseOther = resolve; }));
  const encoding = lowResolutionDownload(() => Readable.from(source), controller.signal);
  const rejection = assert.rejects(encoding, /cancelled/);
  let ran = false;
  let queued;
  try {
    await encodingStarted;
    controller.abort();
    queued = withMediaWorkBudget(async () => { ran = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ran, false, "Aborting must not free the still-active native slot");
    release();
    await rejection;
    await queued;
    assert.equal(ran, true);
  } finally {
    release();
    releaseOther();
    await Promise.allSettled([encoding, other, ...(queued ? [queued] : [])]);
    sharp.prototype.toBuffer = old;
  }
});
