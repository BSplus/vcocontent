import type { Express } from "express";
import { registerResumableUploadRoutes, resumableUploadsAvailable, cleanupUploadSessions } from "./resumable-uploads";
import {nativeUploadDiagnostics} from "./native-upload-diagnostics";
import { isPreservedPhoto } from "@shared/image-provenance";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { pageMetadata } from "@shared/pagination";
import { insertEventSchema, insertMediaItemSchema, insertSeriesSchema, updateSeriesSchema, entryRowSchema, identificationSchema, users, events as eventsTable, mediaAnalysisJobs, mediaItems, series, type EntryRow } from "@shared/schema";
import express from "express";
import path from "path";
import { requireAuth, requireAdmin, requireCreator, requireOwnershipOrAdmin } from "./middleware/auth";
import { eventCreationError } from "./event-creation-error";
import { log } from "./vite";
import { db } from "./db";
import { eq, sql, and } from "drizzle-orm";
import { isAITaggingConfigured, testManagedOpenAI, detectRaceNumbers } from "./utils/ai-tagger";
import { entryConflicts, proposeCaption, scenes } from "./caption-proposal";
import { parseEntryFile } from "./entry-list";
import multer from "multer";
import { mediaUpload, uploadMedia, createMediaKeys, readMediaStream, readVideoSource, getMediaContentType } from "./media-storage";
import { legacyVideoSource, sendVideo } from "./video-delivery";
import { analysisImageInput, recognitionImageInput } from "./image-analysis";
import { mediaPolicy, MediaLimitError } from "./media-policy";
import { randomUUID } from "crypto";
import { InvalidPhotoError } from "./image-downloads";
import { z } from "zod";
import { discover, importStatus, startImport, startImportWorker, resumeImport, updateGallery, NextcloudError } from "./nextcloud";
import { readSources, saveSources, savedSourceInputs, sourceEdits, mergeSourceEdits } from "./nextcloud-sources";
import { downloadAccess } from "./download-access";
import { downloadStream, downloadInformation } from "./media-delivery";
import { enqueueAnalysis, analysisStatus, startAnalysisWorker, kickAnalysisWorker as kickWorker, AnalysisUnavailable, analysisFingerprint } from "./analysis-jobs";
import { identifyEntries } from "./reference-matching";
import { pipeline } from "stream/promises";
import { withVisionBudget } from "./ai-budget";
import { MediaBusyError } from "./media-work-budget";
import { LowResolutionError } from "./low-resolution-download";
import { registerReferenceRoutes } from "./reference-routes";
import { canManage, eventPublic, mediaPublic, visibleEvents } from "./beta-access";
import { communityLimits, creatorAllowed, safeState, safetyRetryAllowed, takeBetaRate } from "./beta-policy";
import { registerBetaRoutes } from "./beta-routes";
import { checkContent, reviewEventSafety, reviewMediaSafety } from "./content-safety";
import { verificationConfigured } from "./email-verification";
import { enqueueTransactionalEmail } from "./transactional-emails";
import { registerCommunityRoutes, issueDownloadOperation, validDownloadOperation, recordDownload } from "./community";
import { publicCreatorById } from "./creator-profiles";
import { registerCreatorEventAssociationRoutes } from "./creator-event-association";
import { EventImageError, validateOfficialEventImages, validateEventImages, publicEventThumbnails, registerEventThumbnailRoute } from "./event-thumbnails";
import { registerSharingRoutes } from "./sharing";
import { registerPhotoMatchingRoutes } from "./photo-matching-routes";
import { effectiveEventChanges } from "@shared/event-changes";
import {supportedPhotoObservations} from "./utils/photo-number-evidence";
import { registerManualNumberRoutes } from "./manual-number-routes";
import { registerMediaEdge, edgeOrigin, publicPreviewVersion } from "./media-edge";
import { mediaCreditSchema } from "@shared/media-credit";
import { mediaTagSchema, retiredTagMessage, RetiredMediaTagError } from "@shared/media-tag-policy";
import { activeMediaTagsSql } from "./media-tag-sql";
import { legacyThumbnail } from "./legacy-thumbnail";
import { sendPrivateThumbnail, thumbnailDigest } from "./thumbnail-cache";
import { sendPreparedThumbnail } from "./prepared-thumbnail";
import { registerSupportRoutes } from "./support-routes";
import { automaticAnalysisStatusSql } from "./automatic-photo-matching";
import { resolveGalleryOwnership } from "@shared/gallery-ownership";

const BETA_NOTICE = "Paid downloads are not available during the public beta";

const entryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1048576, files: 1, fields: 0, parts: 1 } }).single("file");
function creationEntries(body: Record<string, unknown>): EntryRow[] | undefined {
  if (body.entryRows === undefined) return undefined;
  const result = z.array(entryRowSchema).min(1).max(500).safeParse(body.entryRows);
  if (!result.success) throw new Error("Entry list: Please review all entries and correct incomplete rows.");
  if (entryConflicts(result.data).length) throw new Error("Entry list: Duplicate or ambiguous race numbers (including leading zeros).");
  return result.data;
}
const OPENAI_TEST_COOLDOWN_MS = 60_000;
function mediaPage(value: unknown): number | null {
  if (value === undefined) return 1;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && n <= 100000 ? n : null;
}
const canManageEvent = (user: Express.User | undefined, creatorId: number | null) =>
  canManage(user,{creatorId});
const publicMedia = <T extends { id: number; isPremium: boolean; url: string; thumbnail: string; safetyStatus:string; safetyPolicy:string|null;contentVersion:number;safetyVersion:number }>(item: T): T => ({
  ...item,
  safetyRetryAllowed:safetyRetryAllowed(item),
  url: item.isPremium ? "" : item.url.startsWith("data:")
    ? `/api/media/legacy/${item.id}/file` : item.url,
  thumbnail: item.isPremium && item.thumbnail.startsWith("data:")
    ? "/attached_assets/%2389_3.png"
    : item.thumbnail.startsWith("data:") ? `/api/media/legacy/${item.id}/thumbnail` : item.thumbnail,
});

export async function registerRoutes(app: Express, options: {workers?: boolean} = {}): Promise<Server> {
  const kickAnalysisWorker = options.workers===false ? async()=>false : kickWorker;
  // All API data and protected previews must be re-authorized on each request.
  app.use("/api",(_req,res,next)=>{res.setHeader("Cache-Control","private, no-store");next();});
  registerEventThumbnailRoute(app);
  registerSharingRoutes(app);
  registerBetaRoutes(app);
  registerSupportRoutes(app);
  registerCommunityRoutes(app);
  registerCreatorEventAssociationRoutes(app);
  registerReferenceRoutes(app, requireCreator);
  registerPhotoMatchingRoutes(app, requireCreator, kickAnalysisWorker);
  registerManualNumberRoutes(app);
  registerResumableUploadRoutes(app);
  registerMediaEdge(app);
  const openAITestCooldowns = new Map<number, number>();
  const captionDetections = new Map<number, { thumbnail: string; expires: number; result: Promise<Awaited<ReturnType<typeof detectRaceNumbers>>> }>();
  // Auth already set up in index.ts
  const cleanupTimer = setInterval(() => {
    void cleanupUploadSessions().catch(()=>console.error("Upload session reconciliation pending."));
    void storage.cleanupObjects().catch(error => console.error("Media reconciliation failed:", error));
  }, 15 * 60 * 1000);
  cleanupTimer.unref();

  // Serve static files from the attached_assets directory
  app.use('/attached_assets', express.static(path.join(process.cwd(), 'attached_assets')));

  // Events route - different behavior based on auth status
  app.get("/api/events", async (req, res) => {
    try {
      const events = await visibleEvents(await storage.getEventsWithCardFallbacks());
      
      // Lazy, bounded previews, including historical inline event images.
      const eventsWithoutThumbnails = events.map(event => ({
        ...publicEventThumbnails(event), galleryThumbnail: event.galleryThumbnail ?? null,
      }));
      
      // Return all events, regardless of auth status
      // This is needed for the public-facing event listing
      res.json(eventsWithoutThumbnails);
    } catch (error) {
      console.error('Error fetching events:', error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  // Creator routes
  app.post("/api/creator/events", requireCreator, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const eventData = insertEventSchema.parse({
        ...req.body,
        creatorId: req.user.id,
        isPremium: false,
      });
      if (eventData.coverImage || eventData.customThumbnail)
        return res.status(400).json({error:"Upload photos first, then select a checked photo as the gallery cover."});
      if (!req.user.isAdmin && !await takeBetaRate(`gallery:${req.user.id}`,10,3600000))
        return res.status(429).json({error:"Too many gallery requests. Please try later."});
      const event = await storage.createEvent(eventData, creationEntries(req.body));
      try {
        if (event.creatorId) await reviewEventSafety(event.id,event.creatorId);
        res.status(201).json(await storage.getEvent(event.id) || event);
      } catch {
        // Creation already committed. A review/read outage must not invite a duplicate.
        res.status(201).json({ ...event, safetyCheckStatus: "unavailable" });
      }
    } catch (error) {
      const failure = eventCreationError(error);
      if (failure.status === 503) console.error("Creator event creation could not be confirmed");
      res.status(failure.status).json({ error: failure.message });
    }
  });

  // Get creator's events with better error handling
  app.get("/api/creator/events", requireCreator, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(403).json({ error: "Unauthorized - Creator access required" });
      }

      console.log('Fetching events for creator:', req.user.id);
      const events = await storage.getEventsByCreator(req.user.id);
      res.json(events);
    } catch (error) {
      console.error('Error fetching creator events:', error);
      res.status(500).json({ error: "Failed to fetch creator events" });
    }
  });

  // Update event (creator can only update own events, admin can update any)
  app.put("/api/events/:id", requireOwnershipOrAdmin('creatorId'), async (req, res) => {
    let committed = false;
    try {
      const eventId = parseInt(req.params.id);
      const event = await storage.getEvent(eventId);

      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      // Only allow creators to update their own events
      if (!canManageEvent(req.user, event.creatorId)) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      const { creatorId: _ignoredCreatorId, ...eventChanges } = insertEventSchema.partial().parse(req.body);
      await validateEventImages(eventChanges, event);
      if (!req.user!.isAdmin) {
        delete eventChanges.isPremium;
        delete eventChanges.creditCost;
      }
      const changes = effectiveEventChanges(eventChanges, event);
      if (!Object.keys(changes).length)
        return res.json({ id: eventId, saveStatus: "unchanged" });
      const updatedEvent = await storage.updateEvent(eventId, {
        ...changes,
      });
      committed = true;
      const saveStatus = updatedEvent.saveStatus || "saved";
      let responseEvent: typeof event = updatedEvent;
      if (saveStatus === "saved" && event.creatorId && ["title","description","round","track","platform","vehicle"].some(field=>field in changes)) {
        await reviewEventSafety(eventId,event.creatorId);
        const reviewed = await storage.getEvent(eventId);
        if (!reviewed) throw new Error("Saved event status unavailable");
        responseEvent = reviewed;
      }
      // Keep gallery references intact, but never echo historical Base64 payloads.
      const previews = publicEventThumbnails(responseEvent);
      res.json({ ...responseEvent, saveStatus,
        coverImage: responseEvent.coverImage?.startsWith("data:") ? previews.coverImage : responseEvent.coverImage,
        customThumbnail: responseEvent.customThumbnail?.startsWith("data:") ? previews.customThumbnail : responseEvent.customThumbnail });
      void kickAnalysisWorker().catch(() => console.error("Post-save analysis wake-up failed"));
    } catch (error) {
      if (committed) {
        console.error("Event saved; subsequent safety status processing failed");
        return res.json({ id: Number(req.params.id), saveStatus: "saved", safetyCheckStatus: "unavailable" });
      }
      if (!(error instanceof EventImageError)) console.error('Error updating event:', error);
      const rejected = error instanceof EventImageError || error instanceof z.ZodError;
      res.status(rejected ? 400 : 500).json({ error: error instanceof EventImageError ? error.message : "Failed to update event",
        ...(rejected ? { saveStatus: "rejected" } : {}) });
    }
  });

  // Delete event (creator can only delete own events, admin can delete any)
  app.delete("/api/events/:id", requireOwnershipOrAdmin('creatorId'), async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      console.log('Routes: Attempting to delete event with ID:', eventId, 'Original ID parameter:', req.params.id);

      // Check if eventId is a valid number
      if (isNaN(eventId)) {
        console.error('Routes: Invalid event ID:', req.params.id);
        return res.status(400).json({
          success: false,
          message: "Invalid event ID provided"
        });
      }

      const result = await storage.deleteEvent(eventId);
      console.log('Routes: Delete result:', result);

      if (!result.success) {
        return res.status(result.message === "Event not found" ? 404 : result.message === "Invalid event ID provided" ? 400 : 500).json(result);
      }

      res.json(result);
    } catch (error) {
      console.error('Routes: Error deleting event:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to delete event"
      });
    }
  });


  // Admin routes
  app.post("/api/admin/openai/test", requireAdmin, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!isAITaggingConfigured()) {
      return res.status(503).json({ success: false, error: "Managed OpenAI runtime configuration unavailable" });
    }
    const now = Date.now();
    // Expired entries are removed on use, so idle admins do not accumulate indefinitely.
    openAITestCooldowns.forEach((expiresAt, id) => {
      if (expiresAt <= now) openAITestCooldowns.delete(id);
    });
    const adminId = req.user!.id;
    const expiresAt = openAITestCooldowns.get(adminId);
    if (expiresAt !== undefined) {
      const retryAfterSeconds = Math.ceil((expiresAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        error: "Connection check recently attempted; please retry later",
        retryAfterSeconds,
      });
    }
    // Reserve the slot before awaiting the provider to reject concurrent requests too.
    openAITestCooldowns.set(adminId, now + OPENAI_TEST_COOLDOWN_MS);
    try {
      if (await testManagedOpenAI()) return res.json({ success: true, status: "connected" });
    } catch {
      // Upstream errors may contain credentials, URLs or request details.
    }
    return res.status(502).json({ success: false, error: "Managed OpenAI request failed" });
  });

  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const { action } = req.body;

      switch (action) {
        case 'suspend_creator':
        case 'restore_creator':
          if (userId===req.user!.id) return res.status(400).json({error:"You cannot suspend your own admin account."});
          await db.update(users).set({suspended:action==="suspend_creator"}).where(eq(users.id,userId));
          break;
        case 'quota_exception':
          if (typeof req.body.enabled!=="boolean") return res.status(400).json({error:"Choose whether the exception is enabled."});
          await db.update(users).set({quotaException:req.body.enabled}).where(eq(users.id,userId));
          break;
        case 'approve_creator':
          await storage.updateUserCreatorStatus(userId, 'approved');
          break;
        case 'reject_creator':
          await storage.updateUserCreatorStatus(userId, 'rejected');
          break;
        case 'set_admin':
          // Update the user to make them an admin
          const user = await storage.getUser(userId);
          if (user) {
            // Direct database update since we don't have a dedicated storage method for this
            await db.update(users)
              .set({ isAdmin: true })
              .where(eq(users.id, userId))
              .execute();
            console.log(`User ${userId} has been granted admin privileges`);
          }
          break;
        default:
          return res.status(400).json({ error: "Invalid action" });
      }

      const updatedUser = await storage.getUser(userId);
      if (!updatedUser) return res.status(404).json({ error: "User not found" });
      res.json(updatedUser);
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // Payments stay entirely disabled until an audited paid release.
  app.post("/api/credits/purchase", requireAuth, (_req, res) => {
    res.status(503).json({ error: BETA_NOTICE });
  });
  app.post("/api/webhook/stripe", (_req, res) => {
    res.status(503).json({ error: BETA_NOTICE });
  });

  // Low-resolution VCO images are public. High resolution and creator downloads
  // require a session; the file route separately enforces private originals.
  app.post("/api/media/:id/download", async (req, res) => {
    try {
      const mediaId = Number(req.params.id);
      if (!Number.isSafeInteger(mediaId) || mediaId < 1) return res.status(400).json({ error: "Invalid media ID" });
      const quality = req.query.quality === undefined ? "high" : req.query.quality;
      if (quality !== "high" && quality !== "low") return res.status(400).json({ error: "Invalid download quality" });
      const mediaItem = await storage.getMediaItem(mediaId);

      if (!mediaItem) {
        return res.status(404).json({ error: "Media item not found" });
      }

      const event = mediaItem.eventId ? await storage.getEvent(mediaItem.eventId) : undefined;
      if (!event) return res.status(404).json({ error: "Event not found" });
      if (!await mediaPublic(mediaItem,event)) return res.status(404).json({error:"Media not found"});
      const access = downloadAccess(mediaItem, event, quality, req.isAuthenticated());
      if (req.user?.suspended) return res.status(403).json({error:"This account is suspended."});
      if (access !== 200) return res.status(access).json({
        error: access === 403 ? BETA_NOTICE : access === 400
          ? "Low resolution is available for images only" : "Sign in to download this media",
      });

      const operation=req.user ? await issueDownloadOperation(req.user.id,mediaId,quality) : undefined;
      res.json({ success: true, url: `/api/media/${mediaId}/download?quality=${quality}${operation?`&operation=${operation}`:""}` });
    } catch (error) {
      console.error('Error processing download:', error);
      res.status(500).json({ error: "Failed to process download" });
    }
  });

  app.get(["/api/media/:id/download", "/api/media/:id/download-info"], async (req, res) => {
    const controller = new AbortController();
    const abort = () => { if (!res.writableFinished) controller.abort(); };
    res.once("close", abort);
    try {
      const id = Number(req.params.id);
      const quality = req.query.quality === undefined ? "high" : req.query.quality;
      if (!Number.isSafeInteger(id) || id < 1 || (quality !== "high" && quality !== "low"))
        return res.status(400).json({ error: "Invalid download" });
      const item = await storage.getMediaItem(id);
      const event = item?.eventId ? await storage.getEvent(item.eventId) : undefined;
      if (!item || !event) return res.status(404).json({ error: "Media not found" });
      if (!await mediaPublic(item,event)) return res.status(404).json({error:"Media not found"});
      const access = downloadAccess(item, event, quality, req.isAuthenticated());
      if (req.user?.suspended) return res.status(403).json({error:"This account is suspended."});
      if (access !== 200) return res.status(access).json({ error: "Download not permitted" });
      if (req.path.endsWith("/download-info")) {
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("Vary", "Cookie");
        const info = await downloadInformation(item,event,quality);
        return res.json(info);
      }
      if (req.query.operation!==undefined && (!req.user || !await validDownloadOperation(req.query.operation,req.user.id,id,quality)))
        return res.status(400).json({error:"Download authorization expired. Please request a new download."});
      const operation=typeof req.query.operation==="string"?req.query.operation:randomUUID();
      const { stream, contentType, filename } = await downloadStream(item, event, quality, controller.signal);
      if (res.destroyed) { stream.destroy(); return; }
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const cancel = () => { if (!res.writableFinished) stream.destroy(); };
      res.once("close", cancel);
      try {
        await pipeline(stream, res);
        // Counts complete server deliveries, not authorization requests, and
        // cannot confirm whether the recipient saved the file on their device.
        try {
          if (req.user) await recordDownload(req.user.id,id,quality,operation);
          else await storage.incrementDownloadCount(id);
        } catch { console.error("Completed download statistics could not be recorded; do not retry file delivery."); }
      } finally { res.off("close", cancel); }
    } catch (error) {
      console.error("Media download delivery failed");
      if (!res.headersSent && !res.destroyed) {
        const known = error instanceof MediaBusyError || error instanceof MediaLimitError || error instanceof LowResolutionError;
        res.status(error instanceof MediaBusyError ? 503 : error instanceof MediaLimitError ? 413 :
          error instanceof LowResolutionError ? 422 : 502).json({
          error: known ? error.message : "Media could not be downloaded. Please retry or choose another version.",
        });
      }
    } finally {
      res.off("close", abort);
    }
  });

  // Use JSON parser for all other routes
  app.use(express.json());
  app.get("/api/media/policy", async (req, res) => {
    try {
      const id = Number(req.query.eventId);
      const event = Number.isSafeInteger(id) && id > 0 ? await storage.getEvent(id) : undefined;
      if (req.query.eventId !== undefined && !event) return res.status(404).json({error:"Event not found"});
      const community = event ? !!event.creatorId : !req.user?.isAdmin;
      res.json({
        community,
        imageBytes: community ? communityLimits.imageBytes : mediaPolicy.imageBytes,
        videoBytes: community ? 0 : req.user?.isAdmin ? mediaPolicy.videoBytes : 0,
        maxPixels: mediaPolicy.maxPixels,
        thumbnailEdge: Math.min(mediaPolicy.thumbnailEdge, 640),
        zipCount: mediaPolicy.zipCount,
        zipBytes: mediaPolicy.zipBytes,
        resumableUploads: await resumableUploadsAvailable(),
      });
    } catch {
      res.status(502).json({error:"Upload policy could not be loaded"});
    }
  });

  const nextcloudRequest = z.object({
    sources: z.array(z.object({ link: z.string().url().max(2048), password: z.string().max(256).optional(), photographer: mediaCreditSchema.optional() })).min(1).max(10),
  });
  // Explicit private endpoints: never include source data in public event records.
  for (const action of ["sources", "update", "preview"] as const) {
    const endpoint = `/api/admin/events/:id/nextcloud/${action}`;
    if (action === "sources") app.get(endpoint, requireAdmin, async (req, res) => {
      try {
        const id = Number(req.params.id);
        const event = Number.isSafeInteger(id) && id > 0 ? await storage.getEvent(id) : undefined;
        if (!event || event.creatorId || event.isPremium) return res.status(404).json({ error: "Admin event gallery not found." });
        res.json({ sources: await readSources(id) });
      } catch { res.status(502).json({ error: "Saved sources could not be loaded." }); }
    });
    app.post(endpoint, requireAdmin, async (req, res) => {
      try {
        const id = Number(req.params.id);
        const event = Number.isSafeInteger(id) && id > 0 ? await storage.getEvent(id) : undefined;
        if (!event || event.creatorId || event.isPremium) return res.status(404).json({ error: "Admin event gallery not found." });
        if (action === "sources") return res.json({ sources: await saveSources(id, sourceEdits.parse(req.body.sources)) });
        if (action === "preview") {
          const inputs = mergeSourceEdits(await savedSourceInputs(id), sourceEdits.parse(req.body.sources));
          const { files, skipped } = await discover(inputs, id);
          return res.json({ count: files.length, images: files.filter(f => f.type === "image").length,
            videos: files.filter(f => f.type === "video").length, skipped });
        }
        await updateGallery(id);
        res.status(202).json(await importStatus(id));
      } catch (error) {
        res.status(error instanceof z.ZodError || error instanceof NextcloudError ? 400 : 502)
          .json({ error: error instanceof NextcloudError ? error.message : "The Nextcloud request failed. Saved media is unchanged." });
      }
    });
  }
  app.post("/api/admin/nextcloud/preview", requireAdmin, async (req, res) => {
    try {
      const { files, skipped } = await discover(nextcloudRequest.parse(req.body).sources);
      res.json({ count: files.length, images: files.filter(file => file.type === "image").length,
        videos: files.filter(file => file.type === "video").length, skipped });
    } catch (error) {
      res.status(error instanceof z.ZodError || error instanceof NextcloudError ? 400 : 502)
        .json({ error: error instanceof NextcloudError ? error.message : "The Nextcloud preview could not be loaded." });
    }
  });
  app.get("/api/admin/events/:id/nextcloud", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid event gallery." });
    if (!await storage.getEvent(id)) return res.status(404).json({ error: "Event gallery not found." });
    res.json(await importStatus(id));
  });
  app.post("/api/admin/events/:id/nextcloud", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid event gallery." });
      const event = await storage.getEvent(id);
      if (!event || event.creatorId || event.isPremium) return res.status(404).json({ error: "Admin event gallery not found." });
      await startImport(id, nextcloudRequest.parse(req.body).sources);
      res.status(202).json(await importStatus(id));
    } catch (error) {
      res.status(error instanceof z.ZodError || error instanceof NextcloudError ? 400 : 502)
        .json({ error: error instanceof NextcloudError ? error.message : "The import could not be started." });
    }
  });
  app.post("/api/admin/events/:id/nextcloud/resume", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid event" });
      const event = await storage.getEvent(id);
      if (!event || event.creatorId || event.isPremium) return res.status(404).json({ error: "Event not found" });
      await resumeImport(id);
      res.status(202).json(await importStatus(id));
    } catch (error) {
      res.status(400).json({ error: error instanceof NextcloudError ? error.message : "Import could not be resumed" });
    }
  });

  // Get top shots
  app.get("/api/media/top-shots", async (req, res) => {
    try {
      const topShots = await storage.topMedia(3, null);
      res.json(topShots.map(publicMedia));
    } catch (error) {
      console.error('Error fetching top shots:', error);
      res.status(500).json({ error: "Failed to fetch top shots" });
    }
  });
  
  // Get popular creator content
  app.get("/api/media/creator-top", async (req, res) => {
    try {
      const topCreatorMedia = await storage.topMedia(3);
      res.json(topCreatorMedia.map(publicMedia));
    } catch (error) {
      console.error('Error fetching popular creator content:', error);
      res.status(500).json({ error: "Failed to fetch popular creator content" });
    }
  });
  
  // Get popular content by a specific creator
  app.get("/api/media/top/creator/:id", async (req, res) => {
    try {
      const creatorId = parseInt(req.params.id);
      if (isNaN(creatorId)) {
        return res.status(400).json({ error: "Invalid creator ID" });
      }
      
      const topCreatorMedia = await storage.topMedia(8, creatorId);
      
      res.json(topCreatorMedia.map(publicMedia));
    } catch (error) {
      console.error(`Error fetching creator ${req.params.id} top media:`, error);
      res.status(500).json({ error: "Failed to fetch creator's popular media" });
    }
  });
  // Get single event
  app.get("/api/media/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid media ID" });
    try {
      const item = await storage.getMediaItem(id);
      const event = item?.eventId ? await storage.getEvent(item.eventId) : undefined;
      if (!item || !event || item.isPremium || event.isPremium || !await mediaPublic(item,event)) return res.status(404).json({ error: "Media not found" });
      res.json(publicMedia(item));
    } catch (error) {
      console.error("Failed to fetch media:", error);
      res.status(500).json({ error: "Failed to fetch media" });
    }
  });
  app.get("/api/events/:id", async (req, res) => {
    try {
      const event = await storage.getEvent(parseInt(req.params.id));
      if (!event || (!canManage(req.user,event) && !await eventPublic(event))) {
        return res.status(404).json({ error: "Event not found" });
      }
      res.json(event);
    } catch (error) {
      console.error('Error fetching event:', error);
      res.status(500).json({ error: "Failed to fetch event" });
    }
  });

  // Get event media
  app.get("/api/events/:id/media", async (req, res) => {
    try {
      const requestedPage = mediaPage(req.query.page);
      if (!requestedPage) return res.status(400).json({ error: "Invalid page" });
      const event = await storage.getEvent(parseInt(req.params.id));
      if (!event) return res.status(404).json({ error: "Event not found" });
      const manager = canManage(req.user,event);
      if (!manager && !await eventPublic(event)) return res.status(404).json({error:"Event not found"});
      const paginated = req.query.pagination === "true";
      const metadata = paginated ? pageMetadata(event.isPremium ? 0 : await storage.countEventMedia(event.id, manager), requestedPage, 48) : undefined;
      const page = metadata?.page ?? requestedPage;
      if (event.isPremium) return res.json(metadata ? { ...metadata, items: [] } : []);
      const media = manager ? await storage.getMediaItems(event.id,page)
        : await storage.getPublicEventMediaItems(event.id,page);
      const items = manager ? media : media.map(publicMedia);
      res.json(metadata ? { ...metadata, items } : items);
    } catch (error) {
      console.error('Error fetching event media:', error);
      res.status(500).json({ error: "Failed to fetch event media" });
    }
  });

  // Get all media (different behavior based on auth status)
  app.get("/api/media", async (req, res) => {
    try {
      const page = mediaPage(req.query.page);
      if (!page) return res.status(400).json({ error: "Invalid page" });
      const search = req.query.q;
      const type = req.query.type;
      const fields = req.query.fields;
      if (search !== undefined && (typeof search !== "string" || search.length > 100))
        return res.status(400).json({ error: "Search must be under 100 characters" });
      if (type !== undefined && type !== "all" && type !== "image" && type !== "video")
        return res.status(400).json({ error: "Invalid media type" });
      if (fields !== undefined && (typeof fields !== "string" || fields.length > 64 ||
          (fields !== "" && fields.split(",").some(field => !["caption", "photographer", "tags", "identification"].includes(field)))))
        return res.status(400).json({ error: "Invalid search fields" });
      const selectedType = type === "image" || type === "video" ? type : undefined;
      const selectedFields = fields === undefined ? undefined : fields === "" ? [] :
        fields.split(",") as ("caption" | "photographer" | "tags" | "identification")[];
      const metadata = req.query.pagination === "true"
        ? pageMetadata(await storage.countPublicMedia(search || "", selectedType, selectedFields), page, 48) : undefined;
      const items = (await storage.listPublicMedia(metadata?.page ?? page, 48, search || "", selectedType, selectedFields)).map(publicMedia);
      return res.json(metadata ? { ...metadata, items } : items);
    } catch (error) {
      console.error('Error fetching all media:', error);
      res.status(500).json({ error: "Failed to fetch media" });
    }
  });

  // Historical Base64 records stay in PostgreSQL until a separately approved
  // migration. Stream them on demand instead of embedding megabytes in lists.
  app.get("/api/media/legacy/:id/:variant", async (req, res) => {
    const id = Number(req.params.id);
    const variant = req.params.variant;
    if (!Number.isSafeInteger(id) || id < 1 || !["file", "thumbnail"].includes(variant))
      return res.status(404).end();
    try {
      const record = await storage.getMediaItem(id, variant === "file");
      if (!record) return res.status(404).end();
      const owningEvent = record.eventId ? await storage.getEvent(record.eventId, variant === "file") : undefined;
      if (!owningEvent || (!canManage(req.user,owningEvent) && !await mediaPublic(record,owningEvent))) return res.status(404).end();
      if (variant === "file") {
        if (req.user?.suspended) return res.status(403).json({error:"This account is suspended."});
        const event = record.eventId ? await storage.getEvent(record.eventId) : undefined;
        if (!req.isAuthenticated() || record.isPremium || event?.isPremium)
          return res.status(req.isAuthenticated() ? 403 : 401).json({ error: "Download file not available" });
      }
      if (variant === "thumbnail") {
        if (record.isPremium || owningEvent.isPremium) return res.status(404).end();
        return sendPrivateThumbnail(req, res, await legacyThumbnail(record.thumbnail), thumbnailDigest(record.thumbnail));
      }
      const dataUrl = variant === "file" ? record.url : record.thumbnail;
      const match = /^data:(image\/(?:jpeg|png|gif|webp)|video\/(?:mp4|webm|quicktime));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
      if (!match) return res.status(404).end();
      if (variant === "file" && match[1].startsWith("video/")) {
        res.setHeader("Content-Type", match[1]);
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        await sendVideo(req, res, legacyVideoSource(match[2]));
        return;
      }
      let body = Buffer.from(match[2], "base64");
      if (body.length > 100 * 1024 * 1024) return res.status(413).end();
      res.setHeader("Content-Type", match[1]);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(body);
    } catch (error) {
      if (error instanceof MediaBusyError) return res.status(503).set("Retry-After", "5").end();
      if (error instanceof MediaLimitError) return res.status(413).type("json").json({ error: error.message });
      console.error("Legacy media delivery failed:", error);
      return res.status(500).json({ error: "Media unavailable" });
    }
  });

  // Private objects are served only after looking up their owning media record.
  app.get("/api/media/files/:key", async (req, res) => {
    const key = req.params.key;
    if (!/^(media|thumb)-[0-9a-f-]{36}\.(jpg|png|gif|webp|mp4|mov|webm)$/.test(key)) {
      return res.status(404).end();
    }
    try {
      const record = await storage.findMediaByKey(key, !key.startsWith("thumb-"));
      if (!record) return res.status(404).end();
      const isOriginal = record.url === `/api/media/files/${key}`;
      const event = record.eventId ? await storage.getEvent(record.eventId, isOriginal) : undefined;
      if (!event || (!canManage(req.user,event) && !await mediaPublic(record,event))) return res.status(404).end();
      const isThumbnail = !isOriginal && record.thumbnail === `/api/media/files/${key}` && /^thumb-.*\.webp$/.test(key);
      if (!isOriginal && !isThumbnail) return res.status(404).end();
      if (isThumbnail && (record.isPremium || event.isPremium)) return res.status(404).end();
      if (isOriginal && req.user?.suspended) return res.status(403).json({error:"This account is suspended."});
      if (isOriginal && (!req.isAuthenticated() || record.isPremium || event?.isPremium)) {
        return res.status(req.isAuthenticated() ? 403 : 401).json({ error: "Download file not available" });
      }
      // New official JPEGs retain private metadata. Non-managers may view the
      // standard export, never the newly preserved exact-original bytes.
      if (isOriginal && event.creatorId === null && key.endsWith(".jpg") &&
          isPreservedPhoto(record.url) && !canManage(req.user,event)) {
        const controller = new AbortController();
        const abort = () => { if (!res.writableFinished) controller.abort(); };
        res.once("close", abort);
        try {
          const { stream, contentType } = await downloadStream(record,event,"high",controller.signal);
          res.setHeader("Content-Type", contentType);
          res.setHeader("Cache-Control", "private, no-store");
          res.setHeader("X-Content-Type-Options", "nosniff");
          await pipeline(stream,res);
        } finally { res.off("close",abort); }
        return;
      }
      const edge = !isOriginal && edgeOrigin();
      if (edge) {
        const version = await publicPreviewVersion(key);
        if (version) return res.redirect(307,`${edge}/preview/${key}/${version}`);
      }
      if (isThumbnail) {
        return await sendPreparedThumbnail(req, res, key);
      }
      res.setHeader("Content-Type", getMediaContentType(key));
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (getMediaContentType(key).startsWith("video/")) {
        await sendVideo(req, res, await readVideoSource(key));
        return;
      }
      const stream = readMediaStream(key);
      stream.on("error", () => {
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
      });
      stream.pipe(res);
    } catch (error) {
      if (error instanceof MediaBusyError && !res.headersSent)
        return res.status(503).set("Retry-After", "5").set("Cache-Control", "private, no-store")
          .json({ error: "Media is temporarily busy. Please retry shortly." });
      console.error("Media delivery failed:", error);
      if (!res.headersSent) res.status(502).json({ error: "Media is temporarily unavailable" });
      else res.destroy();
    }
  });

  app.post("/api/events/:eventId/media/upload", requireCreator, async (req, res, next) => {
    const eventId = Number(req.params.eventId);
    if (!Number.isSafeInteger(eventId) || eventId <= 0) return res.status(400).json({ error: "Invalid event ID" });
    try {
      const event = await storage.getEvent(eventId);
      if (!event) return res.status(404).json({ error: "Event not found" });
      if (!canManageEvent(req.user, event.creatorId)) return res.status(403).json({ error: "Forbidden" });
      if (event.isPremium) return res.status(403).json({ error: BETA_NOTICE });
      mediaUpload.single("file")(req, res, async (uploadError) => {
        if (uploadError) return res.status(400).json({ error: uploadError.code === "LIMIT_FILE_SIZE" ? `Video limit is ${mediaPolicy.videoBytes / 1048576} MiB; image limit is ${mediaPolicy.imageBytes / 1048576} MiB` : uploadError.message });
        if (!req.file) return res.status(400).json({ error: "A file is required" });
        let reservationId: string | undefined;
        try {
          const metadata = z.object({
            type: z.enum(["image", "video"]),
            caption: z.string().max(1000).optional(),
            photographer: mediaCreditSchema.optional(),
            tags: z.string().max(1500).optional(),
            autoTag: z.enum(["true", "false"]).optional(),
          }).parse(req.body);
          // Validate before reserving space or uploading any stored objects.
          const uploadTags = metadata.tags
            ? z.array(mediaTagSchema.pipe(z.string().max(100))).parse(JSON.parse(metadata.tags)).slice(0,30)
            : [];
          const community = resolveGalleryOwnership(event).category === "CREATOR";
          if (community) {
            if (metadata.type!=="image" || !req.file.mimetype.startsWith("image/")) throw new MediaLimitError("Video uploads are not available for Community Creators.");
            if (req.file.size>communityLimits.imageBytes) throw new MediaLimitError("Images must be no larger than 5 MB.");
          }
          if (!req.user!.isAdmin && !await takeBetaRate(`upload:${req.user!.id}`,120,3600000))
            throw new MediaLimitError("Too many uploads. Please try again later.");
          const inputLimit = metadata.type === "image" ? community ? communityLimits.imageBytes : mediaPolicy.imageBytes : mediaPolicy.videoBytes;
          if (req.file.size > inputLimit)
            throw new MediaLimitError(`${metadata.type === "image" ? "Image" : "Video"} exceeds the ${inputLimit.toLocaleString("en-US")}-byte limit`);
          const strategy = community ? "creator-original" : "official";
          const keys = createMediaKeys(req.file.mimetype, strategy);
          reservationId = randomUUID();
          const saved = await uploadMedia(req.file, metadata.type, keys,async (bytes, outputKeys)=>{
            await storage.reserveMedia(reservationId!,eventId,event.creatorId,bytes,outputKeys.storageKey,outputKeys.thumbnailKey,req.user!.isAdmin);
          }, strategy);
          const item = await storage.finishMedia(reservationId, insertMediaItemSchema.parse({
            eventId,
            type: saved.mediaType,
            url: saved.url,
            thumbnail: saved.thumbnail,
            storedBytes: saved.storedBytes,
            highBytes: saved.highBytes,
            lowBytes: saved.lowBytes,
            objectCount: saved.objectCount,
            caption: metadata.caption || "",
            photographer: metadata.photographer || "",
            tags: uploadTags,
            isPremium: false,
          }), undefined, undefined, community || metadata.type === "video" || metadata.autoTag === "true",!!event.creatorId);
          if (event.creatorId) await reviewMediaSafety(item.id,event.creatorId);
          res.status(201).json({...await storage.getMediaItem(item.id),analysis:await analysisStatus(item.id)});
          void kickAnalysisWorker();
        } catch (error) {
          console.error("Media upload failed");
          if (reservationId) await storage.abandonMedia(reservationId).catch(cleanupError => console.error("Upload cleanup pending:", cleanupError));
          res.status(error instanceof MediaBusyError ? 503 : error instanceof MediaLimitError ? 413 : error instanceof z.ZodError || error instanceof SyntaxError || error instanceof RetiredMediaTagError || error instanceof InvalidPhotoError ? 400 : 502).json({
            error: error instanceof RetiredMediaTagError || error instanceof MediaBusyError || error instanceof MediaLimitError || error instanceof InvalidPhotoError ? error.message : error instanceof z.ZodError && error.issues.some(issue => issue.message === retiredTagMessage) ? retiredTagMessage : error instanceof z.ZodError || error instanceof SyntaxError ? "Invalid upload details" : "Could not store media",
          });
        } finally {
          const { unlink } = await import("fs/promises");
          await unlink(req.file.path).catch(() => undefined);
        }
      });
    } catch (error) {
      next(error);
    }
  });

  // Create media items
  // Auto-tag media using AI
  app.post("/api/media/:id/analyze", requireCreator, async (req, res) => {
    try {
      const mediaId = Number(req.params.id);
      if (!Number.isSafeInteger(mediaId) || mediaId < 1) {
        return res.status(400).json({ error: "Invalid media ID" });
      }

      const mediaItem = await storage.getMediaItem(mediaId);
      if (!mediaItem) {
        return res.status(404).json({ error: "Media item not found" });
      }
      const event = mediaItem.eventId ? await storage.getEvent(mediaItem.eventId) : undefined;
      if (!canManageEvent(req.user, event?.creatorId ?? null)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!isAITaggingConfigured()) return res.status(503).json({ error: "AI tagging is not configured" });

      console.log(`Beginning AI analysis for media ${mediaId} of type ${mediaItem.type}`);

      const options = z.object({ retry: z.boolean().optional(), reanalyse: z.boolean().optional() }).strict().parse(req.body || {});
      res.status(202).json({ success: true, ...await enqueueAnalysis(mediaItem, { ...options, recognition: true }) });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid analysis request" });
      console.error('Media analysis failed');
      res.status(503).json({ error: error instanceof AnalysisUnavailable ? error.message : "AI analysis could not be queued" });
    }
  });

  app.get("/api/media/:id/analysis", requireCreator, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid media ID" });
      const item = await storage.getMediaItem(id);
      const event = item?.eventId ? await storage.getEvent(item.eventId) : undefined;
      if (!item || !event) return res.status(404).json({ error: "Media not found" });
      if (!canManageEvent(req.user, event.creatorId ?? null)) return res.status(403).json({ error: "Forbidden" });
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ ...await analysisStatus(id), tags: item.tags, category: item.category, identification:item.identification,
        identificationManual:item.identificationManual, recognitionSession:item.recognitionSession,
        caption:item.caption,captionSource:item.captionSource,matchStatus:item.photoMatchStatus });
    } catch { res.status(503).json({ error: "Analysis status unavailable" }); }
  });
  app.get("/api/events/:id/analysis", requireCreator, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid event" });
      const event = await storage.getEvent(id);
      if (!event) return res.status(404).json({ error: "Event not found" });
      if (!canManageEvent(req.user, event.creatorId ?? null)) return res.status(403).json({ error: "Forbidden" });
      const jobs = await db.select({ mediaId: mediaItems.id, status: automaticAnalysisStatusSql(),
        tags: activeMediaTagsSql(mediaItems.tags), generatedTags: activeMediaTagsSql(mediaAnalysisJobs.generatedTags), error: mediaAnalysisJobs.error })
        .from(mediaItems).leftJoin(mediaAnalysisJobs, eq(mediaItems.id, mediaAnalysisJobs.mediaId))
        .innerJoin(eventsTable,eq(eventsTable.id,mediaItems.eventId))
        .where(and(sql`${mediaItems.archivedAt} is null`,eq(mediaItems.eventId, id))).limit(1000);
      res.setHeader("Cache-Control", "private, no-store");
      res.json(jobs);
    } catch { res.status(503).json({ error: "Analysis status unavailable" }); }
  });

  app.post("/api/media/:id/caption-preview", requireCreator, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid image." });
    try {
      const media = await storage.getMediaItem(id);
      if (!media) return res.status(404).json({ error: "Image not found." });
      const event = media.eventId ? await storage.getEvent(media.eventId) : undefined;
      if (!event || !canManageEvent(req.user, event.creatorId)) return res.status(403).json({ error: "Access denied." });
      if (media.type !== "image") return res.status(422).json({ error: "Only images can be analyzed." });
      const requestedScene = z.object({ scene: z.enum(scenes).optional() }).parse(req.body || {}).scene;
      const [known]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,id));
      const stored=known?.status==="completed" && known.recognition!==null &&
        (known.fingerprint===analysisFingerprint(media.thumbnail) ||
          known.fingerprint==="recognition:"+analysisFingerprint(media.thumbnail)) ? known : undefined;
      if (!stored && !isAITaggingConfigured()) return res.status(503).json({ error: "AI image analysis is unavailable." });
      const now = Date.now();
      captionDetections.forEach((value, key) => { if (value.expires < now) captionDetections.delete(key); });
      let cached = captionDetections.get(id);
      if (!stored && (!cached || cached.thumbnail !== media.thumbnail)) {
        if (!req.user!.isAdmin && !await takeBetaRate(`analysis:${req.user!.id}`,12,3600000))
          return res.status(429).json({error:"You have reached the hourly analysis limit. Please try later."});
        if (captionDetections.size >= 100) captionDetections.delete(captionDetections.keys().next().value!);
        const result = recognitionImageInput(media).then(input => withVisionBudget(() => detectRaceNumbers(input)));
        cached = { thumbnail: media.thumbnail, expires: now + 5 * 60_000, result };
        captionDetections.set(id, cached);
        void result.catch(() => { if (captionDetections.get(id)?.result === result) captionDetections.delete(id); });
      }
      const detected=stored ? {numbers:supportedPhotoObservations(stored.recognition!).map(row=>row.number).filter(Boolean),
        vehicles:supportedPhotoObservations(stored.recognition!),
        scene:(stored.generatedTags || []).includes("Starting Grid") ? "Start" as const :
          (stored.generatedTags || []).includes("Race Action") ? "Race Action" as const : null} : await cached!.result;
      const scene = requestedScene || detected.scene;
      const identified=media.identificationManual ? media.identification :
        await identifyEntries(event,detected.vehicles.filter(v=>v.number),media.recognitionSession,db,true,true);
      const entries=identified.filter(row=>row.source!=="visual").map(row=>({
        number:row.number,team:row.team,car:row.vehicle,drivers:row.drivers}));
      const [eventSeries] = event.seriesId ? await db.select({name:series.name}).from(series).where(eq(series.id,event.seriesId)) : [];
      const result = proposeCaption(event, entries, media.identificationManual ? identified.map(row=>row.number).filter(Boolean) : detected.numbers, scene, eventSeries?.name || null);
      return res.json({ ...result, scene });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid scene type." });
      console.error("Caption preview failed");
      return res.status(502).json({ error: "AI image analysis could not check the numbers. The image remains unchanged." });
    }
  });

  app.put("/api/media/:id", requireCreator, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid media item." });
    try {
      const item = await storage.getMediaItem(id);
      if (!item) return res.status(404).json({ error: "Media item not found." });
      const event = item.eventId ? await storage.getEvent(item.eventId) : undefined;
      if (!event || !canManageEvent(req.user, event.creatorId)) return res.status(403).json({ error: "Access denied." });
      const changes = z.object({
        caption: z.string().max(1000).optional(),
        photographer: mediaCreditSchema.optional(),
        tags: z.array(mediaTagSchema.pipe(z.string().max(100))).max(100).optional(),
        category: z.string().max(100).optional(),
        identification: z.array(identificationSchema).max(12).optional(),
        recognitionSession: z.string().trim().max(120).nullable().optional(),
      }).strict().parse(req.body);
      const updated = await db.transaction(async tx => {
        await tx.select().from(eventsTable).where(eq(eventsTable.id,event.id)).for("update");
        await tx.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,id)).for("update");
        const [current] = await tx.select().from(mediaItems).where(eq(mediaItems.id,id)).for("update");
        if (!current) throw new Error("Media no longer exists");
        const meaningful = (entries: typeof current.identification) => entries.map(entry =>
          Object.keys(entry).filter(k=>k !== "source").sort().map(k=>entry[k as keyof typeof entry]));
        const identificationChanged = changes.identification !== undefined &&
          JSON.stringify(meaningful(changes.identification)) !== JSON.stringify(meaningful(current.identification));
        const suppressedAITags = changes.tags ? Array.from(new Set([...current.suppressedAITags,
          ...(current.tags || []).filter(tag=>!changes.tags!.includes(tag))])).filter(tag=>!changes.tags!.includes(tag))
          : current.suppressedAITags;
        const [result] = await tx.update(mediaItems).set({ ...changes, suppressedAITags,
          ...("caption" in changes ? {captionSource:"manual"} : {}),
          ...(event.creatorId ? {contentVersion:sql`${mediaItems.contentVersion}+1`,safetyStatus:"error",safetyReason:"Safety check pending."} : {}),
          ...(changes.tags ? {manualTags:changes.tags} : {}),
          identification: identificationChanged ? changes.identification!.map(i=>({...i,source:"manual" as const})) : current.identification,
          identificationManual: current.identificationManual || identificationChanged }).where(eq(mediaItems.id,id)).returning();
        if (changes.recognitionSession !== undefined && changes.recognitionSession !== current.recognitionSession)
          await tx.update(mediaAnalysisJobs).set({referenceRevision:-1}).where(eq(mediaAnalysisJobs.mediaId,id));
        return result;
      });
      if (event.creatorId) await reviewMediaSafety(id,event.creatorId);
      void kickAnalysisWorker();
      return res.json(await storage.getMediaItem(id));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.some(issue => issue.message === retiredTagMessage) ? retiredTagMessage : "Invalid media details (caption: maximum 1000 characters)." });
      return res.status(500).json({ error: "The media item could not be updated." });
    }
  });

  async function managedEntryEvent(req: express.Request, res: express.Response) {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid event." }); return null; }
    const event = await storage.getEvent(id);
    if (!event) { res.status(404).json({ error: "Event not found." }); return null; }
    if (!canManageEvent(req.user, event.creatorId)) { res.status(403).json({ error: "Access to this entry list denied." }); return null; }
    return event;
  }
  app.get("/api/events/:id/entries", requireCreator, async (req, res) => {
    try {
      const event = await managedEntryEvent(req, res);
      if (event) res.json(await storage.getEventEntries(event.id));
    } catch { res.status(500).json({ error: "The entry list could not be loaded." }); }
  });
  app.put("/api/events/:id/entries", requireCreator, async (req, res) => {
    try {
      const event = await managedEntryEvent(req, res);
      if (!event) return;
      const { rows } = entryRowsSchema.parse(req.body);
      if (entryConflicts(rows).length) return res.status(400).json({ error: "Duplicate or ambiguous race numbers (including leading zeros). Please correct them." });
      await storage.replaceEventEntries(event.id, rows);
      res.json({ rows });
      void kickAnalysisWorker().catch(()=>console.error("Post-entry-list analysis wake-up failed"));
    } catch (error) {
      res.status(error instanceof z.ZodError ? 400 : 500).json({ error: error instanceof z.ZodError ? "Incomplete entry rows. Please check the number, team, car and drivers." : "The entry list could not be saved." });
    }
  });
  const previewEntryFile = (req: express.Request, res: express.Response) => {
    entryUpload(req, res, async error => {
      if (!req.user!.isAdmin && !await takeBetaRate(`reference:${req.user!.id}`,20,3600000))
        return res.status(429).json({error:"Too many reference analyses. Please try later."});
      if (error) return res.status(413).json({ error: "Entry list too large or invalid (maximum 8 MiB)." });
      if (!req.file) return res.status(400).json({ error: "Please select a file." });
      try {
        // Only actual image/scanned-PDF requests consume a shared vision slot.
        res.json(await parseEntryFile(req.file.buffer, req.file.mimetype, req.file.originalname, withVisionBudget));
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : "";
        res.status(/not configured|unavailable|failed/i.test(message) ? 503 : 400)
          .json({ error: /not configured|unavailable|failed/i.test(message) ? "Text recognition is unavailable. Entries can still be added manually." : message.slice(0, 200) || "The file could not be read." });
      }
    });
  };
  app.post("/api/events/entries/preview", requireCreator, previewEntryFile);
  app.post("/api/events/:id/entries/preview", requireCreator, async (req, res) => {
    try {
      const event = await managedEntryEvent(req, res);
      if (!event) return;
      previewEntryFile(req, res);
    } catch { res.status(500).json({ error: "Entry list preview failed." }); }
  });

  app.post("/api/media", requireCreator, (_req, res) => {
    res.status(410).json({ error: "Use the multipart event media upload endpoint" });
  });

  app.get("/api/admin/media-usage", requireAdmin, async (_req, res) => {
    try { res.json(await storage.mediaUsage()); }
    catch (error) { console.error("Media usage failed:", error); res.status(500).json({ error: "Could not load media usage" }); }
  });
  app.get("/api/admin/native-upload-diagnostics", requireAdmin, async (_req, res) => {
    res.set("Cache-Control","no-store");
    const controller=new AbortController();
    const disconnected=()=>{if(!res.writableEnded)controller.abort();};
    res.once("close",disconnected);
    try {
      const result=await nativeUploadDiagnostics(controller.signal);
      if(!res.destroyed)res.json(result);
    }
    catch {
      if(!res.destroyed)res.status(503).json({error:"Upload diagnostics are temporarily unavailable. No recovery action was performed."});
    }finally{res.removeListener("close",disconnected);}
  });
  app.post("/api/admin/media-cleanup", requireAdmin, async (_req, res) => {
    try { await storage.cleanupObjects(); res.json(await storage.mediaUsage()); }
    catch (error) { console.error("Media cleanup failed:", error); res.status(500).json({ error: "Could not reconcile media objects" }); }
  });

  // Delete media item
  app.delete("/api/media/:id", requireCreator, async (req, res) => {
    try {
      const media = await storage.getMediaItem(parseInt(req.params.id));
      if (!media) return res.status(404).json({ error: "Media item not found" });
      const event = media.eventId ? await storage.getEvent(media.eventId) : undefined;
      if (!canManageEvent(req.user, event?.creatorId ?? null)) return res.status(403).json({ error: "Forbidden" });
      await storage.deleteMediaItem(media.id);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting media:', error);
      res.status(500).json({ error: "Failed to delete media" });
    }
  });

  // Get series
  app.get("/api/series", async (req, res) => {
    try {
      const seriesData = await storage.getSeries();
      const records = Array.isArray(seriesData)?seriesData:[];
      res.json((await Promise.all(records.map(async record=>{
        const owner=record.creatorId?await storage.getUser(record.creatorId):undefined;
        return record.creatorId && (!owner || owner.suspended || owner.creatorStatus==="rejected")?null:record;
      }))).filter(Boolean));
    } catch (error) {
      console.error('Error fetching series:', error);
      res.status(500).json({ error: "Failed to fetch series" });
    }
  });

  // Get single series
  app.get("/api/series/:id", async (req, res) => {
    try {
      const seriesData = await storage.getSeries(parseInt(req.params.id));
      if (!seriesData) {
        return res.status(404).json({ error: "Series not found" });
      }
      const owner = !Array.isArray(seriesData) && seriesData.creatorId ? await storage.getUser(seriesData.creatorId) : undefined;
      if (owner?.suspended || owner?.creatorStatus==="rejected") return res.status(404).json({error:"Series not found"});
      res.json(seriesData);
    } catch (error) {
      console.error('Error fetching series:', error);
      res.status(500).json({ error: "Failed to fetch series" });
    }
  });

  // Create series
  app.post("/api/series", requireCreator, async (req, res) => {
    try {
      if (!req.user!.isAdmin && (!req.user!.emailVerifiedAt || !verificationConfigured()))
        return res.status(403).json({error:"Verify your email before publishing a community series."});
      const seriesData = insertSeriesSchema.parse({
        ...req.body,
        creatorId: req.user?.isAdmin ? null : req.user?.id,
      });
      if (!req.user!.isAdmin && (seriesData.logo || (await checkContent(JSON.stringify({name:seriesData.name,description:seriesData.description}))).status!=="approved"))
        return res.status(400).json({error:"Use neutral series text without external logos."});
      const series = await storage.createSeries(seriesData);
      res.status(201).json(series);
    } catch (error) {
      console.error('Error creating series:', error);
      res.status(400).json({ error: "Failed to create series" });
    }
  });

  // Update series
  app.put("/api/series/:id", requireCreator, async (req, res) => {
    try {
      const seriesRecord = await storage.getSeries(parseInt(req.params.id));
      if (!seriesRecord || Array.isArray(seriesRecord)) return res.status(404).json({ error: "Series not found" });
      if (!canManageEvent(req.user, seriesRecord.creatorId)) return res.status(403).json({ error: "Forbidden" });
      const seriesData = updateSeriesSchema.parse(req.body);
      if (seriesRecord.creatorId && (!req.user!.emailVerifiedAt || !verificationConfigured()))
        return res.status(403).json({error:"Verify your email before updating a public community series."});
      if (seriesRecord.creatorId && (seriesData.logo || (await checkContent(JSON.stringify({...seriesRecord,...seriesData}))).status!=="approved"))
        return res.status(400).json({error:"Use neutral series text without external logos."});
      const series = await storage.updateSeries(parseInt(req.params.id), seriesData);
      res.json(series);
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Use fixed field messages, not provider/SQL errors or submitted values.
        const messages: Record<string, string> = {
          name: "Please enter a valid, non-empty series name.",
          logo: "Please use a valid logo URL or PNG data URL, or leave the logo empty.",
          description: "Description must be text of no more than 1000 characters, or empty.",
        };
        return res.status(400).json({
          error: Array.from(new Set(error.issues.map(issue =>
            messages[String(issue.path[0])] || "Provide a series name, logo or description to update."
          ))).join(" "),
        });
      }
      console.error('Error updating series');
      res.status(500).json({ error: "Could not save the series. Please try again." });
    }
  });

  // Delete series
  app.delete("/api/series/:id", requireCreator, async (req, res) => {
    try {
      const seriesId = parseInt(req.params.id);
      const seriesRecord = await storage.getSeries(seriesId);
      if (!seriesRecord || Array.isArray(seriesRecord)) return res.status(404).json({ error: "Series not found" });
      if (!canManageEvent(req.user, seriesRecord.creatorId)) return res.status(403).json({ error: "Forbidden" });

      // First, update any events that reference this series to remove the reference
      const events = await storage.getEvents();
      const eventsToUpdate = events.filter(event => event.seriesId === seriesId);

      // Storage clears event references before deleting the series.
      await storage.deleteSeries(seriesId);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting series:', error);
      res.status(500).json({ error: "Failed to delete series" });
    }
  });

  // Get user by ID
  app.get("/api/users/:id", async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const user = await publicCreatorById(userId, req.user?.suspended ? undefined : req.user?.id);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Return a simplified version without sensitive information
      res.setHeader("Cache-Control", "private, no-store");
      res.json(user);
    } catch (error) {
      console.error('Error fetching user:', error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // Add new endpoints for creator management
  app.get("/api/users/pending-creators", requireAdmin, async (req, res) => {
    try {
      // Only allow admins to access this endpoint
      const users = await storage.getAllUsers();
      const pendingCreators = users.filter(user => user.creatorStatus === 'pending');
      res.json(pendingCreators);
    } catch (error) {
      console.error('Error fetching pending creators:', error);
      res.status(500).json({ error: "Failed to fetch pending creators" });
    }
  });

  app.patch("/api/users/:id/creator-status", requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const { status } = req.body;

      console.log('Processing creator status update:', {
        userId,
        status,
        body: req.body
      });

      if (!['approved', 'rejected'].includes(status)) {
        console.log('Invalid status provided:', status);
        return res.status(400).json({ error: "Invalid status" });
      }

      const user = await storage.updateUserCreatorStatus(userId, status);
      res.json(user);
    } catch (error) {
      console.error('Error updating creator status:', error);
      res.status(500).json({
        error: "Failed to update creator status",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post("/api/creator/request", requireAuth, async (req, res) => {
    try {
      if (!verificationConfigured() || !req.user!.emailVerifiedAt)
        return res.status(403).json({error:"Verify your email address before activating Creator access."});
      if (req.user!.creatorStatus==="rejected" || req.user!.suspended)
        return res.status(403).json({error:"Creator access has been blocked. Contact an administrator."});
      // Legacy public profile images are left unchanged, not silently approved.
      // New registrations cannot provide external imagery; self-activation
      // does not upload or replace a historical picture.
      const safety = await checkContent(JSON.stringify({username:req.user!.username,bio:req.user!.bio}));
      if (safety.status!=="approved") return res.status(403).json({error:"Your public profile text could not be approved."});
      const activated = await db.transaction(async tx => {
        const [before] = await tx.select().from(users).where(eq(users.id, req.user!.id)).for("update");
        const [updated] = await tx.update(users).set({isCreator:true,creatorStatus:"approved"})
          .where(sql`${users.id}=${req.user!.id} and not ${users.suspended} and coalesce(${users.creatorStatus},'pending')<>'rejected' and ${users.emailVerifiedAt} is not null`).returning();
        if (updated && !(before?.isCreator && before.creatorStatus === "approved"))
          await enqueueTransactionalEmail(tx, "creator-welcome", updated.id);
        return updated;
      });
      if (!activated) return res.status(403).json({error:"Creator activation is blocked."});
      const {password,...user} = activated;
      res.json(user);
    } catch (error) {
      console.error('Error requesting creator status:', error);
      res.status(500).json({ error: "Failed to request creator status" });
    }
  });

  // Get events by creator ID (public endpoint)
  app.get("/api/events/creator/:id", async (req, res) => {
    try {
      const creatorId = parseInt(req.params.id);
      if (isNaN(creatorId)) {
        return res.status(400).json({ error: "Invalid creator ID" });
      }
      
      const events = await visibleEvents(await storage.getEventsByCreator(creatorId));
      res.json(events.map(publicEventThumbnails));
    } catch (error) {
      console.error('Error fetching creator events:', error);
      res.status(500).json({ error: "Failed to fetch creator events" });
    }
  });

  app.get("/api/creator/earnings", requireCreator, async (req, res) => {
    res.status(503).json({error:BETA_NOTICE});
  });

  app.post("/api/events", requireAdmin, async (req, res) => {
    try {
      const { creatorId: _ignored, entryRows: _entryRows, ...details } = req.body;
      const eventData = insertEventSchema.parse({ ...details, isPremium: false });
      await validateOfficialEventImages(eventData);
      const event = await storage.createEvent(eventData, creationEntries(req.body));
      res.status(201).json(event);
    } catch (error) {
      const failure = eventCreationError(error);
      if (failure.status === 503) console.error("Official event creation could not be confirmed");
      res.status(failure.status).json({ error: failure.message });
    }
  });

  // Batch analyze endpoint for multiple media items
  app.post("/api/media/batch-analyze", requireCreator, async (req, res) => {
    try {
      if (!isAITaggingConfigured()) {
        return res.status(503).json({ error: "AI tagging is not configured" });
      }

      const { mediaIds } = req.body;
      
      if (!Array.isArray(mediaIds) || mediaIds.length === 0 || mediaIds.length > 25) {
        return res.status(400).json({ error: "No media IDs provided" });
      }

      const results = [];
      const errors = [];

      // Queue independently; background workers own the provider budget.
      for (const id of mediaIds) {
        try {
          const mediaId = Number(id);
          if (!Number.isSafeInteger(mediaId) || mediaId < 1) { errors.push({ id, error: "Invalid media ID" }); continue; }
          const mediaItem = await storage.getMediaItem(mediaId);

          if (!mediaItem) {
            errors.push({ id, error: "Media item not found" });
            continue;
          }
          const event = mediaItem.eventId ? await storage.getEvent(mediaItem.eventId) : undefined;
          if (!canManageEvent(req.user, event?.creatorId ?? null)) {
            errors.push({ id, error: "Forbidden" });
            continue;
          }

          results.push({ id: mediaId, success: true, ...await enqueueAnalysis(mediaItem, req.body?.retry === true) });
        } catch (error) {
          console.error(`Error analyzing media ID ${id}`);
          errors.push({ 
            id,
            error: "AI analysis failed for this media"
          });
        }
      }

      res.status(202).json({
        success: results.length > 0,
        processed: results.length,
        failed: errors.length,
        results,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      console.error('Error in batch AI analysis');
      res.status(502).json({ error: "Batch AI analysis failed" });
    }
  });

  const httpServer = createServer(app);
  if (options.workers!==false) {
    startAnalysisWorker();
    startImportWorker();
  }

  return httpServer;
}

const entryRowsSchema = z.object({ rows: z.array(entryRowSchema).max(500) });
