// Development-only child process. Never used by the app or deployment command.
// Real routes, DB queue, sampling and image conversion; fake storage/provider.
import express from "express";
import { once } from "node:events";
import { appendFile, readFile, copyFile, mkdir, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Client } from "@replit/object-storage";
import { eq } from "drizzle-orm";
import { db, pool } from "../../server/db.ts";
import { storage } from "../../server/storage.ts";
import { registerRoutes } from "../../server/routes.ts";
import { stopAnalysisWorker } from "../../server/analysis-jobs.ts";
import { stopImportWorker } from "../../server/nextcloud.ts";
import { mediaAnalysisJobs } from "../../shared/schema.ts";

if (process.env.NODE_ENV === "production") throw new Error("Worker fixture is development-only");
const [directory, ownerId, mode] = process.argv.slice(2);
if (!directory || !ownerId || !["normal", "interrupt"].includes(mode)) throw new Error("Fixture arguments missing");
const owner = await storage.getUser(Number(ownerId));
if (!owner) throw new Error("Disposable fixture owner missing");
const objectDir = path.join(directory, "objects");
await mkdir(objectDir, { recursive: true });
Client.prototype.uploadFromFilename = async (key, filename) => {
  await copyFile(filename, path.join(objectDir, key)); return { ok: true };
};
Client.prototype.uploadFromBytes = async (key, bytes) => {
  await writeFile(path.join(objectDir, key), bytes); return { ok: true };
};
Client.prototype.downloadAsStream = key => createReadStream(path.join(objectDir, key));
Client.prototype.delete = async () => ({ ok: true }); // Parent deletes its isolated fixture directory.
// Dummy values only. No real provider credentials or requests are used.
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://worker-fixture.invalid/v1";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "fixture-only";
const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (input, options) => {
  if (!String(input).startsWith("https://worker-fixture.invalid/")) return realFetch(input, options);
  const request = JSON.parse(options.body);
  const content = request.messages.at(-1).content;
  const images = Array.isArray(content) ? content.filter(c => c.type === "image_url") : [];
  const video = request.max_tokens === 2400;
  calls++;
  await appendFile(path.join(directory, "requests.jsonl"), JSON.stringify({
    pid: process.pid, video, hashes: images.map(f => createHash("sha256").update(f.image_url.url).digest("hex")),
  }) + "\n");
  if (mode === "interrupt" && video && calls === 2) {
    process.send?.({ type: "interrupt-ready" });
    await new Promise(() => {}); // Parent SIGKILLs after the first batch is persisted.
  }
  await new Promise(resolve => setTimeout(resolve, 2000));
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: video
    ? JSON.stringify({ frames: images.map((_, index) => ({ index, tags: ["Day", "Race Car"], vehicles: [] })) })
    : "Day, Race Car" } }], usage: { prompt_tokens: 200, completion_tokens: 100 } }),
  { headers: { "content-type": "application/json" } });
};

const app = express();
app.use(express.json());
// Test-only auth context on an ephemeral loopback server, just like ingestion tests.
app.use((req, _res, next) => { req.user = owner; req.isAuthenticated = () => true; next(); });
const server = await registerRoutes(app);
await stopImportWorker();
server.listen(0, "127.0.0.1");
await once(server, "listening");
process.send?.({ type: "ready", port: server.address().port, pid: process.pid });
process.on("message", async message => {
  try {
    if (message.type === "status") {
      const results = [];
      for (const id of message.ids) {
        const [job] = await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, id));
        results.push({ id, status: job?.status ?? "not_requested", attempts: job?.attempts,
          frames: job?.videoEvidence?.frames.length, requests: job?.videoEvidence?.providerRequests });
      }
      process.send?.({ type: "status", results });
    }
    if (message.type === "stop") {
      await stopAnalysisWorker();
      server.close(); await once(server, "close");
      await pool.end(); process.exit(0);
    }
  } catch (error) {
    console.error(error.message); process.exit(1);
  }
});
