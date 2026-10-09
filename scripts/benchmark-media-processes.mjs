// Reproducible local pipeline experiment. Uses production image conversion but
// simulated storage (20 ms/object) and AI (250 ms/image), NOT production timings.
// Run: node --import tsx scripts/benchmark-media-processes.mjs
import sharp from "sharp";
import { Client } from "@replit/object-storage";
import { mkdtemp, writeFile, stat, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { uploadMedia } from "../server/media-storage.ts";

const scenarioFlag = process.argv.find(a => a.startsWith("--scenario="))?.split("=")[1];
const modeFlag = process.argv.find(a => a.startsWith("--mode="))?.split("=")[1];
if (!scenarioFlag) {
  // Isolate native allocations and warm caches between before/after cases.
  const results = [];
  for (const scenario of ["images", "video", "mixed"]) for (const mode of ["before_serial", "after_two_transfers_separate_ai"]) {
    const { stdout } = await promisify(execFile)(process.execPath,
      ["--import", "tsx", import.meta.filename || new URL(import.meta.url).pathname,
        `--scenario=${scenario}`, `--mode=${mode}`], { timeout: 60000, maxBuffer: 1024 * 1024 });
    results.push(...JSON.parse(stdout).results);
  }
  console.log(JSON.stringify({ environment: "local controlled experiment; isolated process per case",
    simulatedAI_ms: 250, simulatedObjectWrite_ms: 20, conversion: "production uploadMedia + sharp",
    videoCaveat: "50 MiB signature fixture exercises the current byte/persistence path, not video decoding",
    results }, null, 2));
  process.exit(0);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = await mkdtemp(path.join(tmpdir(), "vco-benchmark-"));
const originalUpload = Client.prototype.uploadFromFilename;
const originalDelete = Client.prototype.delete;
const originalBytes = Client.prototype.uploadFromBytes;
let bytes = 0;
Client.prototype.uploadFromFilename = async (_key, filename) => {
  bytes += (await stat(filename)).size; await sleep(20); return { ok: true, value: undefined };
};
Client.prototype.delete = async () => ({ ok: true, value: undefined });
Client.prototype.uploadFromBytes = async (_key, data) => {
  bytes += data.length; await sleep(20); return { ok: true, value: undefined };
};
try {
  const samples = [];
  for (const name of ["#89_3.png", "IMG_7464.png"]) {
    const destination = path.join(dir, name);
    await writeFile(destination, await readFile(path.join("attached_assets", name)));
    samples.push({ name, data: await readFile(destination), type: "image", file: { path: destination, size: (await stat(destination)).size, mimetype: "image/png" } });
  }
  const videoPath = path.join(dir, "video.mp4");
  const video = Buffer.alloc(50 * 1048576);
  Buffer.from("000000186674797069736f6d0000020069736f6d6d703431", "hex").copy(video);
  await writeFile(videoPath, video);
  samples.push({ name: "50MiB container-signature fixture (not playable)", data: video, type: "video",
    file: { path: videoPath, size: video.length, mimetype: "video/mp4" } });
  const results = [];
  for (const scenario of [
    { name: "images", files: samples.slice(0, 2) },
    { name: "video", files: [samples[2]] },
    { name: "mixed", files: [samples[0], samples[2], samples[1]] },
  ]) {
    if (scenario.name !== scenarioFlag) continue;
    for (const mode of ["before_serial", "after_two_transfers_separate_ai"]) {
      if (mode !== modeFlag) continue;
      // uploadMedia consumes its temporary input, just like a real upload.
      for (const sample of scenario.files) await writeFile(sample.file.path, sample.data);
      bytes = 0; let calls = 0, peakRss = process.memoryUsage().rss;
      const memoryStart = process.memoryUsage().rss;
      const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 5);
      const start = performance.now();
      const savedAt = [], analyzedAt = [], analyses = [];
      const transfer = async sample => {
        const saved = await uploadMedia(sample.file, sample.type);
        savedAt.push({ name: sample.name, ms: Math.round(performance.now() - start), highBytes: saved.highBytes, lowBytes: saved.lowBytes });
        const analyze = async () => { if (sample.type === "image") { calls++; await sleep(250); }
          analyzedAt.push({ name: sample.name, ms: Math.round(performance.now() - start) }); };
        if (mode === "before_serial") await analyze();
        else if (sample.type === "image") {
          // Two independent AI workers; at most two calls active.
          analyses.push(analyze());
        } else await analyze();
      };
      try {
        if (mode === "before_serial") for (const sample of scenario.files) await transfer(sample);
        else {
          let cursor = 0;
          await Promise.all(Array.from({ length: 2 }, async () => {
            while (cursor < scenario.files.length) await transfer(scenario.files[cursor++]);
          }));
        }
        const allStoredMs = Math.max(...savedAt.map(s => s.ms));
        await Promise.all(analyses);
        results.push({ scenario: scenario.name, mode, allStoredMs, allAnalyzedMs: Math.round(performance.now() - start),
          inputBytes: scenario.files.reduce((n, s) => n + s.file.size, 0), objectWriteBytes: bytes,
          aiCalls: calls, errors: 0, peakRssMiB: Math.round(peakRss / 1048576), rssIncreaseMiB: Math.round((peakRss - memoryStart) / 1048576),
          savedAt, analyzedAt });
      } finally { clearInterval(timer); }
    }
  }
  console.log(JSON.stringify({ environment: "local controlled experiment", simulatedAI_ms: 250,
    simulatedObjectWrite_ms: 20, conversion: "production uploadMedia + sharp",
    videoCaveat: "50 MiB signature fixture exercises the current byte/persistence path, not video decoding",
    results }, null, 2));
} finally {
  Client.prototype.uploadFromFilename = originalUpload; Client.prototype.delete = originalDelete;
  Client.prototype.uploadFromBytes = originalBytes;
  await rm(dir, { recursive: true, force: true });
}
