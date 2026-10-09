// Explicit opt-in: makes 3 managed OpenAI requests per sample. Never changes media.
// node --import tsx scripts/compare-vision-strategies.mjs --live
import sharp from "sharp";
import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getOpenAIClient, generateTagsForImage, detectRaceNumbers, parseTagResponse } from "../server/utils/ai-tagger.ts";
if (!process.argv.includes("--live")) throw new Error("Pass --live to authorize this bounded comparison (6 provider calls)");
const client = getOpenAIClient();
if (!client) throw new Error("Managed AI is not configured");
const dir = await mkdtemp(path.join(tmpdir(), "vco-ocr-"));
const realFetch = globalThis.fetch;
let usage = [];
globalThis.fetch = async (...args) => {
  const response = await realFetch(...args);
  const json = await response.clone().json().catch(() => ({}));
  usage.push(json.usage || null);
  return response;
};
const samples = [
  { file: "#89_3.png", knownNumbers: ["89"], requiredTags: ["Front View", "Day", "Dry Track"] },
  { file: "IMG_7464.png", knownNumbers: [], requiredTags: ["Group", "Day", "Dry Track"] },
];
const run = async work => {
  usage = []; const start = performance.now();
  try { return { result: await work(), ms: Math.round(performance.now() - start), usage: [...usage] }; }
  catch { return { error: "Strategy unavailable", ms: Math.round(performance.now() - start), usage: [...usage] }; }
};
try {
  const results = [];
  for (const sample of samples) {
    // All approaches use exactly the same production-sized 640px thumbnail.
    const thumb = await sharp(path.join("attached_assets", sample.file)).rotate()
      .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
    const input = `data:image/webp;base64,${thumb.toString("base64")}`;
    const baseline = await run(async () => ({ tags: await generateTagsForImage(input), ...await detectRaceNumbers(input) }));
    const combined = await run(async () => {
      const result = await getOpenAIClient().chat.completions.create({
        model: "gpt-4.1-mini", response_format: { type: "json_object" }, max_tokens: 350,
        messages: [
          { role: "system", content: 'Analyze racing imagery. Return JSON only: {"tags":[],"numbers":[],"scene":null}. Allowed tags: Front View, Rear View, Aerial View, Side View, Onboard View, Group, Crash, Atmosphere, Day, Night, Rain, Wet Track, Dry Track, GT Car, Formula Car, Prototype, Vintage. Only include clearly supported tags. Numbers must be clearly legible car race numbers, never sponsors, signs or guessed numbers. Numbers 1-4 digits, scene Race Action, Start, Finish or null. Return empty numbers if unreadable; never infer a start or finish.' },
          { role: "user", content: [{ type: "image_url", image_url: { url: input } }] },
        ],
      }, { timeout: 20000, maxRetries: 0 });
      const parsed = JSON.parse(result.choices[0]?.message?.content || "{}");
      return { tags: parseTagResponse((parsed.tags || []).join(",")),
        numbers: Array.isArray(parsed.numbers) ? parsed.numbers.filter(n => typeof n === "string" && /^\d{1,4}$/.test(n)) : [],
        scene: parsed.scene || null };
    });
    const filename = path.join(dir, "sample.png");
    await sharp(thumb).png().toFile(filename);
    const ocr = await run(async () => {
      const { stdout } = await promisify(execFile)("tesseract", [filename, "stdout", "--psm", "11"],
        { timeout: 15000, maxBuffer: 1024 * 1024 });
      // Deliberately literal number extraction; no semantic car-vs-sponsor
      // filter. A production approach would need detection/cropping as well.
      return { numbers: [...new Set(stdout.match(/\b\d{1,4}\b/g) || [])], tags: null, scene: null };
    });
    results.push({ sample: sample.file, knownNumbers: sample.knownNumbers, requiredTags: sample.requiredTags,
      thumbnailBytes: thumb.length, baseline, combined, ocr });
  }
  console.log(JSON.stringify({ caveat: "Two VCO photos, single run; not a general accuracy or pricing benchmark",
    cost: "Token usage when supplied by the provider; no inferred currency cost", results }, null, 2));
} finally { globalThis.fetch = realFetch; await rm(dir, { recursive: true, force: true }); }
