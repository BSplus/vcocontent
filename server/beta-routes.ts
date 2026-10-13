import { withoutRetiredMediaTags } from "@shared/media-tag-policy";
import type { Express } from "express";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { events, mediaItems, users, safetyReviews } from "@shared/schema";
import { requireAdmin, requireCreator } from "./middleware/auth";
import { canManage } from "./beta-access";
import { storage } from "./storage";
import { communityLimitsFor, creatorUsage, safeState, safetyRetryAllowed, SAFETY_POLICY, takeBetaRate } from "./beta-policy";
import { verificationConfigured } from "./email-verification";
import { reviewEventSafety, reviewMediaSafety } from "./content-safety";
import { getOpenAIClient } from "./utils/ai-tagger";
import { reconcileCreatorStorage } from "./beta-storage-reconcile";
import { enqueueTransactionalEmail } from "./transactional-emails";

export function registerBetaRoutes(app: Express) {
  app.post("/api/admin/creator-storage/:id/reconcile",requireAdmin,async(req,res)=>{
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      if (!await takeBetaRate(`storage-check:${req.user!.id}`,2,60000)) return res.status(429).json({error:"Please wait before checking storage again."});
      if (!await storage.getUser(id)) return res.status(404).json({error:"Creator not found."});
      res.json(await reconcileCreatorStorage(id));
    } catch {res.status(503).json({error:"Storage sizes could not be checked. Files and accounts remain unchanged."});}
  });
  app.get("/api/admin/events",requireAdmin,async(_req,res)=>{
    res.setHeader("Cache-Control","private, no-store");
    try { res.json(await storage.getEvents()); }
    catch { res.status(503).json({error:"Events could not be loaded."}); }
  });
  app.get("/api/creator/usage",requireCreator,async(req,res)=>{
    try {
      res.setHeader("Cache-Control","private, no-store");
      const stats=await db.execute(sql`select e.id as event_id,
        count(m.id) filter(where m.type='image' and m.archived_at is null) as photos,
        count(m.id) filter(where m.type='video' and m.archived_at is null) as videos,
        coalesce(sum(m.download_count),0) as downloads
        from events e left join media_items m on m.event_id=e.id
        where e.creator_id=${req.user!.id} group by e.id`);
      res.json({...await creatorUsage(db,req.user!.id),limits:communityLimitsFor(req.user!.quotaException),
        exception:req.user!.quotaException,adminExempt:req.user!.isAdmin,eventStats:stats.rows.map(row=>({
          eventId:Number(row.event_id),photos:Number(row.photos),videos:Number(row.videos),downloads:Number(row.downloads)}))});
    } catch { res.status(503).json({error:"Storage usage could not be loaded."}); }
  });
  app.get("/api/creator/media",requireCreator,async(req,res)=>{
    try {
      const page = Number(req.query.page || 1);
      if (!Number.isSafeInteger(page) || page<1) return res.status(400).json({error:"Invalid page"});
      res.setHeader("Cache-Control","private, no-store");
      const items = await db.select({item:mediaItems}).from(mediaItems).innerJoin(events,eq(events.id,mediaItems.eventId))
        .where(and(sql`${mediaItems.archivedAt} is null`,eq(events.creatorId,req.user!.id))).orderBy(desc(mediaItems.id)).limit(48).offset((page-1)*48);
      res.json(items.map(r=>({...r.item,
        tags:r.item.tags === null ? null : withoutRetiredMediaTags(r.item.tags),
        manualTags:withoutRetiredMediaTags(r.item.manualTags),
        suppressedAITags:withoutRetiredMediaTags(r.item.suppressedAITags),
        url:r.item.url.startsWith("data:")?`/api/media/legacy/${r.item.id}/file`:r.item.url,
        thumbnail:r.item.thumbnail.startsWith("data:")?`/api/media/legacy/${r.item.id}/thumbnail`:r.item.thumbnail,
        safetyRetryAllowed:safetyRetryAllowed(r.item)})));
    } catch { res.status(503).json({error:"Creator media could not be loaded."}); }
  });
  app.post("/api/events/:id/publish",requireCreator,async(req,res)=>{
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const {published} = z.object({published:z.boolean()}).strict().parse(req.body);
      if (published && !getOpenAIClient()) return res.status(503).json({error:"Safety service is not configured. New publication stays private."});
      const event = await storage.getEvent(id);
      if (!event || !canManage(req.user,event)) return res.status(403).json({error:"Access denied."});
      // Refresh an interrupted new-event check, but never analyze legacy events
      // merely by viewing or unpublishing them.
      if (published && safetyRetryAllowed(event))
        await reviewEventSafety(id,event.creatorId!);
      const result = await db.transaction(async tx=>{
        if (event.creatorId) await tx.execute(sql`select id from users where id=${event.creatorId} for update`);
        const [current] = await tx.select().from(events).where(eq(events.id,id)).for("update");
        if (!current) return {error:"Gallery no longer exists."};
        const owner = current.creatorId ? await storage.getUser(current.creatorId) : undefined;
        if (published && current.creatorId && (!owner || owner.suspended || owner.creatorStatus==="rejected" ||
          !owner.emailVerifiedAt || !verificationConfigured() || current.adminHidden || !safeState(current)))
          return {error:"Verify your email and pass the gallery safety check before publishing. Hidden or suspended galleries cannot be republished."};
        const [updated] = await tx.update(events).set({visibility:published?"published":"draft"}).where(eq(events.id,id)).returning();
        if (published && current.creatorId && current.visibility !== "published")
          await enqueueTransactionalEmail(tx, "gallery-published", current.creatorId, id);
        return {event:updated};
      });
      return result.error ? res.status(403).json({error:result.error}) : res.json(result.event);
    } catch { res.status(400).json({error:"Gallery publication could not be updated."}); }
  });
  app.patch("/api/admin/events/:id/visibility",requireAdmin,async(req,res)=>{
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const {hidden} = z.object({hidden:z.boolean()}).strict().parse(req.body);
      const [event] = await db.update(events).set({adminHidden:hidden}).where(eq(events.id,id)).returning();
      res.setHeader("Cache-Control","no-store");
      res.status(event?200:404).json(event || {error:"Gallery not found"});
    } catch { res.status(400).json({error:"Invalid moderation request"}); }
  });
  app.post("/api/media/:id/safety/retry",requireCreator,async(req,res)=>{
    try {
      const item = await storage.getMediaItem(Number(req.params.id));
      const event = item?.eventId ? await storage.getEvent(item.eventId) : undefined;
      if (!item || !event || !event.creatorId || !canManage(req.user,event)) return res.status(403).json({error:"Access denied."});
      if (!safetyRetryAllowed(item))
        return res.status(409).json({error:"Only interrupted or outdated safety checks may be retried."});
      await reviewMediaSafety(item.id,event.creatorId);
      res.json(await storage.getMediaItem(item.id));
    } catch { res.status(503).json({error:"Safety check is temporarily unavailable."}); }
  });
  app.get("/api/admin/safety",requireAdmin,async(_req,res)=>{
    res.setHeader("Cache-Control","private, no-store");
    try {
      res.json({media:await db.select().from(mediaItems).where(and(sql`${mediaItems.archivedAt} is null`,inArray(mediaItems.safetyStatus,["review","error"]))).limit(100),
        events:await db.select().from(events).where(inArray(events.safetyStatus,["review","error"])).limit(100)});
    } catch { res.status(503).json({error:"Safety review could not be loaded."}); }
  });
  app.post("/api/admin/safety/:kind/:id/review",requireAdmin,async(req,res)=>{
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const kind = z.enum(["media","events"]).parse(req.params.kind);
      const {decision,reason,version,policy} = z.object({decision:z.enum(["approve","block"]),
        reason:z.string().trim().min(10).max(500),version:z.number().int().nonnegative(),policy:z.literal(SAFETY_POLICY)}).strict().parse(req.body);
      if (decision==="approve" && !getOpenAIClient()) return res.status(503).json({error:"Safety service is not configured. Content stays private."});
      if (!await takeBetaRate(`safety-admin:${req.user!.id}`,60,3600000)) return res.status(429).json({error:"Too many review requests."});
      const table = kind==="media"?mediaItems:events;
      const updated = await db.transaction(async tx=>{
        const [current] = await tx.select().from(table).where(eq(table.id,id)).for("update");
        // Explicitly blocked and failed/incomplete checks cannot be bypassed.
        if (!current || ("archivedAt" in current && current.archivedAt) || current.safetyStatus!=="review" || current.safetyVersion!==current.contentVersion ||
          current.safetyPolicy!==policy || current.contentVersion!==version) return false;
        await tx.insert(safetyReviews).values({resource:kind,resourceId:id,version:current.contentVersion,
          adminId:req.user!.id,decision,reason});
        await tx.update(table).set({safetyStatus:decision==="approve"?"approved":"blocked",
          safetyReason:decision==="approve"?"Uncertain result reviewed by an administrator.":"Blocked after administrator review."}).where(eq(table.id,id));
        return true;
      });
      res.status(updated?200:409).json(updated?{reviewed:true}:{error:"Only current uncertain results can be reviewed; prohibited or incomplete results cannot be approved."});
    } catch { res.status(400).json({error:"Enter a review reason of at least 10 characters."}); }
  });
}
