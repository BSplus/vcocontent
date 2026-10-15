import type { Express, RequestHandler } from "express";
import { and, eq, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { storage } from "./storage";
import { events, mediaItems, mediaAnalysisJobs } from "@shared/schema";
import { analysisStatus, enqueueAnalysis, kickAnalysisWorker, AnalysisUnavailable } from "./analysis-jobs";
import { reviewEventSafety } from "./content-safety";
import { pageMetadata } from "@shared/pagination";
import { photoMatchingChangesSchema } from "@shared/photo-matching-settings";
import { automaticEntrySql, automaticPhotoMatching } from "./automatic-photo-matching";

const settings = async (event: typeof events.$inferSelect) => ({
   id: event.id, enabled: await automaticPhotoMatching(event.id,db,null,true), platform: event.platform,
  contentVersion: event.contentVersion, referenceRevision: event.referenceRevision,
  photoMatchingRevision: event.photoMatchingRevision,
});

class SettingsAccessError extends Error {}

export function registerPhotoMatchingRoutes(app: Express, requireCreator: RequestHandler,
  wakeWorker: () => Promise<unknown> = kickAnalysisWorker) {
  const managed = async (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {res.status(400).json({error:"Invalid event."}); return;}
    const event = await storage.getEvent(id);
    if (!event) {res.status(404).json({error:"Event not found."}); return;}
    if (!req.user?.isAdmin && req.user?.id!==event.creatorId) {res.status(403).json({error:"Access denied."}); return;}
    return event;
  };
  app.get("/api/events/:id/photo-matching", requireCreator, async (req,res) => {
    try {
      const event = await managed(req,res); if (!event) return;
      let before = req.query.before===undefined ? undefined : Number(req.query.before);
      const expectedPage = req.query.page === undefined ? undefined : Number(req.query.page);
      if (before!==undefined && (!Number.isSafeInteger(before) || before<1))
        return res.status(400).json({error:"Invalid photo page."});
      if (expectedPage !== undefined && (!Number.isSafeInteger(expectedPage) || expectedPage < 1 || expectedPage > 1000000))
        return res.status(400).json({error:"Invalid photo page."});
      const predicate = and(sql`${mediaItems.archivedAt} is null`,eq(mediaItems.eventId,event.id),eq(mediaItems.type,"image"));
      const [count] = await db.select({
        total:sql<number>`count(*)::int`,
        preceding:sql<number>`count(*) filter (where ${before ?? 0} > 0 and ${mediaItems.id} >= ${before ?? 0})::int`,
        boundary:sql<number>`count(*) filter (where ${mediaItems.id} = ${before ?? 0})::int`,
      }).from(mediaItems).where(predicate);
      const positionReset = !!before && (!count.boundary || count.preceding === 0 ||
        count.preceding % 500 !== 0 || count.preceding >= count.total ||
        (expectedPage !== undefined && expectedPage !== count.preceding / 500 + 1));
      if (positionReset) before = undefined;
      const metadata = pageMetadata(count.total, before ? count.preceding / 500 + 1 : 1,500);
      const photos = await db.select({id:mediaItems.id,caption:mediaItems.caption,captionSource:mediaItems.captionSource,
        identificationManual:mediaItems.identificationManual,matchStatus:mediaItems.photoMatchStatus,
         status:sql<string>`case when ${mediaItems.identificationManual} then 'manual_protected'
           when not ${automaticEntrySql("events",sql`${mediaItems.recognitionSession}`)} then 'missing_entry_list'
           when ${mediaAnalysisJobs.status}='running' then 'running'
           when ${mediaAnalysisJobs.mediaId} is null or not ${mediaAnalysisJobs.photoWorkflow}
             or ${events.referenceRevision}<>${mediaAnalysisJobs.referenceRevision} then 'queued'
           when ${mediaAnalysisJobs.status}='waiting' then 'queued'
           else ${mediaAnalysisJobs.status} end`,
         error:sql<string | null>`coalesce(${mediaAnalysisJobs.error},
           case when ${mediaAnalysisJobs.mediaId} is null and not ${mediaItems.identificationManual}
             and ${automaticEntrySql("events",sql`${mediaItems.recognitionSession}`)}
             then 'Waiting for automatic matching admission. Work is retained and retried in bounded batches.' end)`})
         .from(mediaItems).leftJoin(mediaAnalysisJobs,eq(mediaAnalysisJobs.mediaId,mediaItems.id))
         .innerJoin(events,eq(events.id,mediaItems.eventId))
        .where(and(predicate,
          before ? sql`${mediaItems.id}<${before}` : undefined)).orderBy(desc(mediaItems.id)).limit(501);
      const page=photos.slice(0,500);
       res.json({...metadata,positionReset,...await settings(event),photos:page,
        nextCursor:photos.length>500 ? page[page.length-1].id : null});
    } catch {res.status(503).json({error:"Photo matching status could not be loaded."});}
  });
  app.patch("/api/events/:id/photo-matching", requireCreator, async (req,res) => {
    try {
      const event = await managed(req,res); if (!event) return;
       const values = photoMatchingChangesSchema.parse(req.body);
       if (values.enabled!==undefined)
         return res.status(400).json({error:"Matching is automatic with an applicable entry list; there is no activation switch.",saveStatus:"rejected"});
      const saved = await db.transaction(async tx => {
        const [current] = await tx.select().from(events).where(eq(events.id,event.id)).for("update");
        if (!current || (!req.user!.isAdmin && current.creatorId!==req.user!.id)) throw new SettingsAccessError("Owner changed");
        const platform = values.platform === undefined ? current.platform : values.platform || null;
         if (current.platform===platform)
          return { ...current, saveStatus: "unchanged" as const };
         const [updated] = await tx.update(events).set({platform,
          ...(current.platform!==platform ? {referenceRevision:sql`${events.referenceRevision}+1`} : {}),
          contentVersion:sql`${events.contentVersion}+1`,
          ...(current.creatorId ? {safetyStatus:"error",safetyReason:"Safety check pending."} : {}),
        }).where(eq(events.id,event.id)).returning();
        return { ...updated, saveStatus: "saved" as const };
      });
      // The transaction result is the acknowledgement. Neither safety review
      // nor a subsequent read may turn a committed write into a rejection.
      let safetyCheckStatus: "unavailable" | undefined;
      if (saved.creatorId && saved.saveStatus === "saved") {
        try { await reviewEventSafety(saved.id,saved.creatorId); }
        catch { safetyCheckStatus = "unavailable"; }
      }
       res.json({...await settings(saved),saveStatus:saved.saveStatus,
        ...(safetyCheckStatus ? {safetyCheckStatus} : {})});
      void Promise.resolve().then(wakeWorker).catch(() => console.error("Post-settings analysis wake-up failed"));
    } catch (reason) {
      if (reason instanceof z.ZodError)
        return res.status(400).json({error:"Photo matching settings are invalid.",saveStatus:"rejected"});
      if (reason instanceof SettingsAccessError)
        return res.status(403).json({error:"Event ownership changed.",saveStatus:"rejected"});
      res.status(503).json({error:"Photo matching settings could not be confirmed.",saveStatus:"unknown"});
    }
  });
  app.post("/api/events/:id/photo-matching/process", requireCreator, async (req,res) => {
    try {
      const event = await managed(req,res); if (!event) return;
      const values = z.object({mediaIds:z.array(z.number().int().positive()).min(1).max(50),
         confirmed:z.literal(true).optional(),replacePreservedIds:z.array(z.number().int().positive()).max(50).default([])}).strict().parse(req.body);
       if (!await automaticPhotoMatching(event.id,db,null,true)) return res.status(409).json({error:"Save an applicable entry list before processing photos."});
      if (values.replacePreservedIds.some(id=>!values.mediaIds.includes(id)))
        return res.status(400).json({error:"Caption replacement must be explicitly selected for a selected photo."});
      const results = [];
      for (const id of Array.from(new Set(values.mediaIds))) {
        try {
          const item = await storage.getMediaItem(id);
          if (!item || item.eventId!==event.id || item.type!=="image") {
            results.push({id,status:"skipped",error:"Photo does not belong to this event."}); continue;
          }
          if (item.identificationManual) {
            results.push({id,status:"skipped",error:"Manual identification is protected."}); continue;
          }
           await enqueueAnalysis(item,{photoWorkflow:true,recognition:true,retry:true,rematch:true,
            replacePreserved:values.replacePreservedIds.includes(id)});
          results.push({id,...await analysisStatus(id)});
        } catch (error) {
          results.push({id,status:"failed",error:error instanceof AnalysisUnavailable ? error.message : "Photo could not be queued."});
        }
      }
      res.status(202).json({results});
     } catch {res.status(400).json({error:"Select 1–50 photos to retry."});}
  });
}
