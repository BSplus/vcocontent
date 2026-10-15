import type { Express, RequestHandler } from "express";
import multer from "multer";
import { createHash, randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { Client } from "@replit/object-storage";
import { pipeline } from "stream/promises";
import { db } from "./db";
import { storage } from "./storage";
import { events, referenceDocuments, mediaCleanup, mediaReservations, entryRowSchema, type Event } from "@shared/schema";
import { applicableDocuments, seasonYear } from "./reference-matching";
import { parseEntryFile } from "./entry-list";
import { EntryListFileError } from "./iracing-entry-list";
import { withVisionBudget } from "./ai-budget";
import { kickAnalysisWorker } from "./analysis-jobs";
import { readMediaStream } from "./media-storage";
import { withMediaWorkBudget } from "./media-work-budget";
import { lockedCreatorBudget, takeBetaRate } from "./beta-policy";
import { MediaLimitError } from "./media-policy";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1048576, files: 1, fields: 8, parts: 9 } }).single("file");
const rowsSchema = z.array(entryRowSchema).max(500);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function ownerPredicate(event: Event) {
  return event.creatorId ? sql`${events.creatorId} = ${event.creatorId}` : sql`${events.creatorId} is null`;
}
async function bump(event: Event, scope: string, year: number, executor: typeof db | any = db) {
  await executor.update(events).set({ referenceRevision: sql`${events.referenceRevision}+1` }).where(scope === "season"
    ? and(eq(events.seriesId, event.seriesId!), ownerPredicate(event), sql`coalesce(${events.referenceSeasonYear},extract(year from ${events.date})::int)=${year}`)
    : eq(events.id, event.id));
}
export function registerReferenceRoutes(app: Express, requireCreator: RequestHandler) {
  const managed = async (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid event" }); return; }
    const event = await storage.getEvent(id);
    if (!event) { res.status(404).json({ error: "Event not found" }); return; }
    if (!req.user?.isAdmin && req.user?.id !== event.creatorId) { res.status(403).json({ error: "Access denied" }); return; }
    return event;
  };
  const document = async (event: Event, id: string) => {
    const number = Number(id);
    if (!Number.isSafeInteger(number) || number < 1) return undefined;
    const [doc] = await db.select().from(referenceDocuments).where(and(eq(referenceDocuments.id, number), applicableDocuments(event)));
    return doc;
  };
  app.get("/api/events/:id/references", requireCreator, async (req, res) => {
    try {
      const event = await managed(req, res); if (!event) return;
      const documents = await db.select().from(referenceDocuments).where(applicableDocuments(event));
      res.setHeader("Cache-Control","private, no-store");
      res.json({ documents: documents.map(({sourceKey, fingerprint, identityKey, ...d}) => ({ ...d,
        inherited: d.scope === "season", downloadUrl: sourceKey ? `/api/events/${event.id}/references/${d.id}/source` : null })),
        seriesId: event.seriesId, seasonYear: seasonYear(event), canUseSeason: !!event.seriesId });
    } catch { res.status(500).json({ error: "Reference lists could not be loaded" }); }
  });
  app.patch("/api/events/:id/reference-settings", requireCreator, async (req, res) => {
    try {
      const event = await managed(req, res); if (!event) return;
      const { seasonYear: year } = z.object({ seasonYear: z.number().int().min(1990).max(2100) }).parse(req.body);
      await db.update(events).set({ referenceSeasonYear: year, referenceRevision: sql`${events.referenceRevision}+1` }).where(eq(events.id,event.id));
      void kickAnalysisWorker(); res.json({ seasonYear: year });
    } catch { res.status(400).json({ error: "Season year could not be saved" }); }
  });
  app.post("/api/events/:id/references", requireCreator, async (req, res) => {
    const event = await managed(req, res).catch(()=>{res.status(503).json({error:"Reference import unavailable"});}); if (!event) return;
    upload(req,res,async failure => {
      if (failure || !req.file) return res.status(400).json({ error: "Choose one reference file, maximum 8 MiB" });
      let key: string | undefined;
      let reservation: string | undefined;
      let sourceWritten=false;
      try {
        const options = z.object({ scope: z.enum(["event","season"]).default("event"),
          kind: z.enum(["entry","result"]).default("entry"),
          seasonYear: z.coerce.number().int().min(1990).max(2100).default(seasonYear(event)),
          session: z.string().trim().max(120).optional() }).parse(req.body);
         if (options.kind==="entry" && !req.body.rows)
           return res.status(400).json({error:"Review and confirm the entry-list rows before saving. An unconfirmed source does not start matching."});
        if (options.scope === "season" && !event.seriesId) return res.status(400).json({ error: "Choose a series before adding a season list" });
        let title = req.file.originalname.replace(/[/\\\r\n]/g,"_").slice(0,160);
        const extension = title.split(".").pop()?.toLowerCase();
        if (!extension || !["csv","xlsx","pdf","png","jpg","jpeg","webp"].includes(extension)) return res.status(400).json({ error: "Use CSV, XLSX, PDF or an image" });
        const target = req.body.replaceId ? await document(event,String(z.coerce.number().int().positive().parse(req.body.replaceId))) : undefined;
        if (req.body.replaceId && !target) return res.status(404).json({error:"Reference to reimport not found"});
        if (target) {
          options.scope=target.scope as "event"|"season"; options.kind=target.kind as "entry"|"result";
          options.seasonYear=target.seasonYear;options.session=target.session || undefined;
          title=target.title;
        }
        const contextEvent = { ...event, referenceSeasonYear: options.seasonYear };
        if (!req.user!.isAdmin && !await takeBetaRate(`reference:${req.user!.id}`,20,3600000))
          return res.status(429).json({error:"Too many reference imports. Please try later."});
        const fingerprint = hash(req.file.buffer);
        const existing = await db.select().from(referenceDocuments).where(applicableDocuments(contextEvent));
        const session = options.session || null;
        const identical = existing.find(d => d.scope === options.scope && d.kind === options.kind && d.session === session && d.fingerprint === fingerprint);
         if (target && identical && identical.id!==target.id) return res.status(409).json({error:"This source already belongs to another reference list"});
         if (identical && !req.body.rows) {
          if (seasonYear(event)!==options.seasonYear) {
            await db.update(events).set({referenceSeasonYear:options.seasonYear,referenceRevision:sql`${events.referenceRevision}+1`}).where(eq(events.id,event.id));
            void kickAnalysisWorker();
          }
          res.json({ id: identical.id, reused: true, rows: identical.rows }); return;
        }
         // CSV validation is cheap and must also run for corrected previews; never
         // let supplied rows bypass source size/structure limits. Vision isn't repeated.
         const sourcePreview = !req.body.rows || extension === "csv"
           ? await withMediaWorkBudget(()=>parseEntryFile(req.file!.buffer,req.file!.mimetype,req.file!.originalname,withVisionBudget))
           : undefined;
         const parsed = req.body.rows ? {rows:rowsSchema.parse(JSON.parse(req.body.rows)),issues:sourcePreview?.issues || []} : sourcePreview!;
        const rows = rowsSchema.parse(parsed.rows.map(row=>({...row,
          number: /^\d{0,4}$/.test(row.number) ? row.number : "",
          team:row.team.slice(0,160),car:row.car.slice(0,160)})));
        // Corrected rows for the same bytes update editorial data, not storage.
        // Keep confirmation/CSV validation above; never upload a second source.
        if (identical) {
          const doc = await db.transaction(async tx => {
            const [current] = await tx.select().from(referenceDocuments)
              .where(eq(referenceDocuments.id,identical.id)).for("update");
            if (!current || current.sourceKey!==identical.sourceKey || current.fingerprint!==fingerprint)
              throw new Error("Reference changed during import");
            if (JSON.stringify(current.rows)!==JSON.stringify(rows)) {
              await tx.update(referenceDocuments).set({rows,updatedAt:new Date()})
                .where(eq(referenceDocuments.id,current.id));
              await bump(contextEvent,options.scope,options.seasonYear,tx);
            }
            if (seasonYear(event)!==options.seasonYear)
              await tx.update(events).set({referenceSeasonYear:options.seasonYear,
                referenceRevision:sql`${events.referenceRevision}+1`}).where(eq(events.id,event.id));
            return {...current,rows};
          });
          void kickAnalysisWorker();
          res.status(target ? 201 : 200).json({id:doc.id,reused:true,rows:doc.rows,issues:parsed.issues}); return;
        }
        const identityKey = target?.identityKey || hash(JSON.stringify([options.scope, options.scope === "season" ? event.seriesId : event.id,
          event.creatorId,options.seasonYear,options.kind,session,title.toLowerCase()]));
        if (existing.length >= 100 && !existing.some(d=>d.identityKey===identityKey)) return res.status(409).json({ error: "Too many reference documents; remove an obsolete list first" });
        key = `ref-${randomUUID()}.${extension}`;
        reservation=randomUUID();
        // Reuse crash recovery: cleanup must not delete an in-flight source.
        await db.transaction(async tx=>{
          if (event.creatorId) await tx.execute(sql`select id from users where id=${event.creatorId} for update`);
          if (target) {
            const [current] = await tx.select().from(referenceDocuments).where(eq(referenceDocuments.id,target.id)).for("update");
            if (!current || current.sourceKey!==target.sourceKey) throw new Error("Reference changed during import");
            const pending = await tx.select().from(mediaReservations).where(eq(mediaReservations.replacesReferenceId,target.id));
            if (pending.length) throw new MediaLimitError("A replacement for this reference is already in progress.");
          }
          // The old source still exists until confirmed deletion. Reserve the
          // entire replacement, including for admins acting on another owner.
          const reservedBytes = req.file!.size;
          if (event.creatorId) await lockedCreatorBudget(tx,event.creatorId,reservedBytes);
          await tx.insert(mediaReservations).values({id:reservation!,eventId:event.id,creatorId:event.creatorId,
            reservedBytes,replacesReferenceId:target?.id,storageKey:key!,thumbnailKey:key!});
          await tx.insert(mediaCleanup).values({key:key!,creatorId:event.creatorId}).onConflictDoNothing();
        });
        const saved = await withMediaWorkBudget(()=>new Client().uploadFromBytes(key!, req.file!.buffer, { compress: false }));
        if (!saved.ok) throw new Error("Storage failed");
        sourceWritten=true;
        const sourceKey = key;
        const result = await db.transaction(async tx => {
          if (event.creatorId) await tx.execute(sql`select id from users where id=${event.creatorId} for update`);
          await tx.execute(sql`select id from media_reservations where id=${reservation!} for update`);
          if (event.creatorId) await lockedCreatorBudget(tx,event.creatorId);
          const [previous] = await tx.select().from(referenceDocuments).where(eq(referenceDocuments.identityKey,identityKey)).for("update");
          if (target && (!previous || previous.id!==target.id || previous.sourceKey!==target.sourceKey))
            throw new Error("Reference changed during import");
          const values = { eventId: options.scope === "event" ? event.id : null, seriesId: event.seriesId,
            ownerId: event.creatorId, seasonYear: options.seasonYear, scope: options.scope, kind: options.kind,
            session, title, sourceKey, fingerprint, identityKey, rows, storedBytes:req.file!.size,updatedAt: new Date() };
          const [doc] = await tx.insert(referenceDocuments).values(values).onConflictDoUpdate({
            target: referenceDocuments.identityKey, set: values }).returning();
          if (previous?.sourceKey && previous.sourceKey !== sourceKey) await tx.insert(mediaCleanup).values({
            key:previous.sourceKey,creatorId:event.creatorId,storedBytes:previous.storedBytes}).onConflictDoNothing();
          await tx.update(events).set({referenceSeasonYear:options.seasonYear}).where(eq(events.id,event.id));
          await bump(contextEvent,options.scope,options.seasonYear,tx);
          await tx.delete(mediaReservations).where(eq(mediaReservations.id,reservation!));
          await tx.delete(mediaCleanup).where(eq(mediaCleanup.key,sourceKey));
          if (event.creatorId) await lockedCreatorBudget(tx,event.creatorId,0,0,0,0,true);
          return doc;
        });
        key = undefined; reservation=undefined; void kickAnalysisWorker(); void storage.cleanupObjects();
        res.status(201).json({ id: result.id, rows:result.rows, issues:parsed.issues });
      } catch (error) {
        if (key || reservation) await db.transaction(async tx=>{
          if (event.creatorId) await tx.execute(sql`select id from users where id=${event.creatorId} for update`);
          if (key) await tx.insert(mediaCleanup).values({key,creatorId:event.creatorId,storedBytes:sourceWritten?req.file!.size:null})
            .onConflictDoUpdate({target:mediaCleanup.key,set:{creatorId:event.creatorId,storedBytes:sourceWritten?req.file!.size:null}});
          if (reservation) await tx.delete(mediaReservations).where(eq(mediaReservations.id,reservation));
        });
        if (key) void storage.cleanupObjects();
         res.status(error instanceof MediaLimitError?413:400).json({error:error instanceof MediaLimitError || error instanceof EntryListFileError ? error.message:"Reference import failed. Check the file or use a searchable CSV/XLSX/PDF."});
      }
    });
  });
  app.patch("/api/events/:id/references/:refId", requireCreator, async (req,res) => {
    try {
      const event = await managed(req,res); if (!event) return;
      const doc = await document(event,req.params.refId); if (!doc) return res.status(404).json({error:"Reference not found"});
      const values = z.object({rows:rowsSchema, title:z.string().trim().min(1).max(160).optional(),session:z.string().trim().max(120).nullable().optional()}).strict().parse(req.body);
      const identityKey=hash(JSON.stringify([doc.scope,doc.scope==="season"?doc.seriesId:doc.eventId,
        doc.ownerId,doc.seasonYear,doc.kind,values.session===undefined?doc.session:values.session,
        (values.title || doc.title).toLowerCase()]));
      const fields=["number","team","car","drivers","manufacturer","racingClass","discipline","eventName","session"] as const;
      const matchingChanged=values.rows.length!==doc.rows.length || values.rows.some((row,index)=>
        fields.some(field=>(row[field] || "")!==(doc.rows[index]?.[field] || ""))) ||
        (values.session!==undefined && values.session!==doc.session);
      if (!matchingChanged && (!values.title || values.title===doc.title)) return res.json({success:true});
      await db.transaction(async tx => {
        await tx.update(referenceDocuments).set({...values,identityKey,updatedAt:new Date()}).where(eq(referenceDocuments.id,doc.id));
        if (matchingChanged) await bump(event,doc.scope,doc.seasonYear,tx);
      });
      if (matchingChanged) void kickAnalysisWorker(); res.json({success:true});
    } catch { res.status(400).json({error:"Reference corrections could not be saved"}); }
  });
  app.delete("/api/events/:id/references/:refId", requireCreator, async (req,res) => {
    try {
      const event = await managed(req,res); if (!event) return;
      const doc = await document(event,req.params.refId); if (!doc) return res.status(404).json({error:"Reference not found"});
      await db.transaction(async tx => {
        if (event.creatorId) await tx.execute(sql`select id from users where id=${event.creatorId} for update`);
        await tx.delete(referenceDocuments).where(eq(referenceDocuments.id,doc.id));
        if (doc.sourceKey) await tx.insert(mediaCleanup).values({key:doc.sourceKey,creatorId:event.creatorId,storedBytes:doc.storedBytes}).onConflictDoNothing();
        await bump(event,doc.scope,doc.seasonYear,tx);
      });
      void kickAnalysisWorker(); void storage.cleanupObjects(); res.json({success:true});
    } catch { res.status(500).json({error:"Reference could not be removed"}); }
  });
  app.get("/api/events/:id/references/:refId/source", requireCreator, async (req,res) => {
    try {
      const event = await managed(req,res); if (!event) return;
      const doc = await document(event,req.params.refId); if (!doc?.sourceKey) return res.status(404).end();
      const types:Record<string,string>={pdf:"application/pdf",csv:"text/csv",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp"};
      res.setHeader("Content-Type",types[doc.sourceKey.split(".").pop()!] || "application/octet-stream");
      const extension=doc.sourceKey.split(".").pop()!;
      const filename=doc.title.replace(/\.(?:csv|xlsx|pdf|png|jpe?g|webp)$/i,"")+"."+extension;
      res.setHeader("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader("Cache-Control","private, no-store"); res.setHeader("X-Content-Type-Options","nosniff");
      const stream = readMediaStream(doc.sourceKey);
      res.on("close",()=>stream.destroy());
      await pipeline(stream,res);
    } catch { if (!res.headersSent) res.status(502).json({error:"Reference source could not be downloaded"}); }
  });
}
