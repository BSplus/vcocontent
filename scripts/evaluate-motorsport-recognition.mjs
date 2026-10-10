// Opt-in, sequential, shares the existing database-wide vision budget.
// Does not upload media, create jobs, alter references, or publish captions.
// node --import tsx scripts/evaluate-motorsport-recognition.mjs --live --output generated-artifacts/recognition/baseline.json
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures, review } from "../tests/fixtures/motorsport/reviewed.mjs";
import { evaluateRecognition, compareReviewedRuns } from "../tests/helpers/recognition-evaluation.mjs";
import { recognizeMotorsportImage } from "../server/utils/motorsport-recognition.ts";
import { TAG_MODEL } from "../server/utils/ai-tagger.ts";
import { withVisionBudget } from "../server/ai-budget.ts";
import { pool } from "../server/db.ts";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
try {
  if (!process.argv.includes("--live")) throw new Error("Pass --live to authorize up to 16 managed image requests");
  const outputIndex = process.argv.indexOf("--output");
  const output = path.resolve(outputIndex < 0 ? "generated-artifacts/recognition/baseline.json" : process.argv[outputIndex + 1] || "");
  const outputRoot = path.resolve("generated-artifacts/recognition") + path.sep;
  if (!output.startsWith(outputRoot) || path.extname(output) !== ".json")
    throw new Error("Output must be a JSON file under generated-artifacts/recognition");
  // Preflight the whole reviewed set before spending any provider requests.
  const inputs = [];
  for (const fixture of fixtures) {
    const bytes = await readFile(new URL(`../tests/fixtures/motorsport/${fixture.file}`, import.meta.url));
    if (sha(bytes) !== fixture.sha256) throw new Error(`Unreviewed image change: ${fixture.id}`);
    inputs.push({ fixture, bytes });
  }
  const promptSource = await readFile(fileURLToPath(new URL("../server/utils/motorsport-recognition.ts", import.meta.url)));
  const manifest = await readFile(new URL("../tests/fixtures/motorsport/reviewed.mjs", import.meta.url));
  const compareIndex = process.argv.indexOf("--compare");
  const previous = compareIndex < 0 ? null : JSON.parse(await readFile(process.argv[compareIndex + 1], "utf8"));
  if (previous && (previous.reviewedManifestSha256 !== sha(manifest) || previous.samples.length !== fixtures.length ||
      fixtures.some(f => !previous.samples.some(row => row.id === f.id && row.imageSha256 === f.sha256))))
    throw new Error("Comparison requires the same complete reviewed fixture set");
  const rows = [];
  await mkdir(path.dirname(output), { recursive: true });
  const report = () => ({
    evaluatedAt: new Date().toISOString(), model: TAG_MODEL, managedProvider: true,
    recognitionSourceSha256: sha(promptSource), reviewedManifestSha256: sha(manifest),
    review, caveat: "One run per reviewed image. Offline parser success is not model accuracy; no production-wide reanalysis.",
    samples: rows,
  });
  for (const { fixture, bytes } of inputs) {
    const start = performance.now();
    try {
      const result = await withVisionBudget(() => recognizeMotorsportImage(`data:image/webp;base64,${bytes.toString("base64")}`));
      const issues = evaluateRecognition(fixture, result);
      rows.push({ id: fixture.id, imageSha256: fixture.sha256, result, issues, passed: issues.length === 0, ms: Math.round(performance.now() - start) });
    } catch {
      // Never serialize raw provider failures, request bodies, credentials or faces.
      rows.push({ id: fixture.id, imageSha256: fixture.sha256, issues: ["Recognition unavailable or shared budget busy"], passed: false, ms: Math.round(performance.now() - start) });
    }
    await writeFile(output, JSON.stringify(report(), null, 2) + "\n");
    console.log(`${fixture.id}: ${rows.at(-1).passed ? "PASS" : rows.at(-1).issues.join("; ")}`);
  }
  if (previous) await writeFile(output, JSON.stringify({ ...report(), comparison: compareReviewedRuns(previous, report()) }, null, 2) + "\n");
  console.log(`Reviewed checks passed: ${rows.filter(row => row.passed).length}/${rows.length}. Report: ${path.relative(process.cwd(), output)}`);
  if (rows.some(row => !row.passed)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error && /^(Pass --live|Output must|Unreviewed image|Comparison requires)/.test(error.message) ? error.message : "Evaluation could not be completed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
