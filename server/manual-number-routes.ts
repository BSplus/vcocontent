import type { Express } from "express";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { events, eventEntries, mediaItems, mediaAnalysisJobs, referenceDocuments, series } from "@shared/schema";
import { requireCreator } from "./middleware/auth";
import { canManage } from "./beta-access";
import { applicableDocuments } from "./reference-matching";
import { matchedPhotoCaption } from "./caption-proposal";
import { assignedIdentifications, assignmentHash, manualNumberOptions } from "./manual-number-options";
import { assignmentReplaceIndexSchema as replaceIndexSchema, manualNumberAssignmentSchema as saveSchema } from "@shared/manual-number-assignment";

class AssignmentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const automaticSources = new Set(["auto_pending","automatic","photo_automatic","nextcloud_placeholder"]);

export function registerManualNumberRoutes(app: Express) {
  // A coherent snapshot across context, historical entries and season documents.
  const resolve = async (tx: any, id: number, user: Express.User | undefined, replaceIndex?: number, write = false) => {
    const [initial] = await tx.select().from(mediaItems).where(and(sql`${mediaItems.archivedAt} is null`,eq(mediaItems.id,id)));
    if (!initial) throw new AssignmentError(404,"Media item not found.");
    if (!initial.eventId) throw new AssignmentError(403,"This media has no managed event.");
    const query = tx.select().from(events).where(eq(events.id,initial.eventId));
    const [event] = await (write ? query.for("update") : query);
    if (!event || !canManage(user,event)) throw new AssignmentError(403,"Access denied.");
    if (write) await tx.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,id)).for("update");
    const itemQuery = tx.select().from(mediaItems).where(and(sql`${mediaItems.archivedAt} is null`,eq(mediaItems.id,id)));
    const [item] = await (write ? itemQuery.for("update") : itemQuery);
    if (!item || item.eventId !== event.id) throw new AssignmentError(409,"Media changed. Reload and select again.");
    if (!["image","video"].includes(item.type)) throw new AssignmentError(400,"Assign number is available for photos and videos only.");
    if (replaceIndex !== undefined && replaceIndex >= item.identification.length)
      throw new AssignmentError(409,"The vehicle to correct changed. Reload and select again.");
    const documents = (await tx.select().from(referenceDocuments).where(applicableDocuments(event)).orderBy(referenceDocuments.id))
      .filter((document: typeof referenceDocuments.$inferSelect) => document.ownerId === event.creatorId);
    const legacy = await tx.select().from(eventEntries).where(eq(eventEntries.eventId,event.id)).orderBy(eventEntries.id);
    const [eventSeries] = event.seriesId ? await tx.select().from(series).where(eq(series.id,event.seriesId)) : [];
    const context = [event.platform,eventSeries?.name,event.title,item.recognitionSession].filter(Boolean).join(" · ");
    const options = manualNumberOptions([...documents,...(legacy.length ? [{scope:"event",kind:"entry",session:null,
      rows:legacy,updatedAt:new Date(0),title:"Historical event entry list"}] : [])],item.recognitionSession,event.title);
    const snapshot = assignmentHash({item:[item.id,item.eventId,item.type,item.caption,item.captionSource,item.identification,
      item.identificationManual,item.recognitionSession,item.tags,item.photographer,item.contentVersion],
      event:[event.id,event.creatorId,event.referenceRevision,event.title,event.date,event.round,event.track,event.platform,
        event.seriesId,event.referenceSeasonYear,eventSeries?.name],documents,legacy,replaceIndex});
    const replaceCaptionRequired = !automaticSources.has(item.captionSource);
    return {item,event,eventSeries,snapshot,context,replaceCaptionRequired,options:options.map(option => {
      let identification;
      try { identification = assignedIdentifications(item.identification,option.identification,replaceIndex); }
      catch { identification = item.identification; }
      return {...option,caption:matchedPhotoCaption(event,eventSeries?.name || null,identification,true).caption};
    })};
  };
  const proposal = (current: Awaited<ReturnType<typeof resolve>>, body: z.infer<typeof saveSchema>) => {
    if (current.snapshot !== body.snapshot)
      throw new AssignmentError(409,"References or media changed. Reload and select again.");
    const selected = Array.from(new Set(body.selectionIds || [body.selectionId!])).map(id => {
      const option = current.options.find(option => option.id === id);
      if (!option) throw new AssignmentError(409,"This reference is no longer applicable. Reload and select again.");
      return option.identification;
    });
    let identification;
    try { identification = assignedIdentifications(current.item.identification,selected,body.replaceIndex); }
    catch (error) { throw new AssignmentError(409,(error as Error).message); }
    return {identification,caption:matchedPhotoCaption(current.event,current.eventSeries?.name || null,identification,true).caption};
  };
  const handleError = (error: unknown, res: any) => {
    if (error instanceof AssignmentError) return res.status(error.status).json({error:error.message});
    if (error instanceof z.ZodError) return res.status(400).json({error:"Invalid number assignment. Choose 1–12 references; replacement requires one vehicle."});
    if ((error as any)?.code === "40001" || (error as any)?.code === "40P01")
      return res.status(409).json({error:"References or media changed. Reload and select again."});
    return res.status(503).json({error:"Number assignment could not be loaded or saved. Please retry."});
  };
  app.get("/api/media/:id/number-options",requireCreator,async(req,res) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const index = req.query.replaceIndex === undefined ? undefined : replaceIndexSchema.parse(req.query.replaceIndex);
      const result = await db.transaction(tx => resolve(tx,id,req.user,index),{isolationLevel:"repeatable read"});
      res.json({snapshot:result.snapshot,context:result.context,replaceCaptionRequired:result.replaceCaptionRequired,
        identification:result.item.identification,caption:result.item.caption,session:result.item.recognitionSession,options:result.options});
    } catch (error) { handleError(error,res); }
  });
  app.post("/api/media/:id/number-assignment-preview",requireCreator,async(req,res) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const body = saveSchema.parse(req.body);
      const result = await db.transaction(async tx => proposal(await resolve(tx,id,req.user,body.replaceIndex),body),
        {isolationLevel:"repeatable read"});
      res.json(result);
    } catch (error) { handleError(error,res); }
  });
  app.post("/api/media/:id/assign-number",requireCreator,async(req,res) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const body = saveSchema.parse(req.body);
      const result = await db.transaction(async tx => {
        const current = await resolve(tx,id,req.user,body.replaceIndex,true);
        const proposed = proposal(current,body);
        if (current.replaceCaptionRequired && !body.replaceCaption)
          throw new AssignmentError(409,"Confirm replacement of the protected caption before saving.");
        const [saved] = await tx.update(mediaItems).set({...proposed,identificationManual:true,
          captionSource:"manual",contentVersion:sql`${mediaItems.contentVersion}+1`,
          ...(current.event.creatorId ? {safetyStatus:"error",safetyReason:"Safety check pending. Content stays private; retry the safety check."} : {}),
        }).where(eq(mediaItems.id,id)).returning();
        // No recognition or safety-provider request is part of this explicit
        // assignment. Existing publication gates require a separate safety check.
        return saved;
      },{isolationLevel:"serializable"});
      res.json({...result,
        url:result.url.startsWith("data:") ? `/api/media/legacy/${id}/file` : result.url,
        thumbnail:result.thumbnail.startsWith("data:") ? `/api/media/legacy/${id}/thumbnail` : result.thumbnail});
    } catch (error) { handleError(error,res); }
  });
}
