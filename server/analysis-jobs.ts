import { createHash, randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { mediaAnalysisJobs, mediaItems, events } from "@shared/schema";
import { analysisImageInput, recognitionImageInput } from "./image-analysis";
import { categorizeContent, generateTagsForImage, isAITaggingConfigured } from "./utils/ai-tagger";
import { recognizeMotorsportImage } from "./utils/motorsport-recognition";
import { identifyEntries } from "./reference-matching";
import { withVisionBudget, VisionBusy } from "./ai-budget";

// Database-wide budget, including multiple server processes. SDK retries are
// disabled: only this queue owns retry/backoff and the persisted attempt count.
const LOCK = 761020;
const MAX_ACTIVE = 2;
const MAX_PENDING = 1000;
const MAX_ATTEMPTS = 3;
const VERSION = "recognition-v2";
export const analysisFingerprint = (thumbnail: string) =>
  createHash("sha256").update(`${VERSION}:${thumbnail}`).digest("hex");
type Item = { id: number; type: string; thumbnail: string };
export class AnalysisUnavailable extends Error {}

export async function analysisStatus(mediaId: number) {
  const [job] = await db.select({
    status: sql<string>`case when ${mediaAnalysisJobs.status}='completed' and ${mediaAnalysisJobs.recognition} is not null
      and coalesce(${events.referenceRevision},0)>${mediaAnalysisJobs.referenceRevision}
      then 'queued' else ${mediaAnalysisJobs.status} end`, attempts: mediaAnalysisJobs.attempts,
    generatedTags: mediaAnalysisJobs.generatedTags, error: mediaAnalysisJobs.error,
    durationMs: mediaAnalysisJobs.durationMs,
    generation: mediaAnalysisJobs.generation,
  }).from(mediaAnalysisJobs).leftJoin(mediaItems,eq(mediaItems.id,mediaAnalysisJobs.mediaId))
    .leftJoin(events,eq(events.id,mediaItems.eventId)).where(eq(mediaAnalysisJobs.mediaId, mediaId));
  return job || { status: "not_requested", attempts: 0, error: null, generatedTags: null };
}

export async function enqueueAnalysis(item: Item, options: boolean | { retry?: boolean; reanalyse?: boolean; recognition?: boolean } = false, legacyReanalyse = false) {
  const settings = typeof options === "boolean" ? { retry: options, reanalyse: legacyReanalyse } : options;
  if (item.type !== "image") throw new AnalysisUnavailable("Video frame analysis is not available");
  if (!isAITaggingConfigured()) throw new AnalysisUnavailable("AI tagging is not configured");
  const fingerprint = (settings.recognition ? "recognition:" : "tags:") + analysisFingerprint(item.thumbnail);
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
    const [existing] = await tx.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id));
    if (existing && (existing.status === "queued" || existing.status === "running")) return;
    if (existing?.fingerprint === fingerprint && !settings.reanalyse &&
        (!settings.retry || existing.status !== "failed")) return;
    const pending = await tx.execute(sql`select count(*)::int as count from media_analysis_jobs
      where status in ('queued', 'running')`);
    if (Number(pending.rows[0]?.count) >= MAX_PENDING)
      throw new AnalysisUnavailable("Analysis queue is full. Please retry later.");
    const values = { mediaId: item.id, fingerprint, status: "queued", attempts: 0,
      workerToken: null, generatedTags: existing?.generatedTags || null, recognition: existing?.recognition || null,
      referenceOnly: false, generation: (existing?.generation || 0) + 1, error: null, durationMs: null,
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
    const result = await tx.execute(sql`update media_analysis_jobs set
      reference_only = (status='completed' or reference_only),
      generation=case when status='completed' then generation+1 else generation end,
      attempts=case when status='completed' then 1 else attempts+1 end,
      status='running', worker_token=${token}, updated_at=now()
      where media_id = (select j.media_id from media_analysis_jobs j
        left join media_items m on m.id=j.media_id left join events e on e.id=m.event_id
        where (j.status='queued' and j.available_at<=now()) or
          (j.status='completed' and j.recognition is not null and e.reference_revision>j.reference_revision)
        order by case when j.status='queued' then 0 else 1 end,j.available_at,j.media_id
        for update of j skip locked limit 1)
      returning media_id, fingerprint, attempts, reference_only, recognition, generated_tags`);
    const row = result.rows[0];
    return row ? { mediaId: Number(row.media_id), fingerprint: String(row.fingerprint),
      attempts: Number(row.attempts), referenceOnly: Boolean(row.reference_only),
      recognition: row.recognition as import("@shared/schema").Identification[] | null,
      generatedTags: row.generated_tags as string[] | null, token } : undefined;
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
    const tagOnly = claimed.fingerprint.startsWith("tags:");
    const prefix = tagOnly ? "tags:" : claimed.fingerprint.startsWith("recognition:") ? "recognition:" : "";
    if (claimed.fingerprint !== prefix + analysisFingerprint(item.thumbnail)) {
      // Upgrade only jobs already requested, never mass-retag completed media.
      claimed.fingerprint = prefix + analysisFingerprint(item.thumbnail);
      await db.update(mediaAnalysisJobs).set({fingerprint:claimed.fingerprint})
        .where(and(eq(mediaAnalysisJobs.mediaId,item.id),eq(mediaAnalysisJobs.workerToken,claimed.token)));
    }
    const result = claimed.referenceOnly && claimed.recognition
      ? { tags: claimed.generatedTags || [], vehicles: claimed.recognition }
      : tagOnly
        ? { tags: await withVisionBudget(async () => generateTagsForImage(await analysisImageInput(item.thumbnail))), vehicles: null }
        : await withVisionBudget(async () => recognizeMotorsportImage(await recognitionImageInput(item)));
    const tags = result.tags;
    await db.transaction(async tx => {
      const [owned] = await tx.select().from(mediaAnalysisJobs)
        .where(and(eq(mediaAnalysisJobs.mediaId, item.id), eq(mediaAnalysisJobs.workerToken, claimed.token))).for("update");
      if (!owned || owned.fingerprint !== claimed.fingerprint) return;
      const [current] = await tx.select().from(mediaItems).where(eq(mediaItems.id,item.id)).for("update");
      if (!current || prefix + analysisFingerprint(current.thumbnail) !== claimed.fingerprint) return;
      const [event] = current.eventId ? await tx.select().from(events).where(eq(events.id,current.eventId)) : [];
      // Track future tag provenance. Legacy curation cannot be reconstructed:
      // conservatively preserve it rather than deleting possibly manual tags.
      const manualTags = Array.from(new Set([...current.manualTags,...(current.tags || []).filter(t=>
        !owned.recognition || !(owned.generatedTags || []).includes(t))]));
      let freshTags=tags.filter(t=>!current.suppressedAITags.includes(t));
      const opposites=[["Day","Night"],["Dry Track","Wet Track"],["Dry Track","Rain"]] as const;
      for (const [a,b] of opposites) {
        if (manualTags.includes(a)) freshTags=freshTags.filter(t=>t!==b);
        if (manualTags.includes(b)) freshTags=freshTags.filter(t=>t!==a);
      }
      const merged = claimed.referenceOnly ? current.tags || [] : Array.from(new Set([...manualTags,...freshTags])).slice(0,100);
      const identification = current.identificationManual || !result.vehicles ? current.identification : event
        ? await identifyEntries(event,result.vehicles,current.recognitionSession,tx) : result.vehicles;
      await tx.update(mediaItems).set({ tags: merged, identification,
        ...(claimed.referenceOnly ? {} : {manualTags}),
        ...(claimed.referenceOnly ? {} : {category:await categorizeContent(merged)}) }).where(eq(mediaItems.id,item.id));
      await tx.update(mediaAnalysisJobs).set({ status: "completed", generatedTags: tags,
        recognition: result.vehicles, referenceRevision: event?.referenceRevision || 0, referenceOnly: false,
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
