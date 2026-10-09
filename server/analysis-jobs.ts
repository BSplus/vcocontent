import { createHash, randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { mediaAnalysisJobs, mediaItems } from "@shared/schema";
import { analysisImageInput } from "./image-analysis";
import { categorizeContent, generateTagsForImage, isAITaggingConfigured } from "./utils/ai-tagger";
import { withVisionBudget, VisionBusy } from "./ai-budget";

// Database-wide budget, including multiple server processes. SDK retries are
// disabled: only this queue owns retry/backoff and the persisted attempt count.
const LOCK = 761020;
const MAX_ACTIVE = 2;
const MAX_PENDING = 1000;
const MAX_ATTEMPTS = 3;
const VERSION = "tags-v1";
export const analysisFingerprint = (thumbnail: string) =>
  createHash("sha256").update(`${VERSION}:${thumbnail}`).digest("hex");
type Item = { id: number; type: string; thumbnail: string };
export class AnalysisUnavailable extends Error {}

export async function analysisStatus(mediaId: number) {
  const [job] = await db.select({
    status: mediaAnalysisJobs.status, attempts: mediaAnalysisJobs.attempts,
    generatedTags: mediaAnalysisJobs.generatedTags, error: mediaAnalysisJobs.error,
    durationMs: mediaAnalysisJobs.durationMs,
  }).from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, mediaId));
  return job || { status: "not_requested", attempts: 0, error: null, generatedTags: null };
}

export async function enqueueAnalysis(item: Item, retry = false) {
  if (item.type !== "image") throw new AnalysisUnavailable("Video frame analysis is not available");
  if (!isAITaggingConfigured()) throw new AnalysisUnavailable("AI tagging is not configured");
  const fingerprint = analysisFingerprint(item.thumbnail);
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
    const [existing] = await tx.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id));
    if (existing?.fingerprint === fingerprint &&
        (!retry || existing.status !== "failed")) return;
    const pending = await tx.execute(sql`select count(*)::int as count from media_analysis_jobs
      where status in ('queued', 'running')`);
    if (Number(pending.rows[0]?.count) >= MAX_PENDING)
      throw new AnalysisUnavailable("Analysis queue is full. Please retry later.");
    const values = { mediaId: item.id, fingerprint, status: "queued", attempts: 0,
      workerToken: null, generatedTags: null, error: null, durationMs: null,
      availableAt: new Date(), updatedAt: new Date() };
    await tx.insert(mediaAnalysisJobs).values(values).onConflictDoUpdate({
      target: mediaAnalysisJobs.mediaId, set: values,
    });
  });
  void kickAnalysisWorker();
  return analysisStatus(item.id);
}

async function claimAnalysis() {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
    // Expired attempts are recoverable after process termination, but have a
    // finite budget. Fencing below prevents a late response from winning.
    await tx.execute(sql`update media_analysis_jobs set status = case when attempts >= ${MAX_ATTEMPTS}
      then 'failed' else 'queued' end, worker_token = null,
      error = 'Analysis was interrupted. Retry is available.', available_at = now()
      where status = 'running' and updated_at < now() - interval '90 seconds'`);
    const active = await tx.execute(sql`select count(*)::int as count from media_analysis_jobs where status='running'`);
    if (Number(active.rows[0]?.count) >= MAX_ACTIVE) return undefined;
    const token = randomUUID();
    const result = await tx.execute(sql`update media_analysis_jobs set status='running',
      attempts=attempts+1, worker_token=${token}, updated_at=now()
      where media_id = (select media_id from media_analysis_jobs where status='queued'
      and available_at <= now() order by available_at, media_id for update skip locked limit 1)
      returning media_id, fingerprint, attempts`);
    const row = result.rows[0];
    return row ? { mediaId: Number(row.media_id), fingerprint: String(row.fingerprint),
      attempts: Number(row.attempts), token } : undefined;
  });
}

// Exported to permit deterministic worker tests (including restart recovery).
export async function drainAnalysisQueue() {
  const claimed = await claimAnalysis();
  if (!claimed) return false;
  const started = Date.now();
  try {
    const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, claimed.mediaId));
    if (!item) return true;
    const input = await analysisImageInput(item.thumbnail);
    const tags = await withVisionBudget(() => generateTagsForImage(input));
    if (!tags.length) throw new Error("No approved tags");
    await db.transaction(async tx => {
      const [owned] = await tx.select().from(mediaAnalysisJobs)
        .where(and(eq(mediaAnalysisJobs.mediaId, item.id), eq(mediaAnalysisJobs.workerToken, claimed.token))).for("update");
      if (!owned || owned.fingerprint !== claimed.fingerprint) return;
      // Atomic union against the latest row, not the pre-request snapshot.
      // Captions are deliberately never updated by this worker.
      const [updated] = await tx.update(mediaItems).set({
        tags: sql`array(select distinct unnest(coalesce(${mediaItems.tags}, array[]::text[]) || ${sql`array[${sql.join(tags.map(t => sql`${t}`), sql`, `)}]::text[]`}))`,
      }).where(eq(mediaItems.id, item.id)).returning();
      await tx.update(mediaItems).set({ category: await categorizeContent(updated.tags || []) }).where(eq(mediaItems.id, item.id));
      await tx.update(mediaAnalysisJobs).set({ status: "completed", generatedTags: tags,
        workerToken: null, error: null, updatedAt: new Date(), durationMs: Date.now() - started })
        .where(eq(mediaAnalysisJobs.mediaId, item.id));
    });
  } catch (error) {
    const busy = error instanceof VisionBusy;
    const terminal = !busy && claimed.attempts >= MAX_ATTEMPTS;
    await db.update(mediaAnalysisJobs).set({
      status: terminal ? "failed" : "queued", workerToken: null,
      attempts: busy ? claimed.attempts - 1 : claimed.attempts,
      error: terminal ? "AI analysis failed. Your media and manual tags are safe; retry is available."
        : "AI temporarily unavailable. Retrying in the background.",
      availableAt: new Date(Date.now() + (busy ? 5000 : 15000 * claimed.attempts)),
      updatedAt: new Date(), durationMs: Date.now() - started,
    }).where(and(eq(mediaAnalysisJobs.mediaId, claimed.mediaId), eq(mediaAnalysisJobs.workerToken, claimed.token)));
  }
  return true;
}

let timer: NodeJS.Timeout | undefined;
let running = false;
const inFlight = new Set<Promise<unknown>>();
export function kickAnalysisWorker() {
  const work = drainAnalysisQueue().catch(() => { console.error("Analysis queue unavailable"); return false; });
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
  return work;
}
export function startAnalysisWorker() {
  if (running) return;
  running = true;
  const tick = async () => {
    const active = await Promise.all(Array.from({ length: MAX_ACTIVE }, () => kickAnalysisWorker()));
    if (!running) return;
    timer = setTimeout(tick, active.some(Boolean) ? 1000 : 30000);
    timer.unref();
  };
  void tick();
}

export async function stopAnalysisWorker() {
  running = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
  await Promise.allSettled(Array.from(inFlight));
}
