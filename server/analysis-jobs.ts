import { createHash, randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { takeBetaRate } from "./beta-policy";
import { reviewMediaSafety } from "./content-safety";
import { mediaAnalysisJobs, mediaItems, events, series } from "@shared/schema";
import { analysisImageInput, recognitionImageInput } from "./image-analysis";
import { categorizeContent, generateTagsForImage, isAITaggingConfigured } from "./utils/ai-tagger";
import { recognizeMotorsportImage } from "./utils/motorsport-recognition";
import {supportedPhotoObservations} from "./utils/photo-number-evidence";
import { identifyEntries } from "./reference-matching";
import { withVisionBudget, VisionBusy } from "./ai-budget";
import { sampleVideo, SAMPLING_VERSION, cleanupVideoTemps } from "./video-sampling";
import { aggregateVideo, recognizeVideoBatch, type VideoEvidence } from "./video-recognition";
import { classifyVideoFailure, videoFailureRecord, type VideoFailureStage } from "./video-failures";
import { communityCaption, matchedPhotoCaption } from "./caption-proposal";
import { storage } from "./storage";
import { videoFrameThumbnail } from "./video-preview";

// Database-wide budget, including multiple server processes. SDK retries are
// disabled: only this queue owns retry/backoff and the persisted attempt count.
const LOCK = 761020;
// Operators may lower (never raise) the database-wide job budget on a small VM.
// All processes sharing this queue must use the same setting.
const MAX_ACTIVE = Number(process.env.MEDIA_ANALYSIS_CONCURRENCY ?? "2");
if (![1, 2].includes(MAX_ACTIVE)) {
  throw new Error("MEDIA_ANALYSIS_CONCURRENCY must be 1 or 2");
}
const MAX_PENDING = 1000;
const MAX_ATTEMPTS = 3;
const VERSION = "recognition-v2";
export const analysisFingerprint = (thumbnail: string) =>
  createHash("sha256").update(`${VERSION}:${thumbnail}`).digest("hex");
type Item = { id: number; type: string; thumbnail: string; url: string };
export const itemAnalysisFingerprint = (item: Item, recognition = false) => item.type === "video"
  ? "video:" + createHash("sha256").update(`${SAMPLING_VERSION}:recognition-v1:${item.url}`).digest("hex")
  : (recognition ? "recognition:" : "tags:") + analysisFingerprint(item.thumbnail);
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

export async function enqueueAnalysis(item: Item, options: boolean | { retry?: boolean; reanalyse?: boolean; recognition?: boolean; photoWorkflow?: boolean; replacePreserved?: boolean } = false, legacyReanalyse = false) {
  const settings = typeof options === "boolean" ? { retry: options, reanalyse: legacyReanalyse } : options;
  if (!["image", "video"].includes(item.type)) throw new AnalysisUnavailable("Unsupported media type");
  if (!isAITaggingConfigured()) throw new AnalysisUnavailable("AI tagging is not configured");
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
    const [current] = await tx.select().from(mediaItems).where(eq(mediaItems.id,item.id));
    if (!current || current.archivedAt) throw new AnalysisUnavailable("Photo no longer exists.");
    const [event] = current.eventId ? await tx.select().from(events).where(eq(events.id,current.eventId)) : [];
    const photoWorkflow = current.type==="image" && !!event?.photoMatchingEnabled;
    if (settings.photoWorkflow && !photoWorkflow) throw new AnalysisUnavailable("Enable photo matching before processing photos.");
    if (settings.photoWorkflow && current.identificationManual) throw new AnalysisUnavailable("Manual identification is protected.");
    const fingerprint = itemAnalysisFingerprint(current, settings.recognition || photoWorkflow);
    const [existing] = await tx.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id));
    const sameInput=existing && (existing.fingerprint===fingerprint ||
      (current.type==="image" && existing.fingerprint.replace(/^(?:tags|recognition):/,"")===
        fingerprint.replace(/^(?:tags|recognition):/,"")));
    if (existing && (existing.status === "queued" || existing.status === "running") &&
      existing.fingerprint===fingerprint && (!photoWorkflow || (existing.photoWorkflow &&
        existing.photoMatchingRevision===event!.photoMatchingRevision))) {
      if (settings.replacePreserved && current.captionSource==="preserved") {
        await tx.update(mediaAnalysisJobs).set({replaceCaption:current.caption}).where(eq(mediaAnalysisJobs.mediaId,item.id));
      }
      return;
    }
    // Duplicate import requests must never downgrade completed recognition.
    if (current.type==="image" && !settings.recognition && !photoWorkflow &&
      existing?.fingerprint === itemAnalysisFingerprint(current,true) && !settings.reanalyse) return;
    if (existing?.fingerprint === fingerprint && !settings.reanalyse &&
        (!settings.retry || existing.status !== "failed") &&
        !(photoWorkflow && (!existing.photoWorkflow || existing.photoMatchingRevision!==event!.photoMatchingRevision ||
          (settings.replacePreserved && current.captionSource==="preserved" && existing.replaceCaption!==current.caption)))) return;
    const creator = await tx.execute(sql`select e.creator_id,u.is_admin from media_items m join events e on e.id=m.event_id
      left join users u on u.id=e.creator_id where m.id=${item.id}`);
    const owner = creator.rows[0];
    if (owner?.creator_id && !owner.is_admin) {
      const hourly = Number(process.env.BETA_MANUAL_ANALYSES_PER_HOUR || 12);
      if (!Number.isSafeInteger(hourly) || hourly<1) throw new AnalysisUnavailable("Analysis fair-use policy is invalid.");
      if (!await takeBetaRate(`analysis:${owner.creator_id}`,hourly,3600000))
        throw new AnalysisUnavailable("You have reached the hourly analysis limit. Please try later.");
      const ownedPending = await tx.execute(sql`select count(*)::int as count from media_analysis_jobs j
        join media_items m on m.id=j.media_id join events e on e.id=m.event_id
        where e.creator_id=${owner.creator_id} and j.status in ('queued','running')`);
      if (Number(ownedPending.rows[0]?.count)>=100) throw new AnalysisUnavailable("Your photo analyses are still queued. Please retry later.");
    }
    const pending = await tx.execute(sql`select count(*)::int as count from media_analysis_jobs
      where status in ('queued', 'running')`);
    if (Number(pending.rows[0]?.count) >= MAX_PENDING)
      throw new AnalysisUnavailable("Analysis queue is full. Please retry later.");
    const values = { mediaId: item.id, fingerprint, status: "queued", attempts: 0,
      workerToken: null, generatedTags: existing?.generatedTags || null,
      recognition:sameInput ? existing!.recognition : null,
      referenceOnly: !!existing?.recognition && !!sameInput && !settings.reanalyse &&
        (existing.status==="completed" || existing.referenceOnly),
      photoWorkflow, photoMatchingRevision:event?.photoMatchingRevision || 0,
      replaceCaption:settings.replacePreserved && current.captionSource==="preserved" ? current.caption : null,
      generation: (existing?.generation || 0) + 1, error: null, durationMs: null,
      availableAt: new Date(), updatedAt: new Date() };
    const videoEvidence = existing?.fingerprint === fingerprint && !settings.reanalyse ? existing.videoEvidence : null;
    await tx.insert(mediaAnalysisJobs).values({ ...values, videoEvidence }).onConflictDoUpdate({
      target: mediaAnalysisJobs.mediaId, set: { ...values, videoEvidence },
    });
  });
  void kickAnalysisWorker();
  return analysisStatus(item.id);
}

let testCreatorNames: readonly string[] | undefined;
let testMediaIds: readonly number[] = [];
/** Restricts disposable provider-mocked servers; never available in production. */
export function setAnalysisQueueTestScope(names: readonly string[], mediaIds: readonly number[] = []) {
  if (process.env.NODE_ENV==="production") throw new Error("Test queue scope is forbidden in production");
  if (names.some(name=>!/^[A-Za-z0-9_-]{1,100}$/.test(name))) throw new Error("Invalid test creator name");
  if (mediaIds.some(id=>!Number.isSafeInteger(id)||id<1)) throw new Error("Invalid test media ID");
  testCreatorNames=[...names];
  testMediaIds=[...mediaIds];
}
async function claimAnalysis() {
  // Bind one PostgreSQL array value, not Drizzle's SQL list interpolation.
  const testNamesArray=`{${(testCreatorNames||[]).join(",")}}`;
  const testIdsArray=`{${testMediaIds.join(",")}}`;
  const claimed = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
    // Expired attempts are recoverable after process termination, but have a
    // finite budget. Fencing below prevents a late response from winning.
    await tx.execute(sql`update media_analysis_jobs set status = case when attempts >= ${MAX_ATTEMPTS}
      then 'failed' else 'queued' end, worker_token = null,
      error = 'Analysis was interrupted. Retry is available.', available_at = now()
       where status = 'running' and updated_at < now() - interval '90 seconds'
       and ${testCreatorNames===undefined?sql`true`:sql`(media_analysis_jobs.media_id=any(${testIdsArray}::int[]) or exists(select 1 from media_items sm join events se on se.id=sm.event_id
         join users su on su.id=se.creator_id where sm.id=media_analysis_jobs.media_id and su.username=any(${testNamesArray}::text[])))`}`);
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
        left join users u on u.id=e.creator_id
        where m.archived_at is null and ((j.status='queued' and j.available_at<=now()) or
          (j.status='completed' and j.recognition is not null and e.reference_revision>j.reference_revision
            and (not j.photo_workflow or (e.photo_matching_enabled and e.photo_matching_revision=j.photo_matching_revision))))
        and ${testCreatorNames===undefined?sql`true`:sql`(j.media_id=any(${testIdsArray}::int[]) or u.username=any(${testNamesArray}::text[]))`}
        and (e.creator_id is null or (not u.suspended and coalesce(u.creator_status,'none')<>'rejected'
          and not exists(select 1 from media_analysis_jobs r join media_items rm on rm.id=r.media_id
            join events re on re.id=rm.event_id where r.status='running' and re.creator_id=e.creator_id)))
        order by coalesce(u.analysis_last_served_at,case when e.creator_id is null then
          (select max(oj.updated_at) from media_analysis_jobs oj join media_items om on om.id=oj.media_id
            join events oe on oe.id=om.event_id where oe.creator_id is null and oj.status in ('running','completed')) end,
          timestamp '1970-01-01'),case when j.status='queued' then 0 else 1 end,j.available_at,j.media_id
        for update of j skip locked limit 1)
       returning media_id, fingerprint, attempts, reference_only, recognition, generated_tags, video_evidence,
         photo_workflow,photo_matching_revision`);
    const row = result.rows[0];
    return row ? { mediaId: Number(row.media_id), fingerprint: String(row.fingerprint),
      attempts: Number(row.attempts), referenceOnly: Boolean(row.reference_only),
      photoWorkflow:Boolean(row.photo_workflow),photoMatchingRevision:Number(row.photo_matching_revision),
      recognition: row.recognition as import("@shared/schema").Identification[] | null,
       generatedTags: row.generated_tags as string[] | null,
       videoEvidence: row.video_evidence as VideoEvidence | null, token } : undefined;
  });
  // Quota/reference transactions lock the owner before the queue. Do not
  // invert that order by holding the queue lock while waiting for the owner.
  if (claimed) await db.execute(sql`update users set analysis_last_served_at=now()
    where id=(select e.creator_id from events e join media_items m on m.event_id=e.id where m.id=${claimed.mediaId})`);
  return claimed;
}

// Exported to permit deterministic worker tests (including restart recovery).
export async function drainAnalysisQueue() {
  const claimed = await claimAnalysis();
  if (!claimed) return false;
  const started = Date.now();
  // Every bounded extraction/request is shorter than the 90s lease. Renew while
  // processing several batches; fencing also protects persisted partial results.
  const heartbeat = setInterval(() => {
    void db.update(mediaAnalysisJobs).set({ updatedAt: new Date() })
      .where(and(eq(mediaAnalysisJobs.mediaId, claimed.mediaId), eq(mediaAnalysisJobs.workerToken, claimed.token)))
      .catch(() => {});
  }, 15000);
  let videoStage: VideoFailureStage = "database_read";
  const videoJob = claimed.fingerprint.startsWith("video:");
  try {
    const [item] = await db.select().from(mediaItems).where(eq(mediaItems.id, claimed.mediaId));
    if (!item || item.archivedAt) return true;
    if (claimed.photoWorkflow) {
      const [event]=item.eventId ? await db.select().from(events).where(eq(events.id,item.eventId)) : [];
      if (!event?.photoMatchingEnabled || event.photoMatchingRevision!==claimed.photoMatchingRevision) {
        await db.update(mediaAnalysisJobs).set({status:"completed",workerToken:null,replaceCaption:null,
          error:"Photo matching was disabled before processing. No new analysis was performed.",updatedAt:new Date()})
          .where(and(eq(mediaAnalysisJobs.mediaId,item.id),eq(mediaAnalysisJobs.workerToken,claimed.token)));
        return true;
      }
    }
    const tagOnly = claimed.fingerprint.startsWith("tags:");
    const prefix = tagOnly ? "tags:" : claimed.fingerprint.startsWith("recognition:") ? "recognition:" : "";
    const fingerprint = item.type === "video" ? itemAnalysisFingerprint(item) : prefix + analysisFingerprint(item.thumbnail);
    if (claimed.fingerprint !== fingerprint) {
      // Upgrade only jobs already requested, never mass-retag completed media.
      claimed.fingerprint = fingerprint;
      claimed.videoEvidence = null;
      claimed.referenceOnly = false;
      videoStage="database_persistence";
      await db.update(mediaAnalysisJobs).set({fingerprint:claimed.fingerprint, videoEvidence: null, referenceOnly: false})
        .where(and(eq(mediaAnalysisJobs.mediaId,item.id),eq(mediaAnalysisJobs.workerToken,claimed.token)));
      videoStage="database_read";
    }
    let videoResult: ReturnType<typeof aggregateVideo> | undefined;
    if (item.type === "video" && !claimed.referenceOnly) {
      videoStage="file_access";
      await sampleVideo(item, async sample => {
        let evidence = claimed.videoEvidence;
        if (!evidence || evidence.sourceHash !== sample.sourceHash) evidence = {
          sourceHash: sample.sourceHash, duration: sample.duration, samplingMs: sample.samplingMs,
          timestamps: sample.frames.map(f => f.timestamp), frames: [], providerRequests: 0, analyzedFrames: 0,
          promptTokens: null, completionTokens: null, usageUnavailableRequests: 0, cost: null,
        };
        const persist = async () => {
          const previousStage=videoStage;
          videoStage="database_persistence";
          const saved = await db.update(mediaAnalysisJobs).set({videoEvidence: evidence, updatedAt: new Date()})
            .where(and(eq(mediaAnalysisJobs.mediaId, item.id), eq(mediaAnalysisJobs.workerToken, claimed.token)))
            .returning({ id: mediaAnalysisJobs.mediaId });
          if (!saved.length) throw new Error("Analysis lease expired");
          videoStage=previousStage;
        };
        if (evidence.posterSourceHash !== sample.sourceHash) {
          videoStage = "database_persistence";
          // Saving a true preview does not depend on a successful provider call.
          // Existing originals, captions, tags and frame evidence remain intact.
          const preview = await videoFrameThumbnail(Buffer.from(sample.frames[0].image.split(",")[1], "base64"));
          if (await storage.replaceVideoPreview(item, claimed.token, preview))
            evidence.posterSourceHash = sample.sourceHash;
          await persist();
        }
        await persist();
        const pending = sample.frames.filter(f => !evidence!.frames.some(done => done.hash === f.hash));
        for (let i = 0; i < pending.length; i += 4) {
          videoStage="ai_request";
          await withVisionBudget(async () => {
            evidence!.providerRequests++;
            evidence!.usageUnavailableRequests = (evidence!.usageUnavailableRequests || 0) + 1;
            await persist(); // Count requests even when the response is lost.
            const batch = await recognizeVideoBatch(pending.slice(i, i + 4));
            evidence!.frames.push(...batch.frames);
            evidence!.analyzedFrames = evidence!.frames.length;
            if (batch.usage) {
              evidence!.usageUnavailableRequests--;
              evidence!.promptTokens = (evidence!.promptTokens || 0) + batch.usage.prompt;
              evidence!.completionTokens = (evidence!.completionTokens || 0) + batch.usage.completion;
            }
            await persist();
          });
        }
        videoStage="result_parsing";
        videoResult = aggregateVideo(evidence.frames);
      });
    }
    const result = claimed.referenceOnly && claimed.recognition
      ? { tags: claimed.generatedTags || [], vehicles:item.type==="image"
          ? supportedPhotoObservations(claimed.recognition) : claimed.recognition }
      : videoResult ? videoResult
      : tagOnly
        ? { tags: await withVisionBudget(async () => generateTagsForImage(await analysisImageInput(item.thumbnail))), vehicles: null }
        : await withVisionBudget(async () => recognizeMotorsportImage(await recognitionImageInput(item)));
    const tags = result.tags;
    videoStage="database_persistence";
    await db.transaction(async tx => {
      // Event lock fences opt-out and context/reference corrections against late writes.
      const [event] = item.eventId ? await tx.select().from(events).where(eq(events.id,item.eventId)).for("update") : [];
      const [owned] = await tx.select().from(mediaAnalysisJobs)
        .where(and(eq(mediaAnalysisJobs.mediaId, item.id), eq(mediaAnalysisJobs.workerToken, claimed.token))).for("update");
      if (!owned || owned.fingerprint !== claimed.fingerprint) return;
      const [current] = await tx.select().from(mediaItems).where(eq(mediaItems.id,item.id)).for("update");
      if (!current || current.archivedAt || (current.type === "video" ? itemAnalysisFingerprint(current) :
        prefix + analysisFingerprint(current.thumbnail)) !== claimed.fingerprint) return;
      if (owned.photoWorkflow && (!event?.photoMatchingEnabled ||
        event.photoMatchingRevision!==owned.photoMatchingRevision || current.eventId!==item.eventId)) {
        await tx.update(mediaAnalysisJobs).set({status:"completed",workerToken:null,
          recognition:result.vehicles,generatedTags:tags,error:"Photo matching was disabled or changed; no automatic changes were saved.",
          updatedAt:new Date()}).where(eq(mediaAnalysisJobs.mediaId,item.id));
        return;
      }
      // Track future tag provenance. Legacy curation cannot be reconstructed:
      // conservatively preserve it rather than deleting possibly manual tags.
      const manualTags = Array.from(new Set([...current.manualTags,...(current.tags || []).filter(t=>
         !(owned.generatedTags || []).includes(t))]));
      let freshTags=tags.filter(t=>!current.suppressedAITags.includes(t));
      const opposites=[["Day","Night"],["Dry Track","Wet Track"],["Dry Track","Rain"]] as const;
      for (const [a,b] of opposites) {
        if (manualTags.includes(a)) freshTags=freshTags.filter(t=>t!==b);
        if (manualTags.includes(b)) freshTags=freshTags.filter(t=>t!==a);
      }
      const merged = claimed.referenceOnly ? current.tags || [] : Array.from(new Set([...manualTags,...freshTags])).slice(0,100);
      const identification = current.identificationManual || !result.vehicles ? current.identification : event
        ? await identifyEntries(event,result.vehicles,current.recognitionSession,tx,owned.photoWorkflow,item.type==="image") : result.vehicles;
      const category = claimed.referenceOnly ? current.category : await categorizeContent(merged);
      const [eventSeries] = event?.seriesId ? await tx.select({name:series.name}).from(series).where(eq(series.id,event.seriesId)) : [];
      const proposal = owned.photoWorkflow && event && !current.identificationManual
        ? matchedPhotoCaption(event,eventSeries?.name || null,identification) : undefined;
      const replaceable = current.captionSource==="photo_automatic" || current.captionSource==="nextcloud_placeholder" ||
        (!current.caption && current.captionSource==="auto_pending") ||
        (owned.replaceCaption!==null && current.captionSource==="preserved" && current.caption===owned.replaceCaption);
      const caption = proposal && replaceable ? proposal.caption :
        !owned.photoWorkflow && event?.creatorId && current.type==="image" && current.captionSource==="auto_pending" && !current.caption
        ? communityCaption(event) : undefined;
      const publicChanged = JSON.stringify([current.tags,current.identification,current.category]) !==
        JSON.stringify([merged,identification,category]) || caption!==undefined;
      await tx.update(mediaItems).set({ tags: merged, identification,
        ...(proposal ? {photoMatchStatus:proposal.matchStatus} : {}),
        ...(caption!==undefined ? {caption,captionSource:proposal ? "photo_automatic" : "automatic"} : {}),
        ...(event?.creatorId && publicChanged ? {
          contentVersion:sql`${mediaItems.contentVersion}+1`,safetyStatus:"error",safetyReason:"Safety check pending.",
        }:{}),
        ...(claimed.referenceOnly ? {} : {manualTags}),
        ...(claimed.referenceOnly ? {} : {category}) }).where(eq(mediaItems.id,item.id));
      await tx.update(mediaAnalysisJobs).set({ status: "completed", generatedTags: tags,
        recognition: result.vehicles, referenceRevision: event?.referenceRevision || 0, referenceOnly: false,
        replaceCaption:null,workerToken: null, error: null, updatedAt: new Date(), durationMs: Date.now() - started })
        .where(eq(mediaAnalysisJobs.mediaId, item.id));
    });
    videoStage="database_read";
    const [safeItem] = await db.select().from(mediaItems).where(eq(mediaItems.id,item.id));
    const [safeEvent] = safeItem?.eventId ? await db.select().from(events).where(eq(events.id,safeItem.eventId)) : [];
    if (safeEvent?.creatorId && safeItem.safetyStatus!=="legacy") await reviewMediaSafety(item.id,safeEvent.creatorId);
  } catch (error) {
    const busy = error instanceof VisionBusy;
    const failure=videoJob && !busy ? classifyVideoFailure(error,videoStage) : undefined;
    if (failure) console.warn("[video-analysis]",JSON.stringify(videoFailureRecord(claimed.mediaId,claimed.attempts,failure)));
    const terminal = !busy && (claimed.attempts >= MAX_ATTEMPTS || failure?.retryable===false);
    await db.update(mediaAnalysisJobs).set({
      status: terminal ? "failed" : "queued", workerToken: null,
      attempts: busy ? claimed.attempts - 1 : claimed.attempts,
      error: failure ? `Video analysis ${terminal?"failed":"will retry"} at ${failure.stage} (${failure.code}). Your original and manual tags are safe.`
        : terminal ? "AI analysis failed. Your media and manual tags are safe; retry is available."
        : "AI temporarily unavailable. Retrying in the background.",
      availableAt: new Date(Date.now() + (busy ? 5000 : 15000 * claimed.attempts)),
      updatedAt: new Date(), durationMs: Date.now() - started,
    }).where(and(eq(mediaAnalysisJobs.mediaId, claimed.mediaId), eq(mediaAnalysisJobs.workerToken, claimed.token)));
  } finally {
    clearInterval(heartbeat);
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
    await cleanupVideoTemps().catch(() => console.error("Interrupted video temporary cleanup failed"));
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
