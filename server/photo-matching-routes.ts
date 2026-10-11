import type { Express, RequestHandler } from "express";
import { and, eq, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { storage } from "./storage";
import { events, mediaItems, mediaAnalysisJobs } from "@shared/schema";
import { analysisStatus, enqueueAnalysis, kickAnalysisWorker, AnalysisUnavailable } from "./analysis-jobs";
import { reviewEventSafety } from "./content-safety";

export function registerPhotoMatchingRoutes(app: Express, requireCreator: RequestHandler) {
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
      const before = req.query.before===undefined ? undefined : Number(req.query.before);
      if (before!==undefined && (!Number.isSafeInteger(before) || before<1))
        return res.status(400).json({error:"Invalid photo page."});
      const photos = await db.select({id:mediaItems.id,caption:mediaItems.caption,captionSource:mediaItems.captionSource,
        identificationManual:mediaItems.identificationManual,matchStatus:mediaItems.photoMatchStatus,
        status:sql<string>`case when ${mediaAnalysisJobs.status}='completed' and ${mediaAnalysisJobs.recognition} is not null
          and ${event.referenceRevision}>${mediaAnalysisJobs.referenceRevision} and
          (not ${mediaAnalysisJobs.photoWorkflow} or (${event.photoMatchingEnabled} and
            ${event.photoMatchingRevision}=${mediaAnalysisJobs.photoMatchingRevision})) then 'queued'
          else coalesce(${mediaAnalysisJobs.status},'not_requested') end`,
        error:mediaAnalysisJobs.error}).from(mediaItems).leftJoin(mediaAnalysisJobs,eq(mediaAnalysisJobs.mediaId,mediaItems.id))
        .where(and(eq(mediaItems.eventId,event.id),eq(mediaItems.type,"image"),
          before ? sql`${mediaItems.id}<${before}` : undefined)).orderBy(desc(mediaItems.id)).limit(501);
      const page=photos.slice(0,500);
      res.json({enabled:event.photoMatchingEnabled,platform:event.platform,photos:page,
        nextCursor:photos.length>500 ? page[page.length-1].id : null});
    } catch {res.status(503).json({error:"Photo matching status could not be loaded."});}
  });
  app.patch("/api/events/:id/photo-matching", requireCreator, async (req,res) => {
    try {
      const event = await managed(req,res); if (!event) return;
      const values = z.object({enabled:z.boolean(),platform:z.string().trim().max(120).nullable()}).strict().parse(req.body);
      await db.transaction(async tx => {
        const [current] = await tx.select().from(events).where(eq(events.id,event.id)).for("update");
        if (!current || (!req.user!.isAdmin && current.creatorId!==req.user!.id)) throw new Error("Owner changed");
        if (current.photoMatchingEnabled===values.enabled && current.platform===(values.platform || null)) return;
        await tx.update(events).set({photoMatchingEnabled:values.enabled,platform:values.platform || null,
          ...(current.photoMatchingEnabled!==values.enabled ? {photoMatchingRevision:sql`${events.photoMatchingRevision}+1`} : {}),
          ...(current.platform!==(values.platform || null) ? {referenceRevision:sql`${events.referenceRevision}+1`} : {}),
          contentVersion:sql`${events.contentVersion}+1`,
          ...(current.creatorId ? {safetyStatus:"error",safetyReason:"Safety check pending."} : {}),
        }).where(eq(events.id,event.id));
      });
      if (event.creatorId) await reviewEventSafety(event.id,event.creatorId);
      void kickAnalysisWorker();
      const saved = await storage.getEvent(event.id);
      res.json({enabled:saved!.photoMatchingEnabled,platform:saved!.platform});
    } catch {res.status(400).json({error:"Photo matching settings could not be saved."});}
  });
  app.post("/api/events/:id/photo-matching/process", requireCreator, async (req,res) => {
    try {
      const event = await managed(req,res); if (!event) return;
      const values = z.object({mediaIds:z.array(z.number().int().positive()).min(1).max(50),
        confirmed:z.literal(true),replacePreservedIds:z.array(z.number().int().positive()).max(50).default([])}).strict().parse(req.body);
      if (!event.photoMatchingEnabled) return res.status(409).json({error:"Enable photo matching before processing photos."});
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
          await enqueueAnalysis(item,{photoWorkflow:true,recognition:true,retry:true,
            replacePreserved:values.replacePreservedIds.includes(id)});
          results.push({id,...await analysisStatus(id)});
        } catch (error) {
          results.push({id,status:"failed",error:error instanceof AnalysisUnavailable ? error.message : "Photo could not be queued."});
        }
      }
      res.status(202).json({results});
    } catch {res.status(400).json({error:"Select 1–50 photos and confirm AI processing."});}
  });
}
