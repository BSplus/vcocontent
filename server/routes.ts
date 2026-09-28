import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { insertEventSchema, insertMediaItemSchema, insertSeriesSchema, entryRowSchema, users } from "@shared/schema";
import express from "express";
import path from "path";
import { requireAuth, requireAdmin, requireCreator, requireOwnershipOrAdmin } from "./middleware/auth";
import { log } from "./vite";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { generateTagsForImage, categorizeContent, isAITaggingConfigured, testManagedOpenAI, detectRaceNumbers } from "./utils/ai-tagger";
import { entryConflicts, proposeCaption, scenes } from "./caption-proposal";
import { parseEntryFile } from "./entry-list";
import multer from "multer";
import { mediaUpload, uploadMedia, createMediaKeys, readMediaStream, getMediaContentType } from "./media-storage";
import { analysisImageInput } from "./image-analysis";
import { mediaPolicy, MediaLimitError } from "./media-policy";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { z } from "zod";
import { discover, importStatus, startImport, NextcloudError } from "./nextcloud";
import { downloadAccess } from "./download-access";

const BETA_NOTICE = "Paid downloads are not available during the public beta";

const entryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1048576, files: 1, fields: 0, parts: 1 } }).single("file");
const OPENAI_TEST_COOLDOWN_MS = 60_000;
function mediaPage(value: unknown): number | null {
  if (value === undefined) return 1;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && n <= 100000 ? n : null;
}
const canManageEvent = (user: Express.User | undefined, creatorId: number | null) =>
  !!user && (user.isAdmin || (user.isCreator && creatorId === user.id));
const publicMedia = <T extends { id: number; isPremium: boolean; url: string; thumbnail: string }>(item: T): T => ({
  ...item,
  url: item.isPremium ? "" : item.url.startsWith("data:")
    ? `/api/media/legacy/${item.id}/file` : item.url,
  thumbnail: item.isPremium && item.thumbnail.startsWith("data:")
    ? "/attached_assets/%2389_3.png"
    : item.thumbnail.startsWith("data:") ? `/api/media/legacy/${item.id}/thumbnail` : item.thumbnail,
});

export async function registerRoutes(app: Express): Promise<Server> {
  const openAITestCooldowns = new Map<number, number>();
  const captionDetections = new Map<number, { thumbnail: string; expires: number; result: Promise<Awaited<ReturnType<typeof detectRaceNumbers>>> }>();
  // Auth already set up in index.ts
  const cleanupTimer = setInterval(() => {
    void storage.cleanupObjects().catch(error => console.error("Media reconciliation failed:", error));
  }, 15 * 60 * 1000);
  cleanupTimer.unref();

  // Serve static files from the attached_assets directory
  app.use('/attached_assets', express.static(path.join(process.cwd(), 'attached_assets')));

  // Events route - different behavior based on auth status
  app.get("/api/events", async (req, res) => {
    try {
      const events = await storage.getEvents();
      
      // Remove heavy base64 thumbnails from the list to improve performance
      // Thumbnails will be loaded lazily by the frontend when needed
      const eventsWithoutThumbnails = events.map(event => ({
        ...event,
        customThumbnail: null // Replace with null to keep structure but remove payload
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

      const event = await storage.createEvent(eventData);
      res.status(201).json(event);
    } catch (error) {
      console.error('Error creating creator event:', error);
      res.status(400).json({ 
        error: "Failed to create event",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
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
      const updatedEvent = await storage.updateEvent(eventId, {
        ...eventChanges,
        isPremium: false,
      });
      res.json(updatedEvent);
    } catch (error) {
      console.error('Error updating event:', error);
      res.status(400).json({ error: "Failed to update event" });
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
      const access = downloadAccess(mediaItem, event, quality, req.isAuthenticated());
      if (access !== 200) return res.status(access).json({
        error: access === 403 ? BETA_NOTICE : access === 400
          ? "Low resolution is available for images only" : "Sign in to download this media",
      });

      await storage.updateMediaItem(mediaId, {
        downloadCount: (mediaItem.downloadCount || 0) + 1
      });
      const normalized = publicMedia(mediaItem);
      res.json({ success: true, url: quality === "low" ? normalized.thumbnail : normalized.url });
    } catch (error) {
      console.error('Error processing download:', error);
      res.status(500).json({ error: "Failed to process download" });
    }
  });

  // Use JSON parser for all other routes
  app.use(express.json());
  app.get("/api/media/policy", (_req, res) => res.json({
    imageBytes: mediaPolicy.imageBytes,
    videoBytes: mediaPolicy.videoBytes,
    maxPixels: mediaPolicy.maxPixels,
    displayEdge: mediaPolicy.displayEdge,
    thumbnailEdge: mediaPolicy.thumbnailEdge,
    zipCount: mediaPolicy.zipCount,
    zipBytes: mediaPolicy.zipBytes,
  }));

  const nextcloudRequest = z.object({
    sources: z.array(z.object({ link: z.string().url().max(2048), password: z.string().max(256).optional() })).min(1).max(10),
  });
  app.post("/api/admin/nextcloud/preview", requireAdmin, async (req, res) => {
    try {
      const { files, skipped } = await discover(nextcloudRequest.parse(req.body).sources);
      res.json({ count: files.length, images: files.filter(file => file.type === "image").length,
        videos: files.filter(file => file.type === "video").length, skipped });
    } catch (error) {
      res.status(error instanceof z.ZodError || error instanceof NextcloudError ? 400 : 502)
        .json({ error: error instanceof NextcloudError ? error.message : "Nextcloud-Vorschau konnte nicht geladen werden." });
    }
  });
  app.get("/api/admin/events/:id/nextcloud", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Ungültiges Album." });
    if (!await storage.getEvent(id)) return res.status(404).json({ error: "Album nicht gefunden." });
    res.json(await importStatus(id));
  });
  app.post("/api/admin/events/:id/nextcloud", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Ungültiges Album." });
      const event = await storage.getEvent(id);
      if (!event || event.creatorId || event.isPremium) return res.status(404).json({ error: "Admin-Album nicht gefunden." });
      await startImport(id, nextcloudRequest.parse(req.body).sources);
      res.status(202).json(await importStatus(id));
    } catch (error) {
      res.status(error instanceof z.ZodError || error instanceof NextcloudError ? 400 : 502)
        .json({ error: error instanceof NextcloudError ? error.message : "Import konnte nicht gestartet werden." });
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
      if (!item || !event || item.isPremium || event.isPremium) return res.status(404).json({ error: "Media not found" });
      res.json(publicMedia(item));
    } catch (error) {
      console.error("Failed to fetch media:", error);
      res.status(500).json({ error: "Failed to fetch media" });
    }
  });
  app.get("/api/events/:id", async (req, res) => {
    try {
      const event = await storage.getEvent(parseInt(req.params.id));
      if (!event) {
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
      const page = mediaPage(req.query.page);
      if (!page) return res.status(400).json({ error: "Invalid page" });
      const event = await storage.getEvent(parseInt(req.params.id));
      if (!event) return res.status(404).json({ error: "Event not found" });
      if (event.isPremium) return res.json([]);
      const media = await storage.getMediaItems(parseInt(req.params.id), page);
      res.json(media.map(publicMedia));
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
      if (fields !== undefined && (typeof fields !== "string" || fields.length > 32 ||
          fields.split(",").some(field => !["caption", "photographer", "tags"].includes(field))))
        return res.status(400).json({ error: "Invalid search fields" });
      return res.json((await storage.listPublicMedia(page, 48, search || "",
        type === "image" || type === "video" ? type : undefined,
        fields === undefined ? undefined : fields === "" ? [] : fields.split(",") as ("caption" | "photographer" | "tags")[])).map(publicMedia));
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
      const record = await storage.getMediaItem(id);
      if (!record) return res.status(404).end();
      if (variant === "file") {
        const event = record.eventId ? await storage.getEvent(record.eventId) : undefined;
        if (!req.isAuthenticated() || record.isPremium || event?.isPremium)
          return res.status(req.isAuthenticated() ? 403 : 401).json({ error: "Original not available" });
      }
      const dataUrl = variant === "file" ? record.url : record.thumbnail;
      const match = /^data:(image\/(?:jpeg|png|gif|webp)|video\/(?:mp4|webm|quicktime));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
      if (!match) return res.status(404).end();
      let body = Buffer.from(match[2], "base64");
      if (body.length > 100 * 1024 * 1024) return res.status(413).end();
      if (variant === "thumbnail") {
        if (!match[1].startsWith("image/")) return res.status(404).end();
        body = await sharp(body, { limitInputPixels: mediaPolicy.maxPixels })
          .rotate().resize({ width: mediaPolicy.thumbnailEdge, height: mediaPolicy.thumbnailEdge,
            fit: "inside", withoutEnlargement: true })
          .webp({ quality: 72 }).toBuffer();
      }
      res.setHeader("Content-Type", variant === "thumbnail" ? "image/webp" : match[1]);
      res.setHeader("Cache-Control", variant === "file" ? "private, no-store" : "public, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(body);
    } catch (error) {
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
      const record = await storage.findMediaByKey(key);
      if (!record) return res.status(404).end();
      const event = record.eventId ? await storage.getEvent(record.eventId) : undefined;
      const isOriginal = record.url === `/api/media/files/${key}`;
      if (isOriginal && (!req.isAuthenticated() || record.isPremium || event?.isPremium)) {
        return res.status(req.isAuthenticated() ? 403 : 401).json({ error: "Original not available" });
      }
      res.setHeader("Content-Type", getMediaContentType(key));
      res.setHeader("Cache-Control", isOriginal ? "private, no-store" : "public, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const stream = readMediaStream(key);
      stream.on("error", () => {
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
      });
      stream.pipe(res);
    } catch (error) {
      console.error("Media delivery failed:", error);
      if (!res.headersSent) res.status(502).json({ error: "Media is temporarily unavailable" });
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
            photographer: z.string().max(150).optional(),
            tags: z.string().max(1500).optional(),
          }).parse(req.body);
          if (req.file.size > (metadata.type === "image" ? mediaPolicy.imageBytes : mediaPolicy.videoBytes))
            throw new MediaLimitError(`${metadata.type === "image" ? "Image" : "Video"} exceeds the ${metadata.type === "image" ? mediaPolicy.imageBytes / 1048576 : mediaPolicy.videoBytes / 1048576} MiB limit`);
          const keys = createMediaKeys(req.file.mimetype);
          reservationId = randomUUID();
          await storage.reserveMedia(reservationId, eventId, event.creatorId, metadata.type === "image" ? 4 * 1048576 + 100 * 1024 : req.file.size + 100 * 1024, keys.storageKey, keys.thumbnailKey);
          const saved = await uploadMedia(req.file, metadata.type, keys);
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
            tags: metadata.tags
              ? (() => {
                  const parsed = JSON.parse(metadata.tags);
                  if (!Array.isArray(parsed) || !parsed.every(tag => typeof tag === "string" && tag.length <= 100)) {
                    throw new Error("Invalid tags");
                  }
                  return parsed.slice(0, 30);
                })()
              : [],
            isPremium: false,
          }));
          res.status(201).json(item);
        } catch (error) {
          console.error("Media upload failed:", error);
          if (reservationId) await storage.abandonMedia(reservationId).catch(cleanupError => console.error("Upload cleanup pending:", cleanupError));
          res.status(error instanceof MediaLimitError ? 413 : error instanceof z.ZodError ? 400 : 502).json({
            error: error instanceof MediaLimitError ? error.message : error instanceof z.ZodError ? "Invalid upload details" : "Could not store media",
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
      const mediaId = parseInt(req.params.id);
      if (isNaN(mediaId)) {
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
      if (mediaItem.type === "video") {
        return res.status(422).json({ error: "Video tagging requires a real video frame; no frame is available yet" });
      }

      console.log(`Beginning AI analysis for media ${mediaId} of type ${mediaItem.type}`);

      const generatedTags = await generateTagsForImage(await analysisImageInput(mediaItem.thumbnail));

      if (generatedTags.length === 0) {
        return res.status(422).json({ error: "No matching tags were found" });
      }

      console.log(`Generated ${generatedTags.length} tags for media ${mediaId}:`, generatedTags);

      // Combine with existing tags if present
      const existingTags = Array.isArray(mediaItem.tags) ? mediaItem.tags : [];
      const combinedTags = Array.from(new Set([...existingTags, ...generatedTags]));

      // Attempt to categorize the content
      const category = await categorizeContent(combinedTags);
      console.log(`Categorized media ${mediaId} as: ${category}`);

      // Update the media item with new tags and category
      await storage.updateMediaItem(mediaId, {
        tags: combinedTags,
        category
      });

      res.json({
        success: true,
        tags: combinedTags,
        generatedTags,
        category
      });
    } catch (error) {
      console.error('Media analysis failed');
      res.status(502).json({ error: "KI-Analyse fehlgeschlagen. Bitte später erneut versuchen." });
    }
  });

  app.post("/api/media/:id/caption-preview", requireCreator, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Ungültiges Bild." });
    try {
      const media = await storage.getMediaItem(id);
      if (!media) return res.status(404).json({ error: "Bild nicht gefunden." });
      const event = media.eventId ? await storage.getEvent(media.eventId) : undefined;
      if (!event || !canManageEvent(req.user, event.creatorId)) return res.status(403).json({ error: "Kein Zugriff." });
      if (media.type !== "image") return res.status(422).json({ error: "Nur Bilder können ausgewertet werden." });
      const requestedScene = z.object({ scene: z.enum(scenes).optional() }).parse(req.body || {}).scene;
      if (!isAITaggingConfigured()) return res.status(503).json({ error: "Bild-KI ist nicht verfügbar." });
      const now = Date.now();
      captionDetections.forEach((value, key) => { if (value.expires < now) captionDetections.delete(key); });
      let cached = captionDetections.get(id);
      if (!cached || cached.thumbnail !== media.thumbnail) {
        if (captionDetections.size >= 100) captionDetections.delete(captionDetections.keys().next().value!);
        const result = analysisImageInput(media.thumbnail).then(detectRaceNumbers);
        cached = { thumbnail: media.thumbnail, expires: now + 5 * 60_000, result };
        captionDetections.set(id, cached);
        void result.catch(() => { if (captionDetections.get(id)?.result === result) captionDetections.delete(id); });
      }
      const detected = await cached.result;
      const scene = requestedScene || detected.scene;
      const result = proposeCaption(event, await storage.getEventEntries(event.id), detected.numbers, scene);
      return res.json({ ...result, scene });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Ungültige Szenenart." });
      console.error("Caption preview failed");
      return res.status(502).json({ error: "Bild-KI konnte die Nummern nicht prüfen. Das Bild bleibt unverändert." });
    }
  });

  app.put("/api/media/:id", requireCreator, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Ungültiges Medium." });
    try {
      const item = await storage.getMediaItem(id);
      if (!item) return res.status(404).json({ error: "Medium nicht gefunden." });
      const event = item.eventId ? await storage.getEvent(item.eventId) : undefined;
      if (!event || !canManageEvent(req.user, event.creatorId)) return res.status(403).json({ error: "Kein Zugriff." });
      const changes = z.object({
        caption: z.string().max(1000).optional(),
        photographer: z.string().max(150).optional(),
        tags: z.array(z.string().max(100)).max(30).optional(),
        category: z.string().max(100).optional(),
      }).strict().parse(req.body);
      return res.json(await storage.updateMediaItem(id, changes));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Ungültige Medienangaben (Caption max. 1000 Zeichen)." });
      return res.status(500).json({ error: "Medium konnte nicht aktualisiert werden." });
    }
  });

  async function managedEntryEvent(req: express.Request, res: express.Response) {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Ungültiges Event." }); return null; }
    const event = await storage.getEvent(id);
    if (!event) { res.status(404).json({ error: "Event nicht gefunden." }); return null; }
    if (!canManageEvent(req.user, event.creatorId)) { res.status(403).json({ error: "Kein Zugriff auf diese Entry List." }); return null; }
    return event;
  }
  app.get("/api/events/:id/entries", requireCreator, async (req, res) => {
    try {
      const event = await managedEntryEvent(req, res);
      if (event) res.json(await storage.getEventEntries(event.id));
    } catch { res.status(500).json({ error: "Entry List konnte nicht geladen werden." }); }
  });
  app.put("/api/events/:id/entries", requireCreator, async (req, res) => {
    try {
      const event = await managedEntryEvent(req, res);
      if (!event) return;
      const { rows } = entryRowsSchema.parse(req.body);
      if (entryConflicts(rows).length) return res.status(400).json({ error: "Doppelte oder mehrdeutige Startnummern (auch mit führenden Nullen). Bitte korrigieren." });
      await storage.replaceEventEntries(event.id, rows);
      res.json({ rows });
    } catch (error) {
      res.status(error instanceof z.ZodError ? 400 : 500).json({ error: error instanceof z.ZodError ? "Unvollständige Entry-Zeilen. Bitte Nummer, Team, Fahrzeug und Fahrer prüfen." : "Entry List konnte nicht gespeichert werden." });
    }
  });
  app.post("/api/events/:id/entries/preview", requireCreator, async (req, res) => {
    try {
      const event = await managedEntryEvent(req, res);
      if (!event) return;
      entryUpload(req, res, async error => {
        if (error) return res.status(413).json({ error: "Entry List zu groß oder ungültig (maximal 8 MiB)." });
        if (!req.file) return res.status(400).json({ error: "Bitte eine Datei auswählen." });
        try {
          const result = await parseEntryFile(req.file.buffer, req.file.mimetype, req.file.originalname);
          res.json(result);
        } catch (failure) {
          const message = failure instanceof Error ? failure.message : "";
          res.status(/not configured|unavailable|failed/i.test(message) ? 503 : 400)
            .json({ error: /not configured|unavailable|failed/i.test(message) ? "Texterkennung nicht verfügbar. Einträge können weiterhin manuell erfasst werden." : message.slice(0, 200) || "Datei konnte nicht gelesen werden." });
        }
      });
    } catch { res.status(500).json({ error: "Entry-List-Vorschau fehlgeschlagen." }); }
  });

  app.post("/api/media", requireCreator, (_req, res) => {
    res.status(410).json({ error: "Use the multipart event media upload endpoint" });
  });

  app.get("/api/admin/media-usage", requireAdmin, async (_req, res) => {
    try { res.json(await storage.mediaUsage()); }
    catch (error) { console.error("Media usage failed:", error); res.status(500).json({ error: "Could not load media usage" }); }
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
      res.json(seriesData);
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
      res.json(seriesData);
    } catch (error) {
      console.error('Error fetching series:', error);
      res.status(500).json({ error: "Failed to fetch series" });
    }
  });

  // Create series
  app.post("/api/series", requireCreator, async (req, res) => {
    try {
      const seriesData = insertSeriesSchema.parse({
        ...req.body,
        creatorId: req.user?.isAdmin ? null : req.user?.id,
      });
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
      const { creatorId: _ignored, ...seriesData } = insertSeriesSchema.partial().parse(req.body);
      const series = await storage.updateSeries(parseInt(req.params.id), seriesData);
      res.json(series);
    } catch (error) {
      console.error('Error updating series:', error);
      res.status(400).json({ error: "Failed to update series" });
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
      const userId = parseInt(req.params.id);
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Return a simplified version without sensitive information
      const safeUser = {
        id: user.id,
        username: user.username,
        isCreator: user.isCreator,
        creatorStatus: user.creatorStatus,
        profileImage: user.profileImage,
        bio: user.bio
      };
      
      res.json(safeUser);
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
      const user = await storage.updateUserCreatorStatus(req.user!.id, 'pending');
      res.json(user);
    } catch (error) {
      console.error('Error requesting creator status:', error);
      res.status(500).json({ error: "Failed to request creator status" });
    }
  });

  app.get("/api/creator/events", requireCreator, async (req, res) => {
    try {
      const events = await storage.getEventsByCreator(req.user!.id);
      res.json(events);
    } catch (error) {
      console.error('Error fetching creator events:', error);
      res.status(500).json({ error: "Failed to fetch creator events" });
    }
  });
  
  // Get events by creator ID (public endpoint)
  app.get("/api/events/creator/:id", async (req, res) => {
    try {
      const creatorId = parseInt(req.params.id);
      if (isNaN(creatorId)) {
        return res.status(400).json({ error: "Invalid creator ID" });
      }
      
      const events = await storage.getEventsByCreator(creatorId);
      res.json(events);
    } catch (error) {
      console.error('Error fetching creator events:', error);
      res.status(500).json({ error: "Failed to fetch creator events" });
    }
  });

  app.get("/api/creator/earnings", requireCreator, async (req, res) => {
    try {
      const earnings = await storage.getCreatorEarnings(req.user!.id);
      res.json(earnings);
    } catch (error) {
      console.error('Error fetching creator earnings:', error);
      res.status(500).json({ error: "Failed to fetch creator earnings" });
    }
  });

  app.post("/api/creator/events", requireCreator, async (req, res) => {
    try {
      const eventData = insertEventSchema.parse({
        ...req.body,
        creatorId: req.user!.id,
        isPremium: false,
      });
      console.log('Creating event as creator:', eventData);
      const event = await storage.createEvent(eventData);
      res.status(201).json(event);
    } catch (error) {
      console.error('Error creating event as creator:', error);
      res.status(400).json({ 
        error: "Failed to create event", 
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.post("/api/events", requireAdmin, async (req, res) => {
    try {
      const { creatorId: _ignored, ...details } = req.body;
      const eventData = insertEventSchema.parse({ ...details, isPremium: false });
      const event = await storage.createEvent(eventData);
      res.status(201).json(event);
    } catch (error) {
      console.error('Error creating event:', error);
      res.status(400).json({ error: "Failed to create event" });
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

      // Process each media item sequentially to avoid rate limiting
      for (const id of mediaIds) {
        try {
          const mediaId = parseInt(id);
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
          if (mediaItem.type === "video") {
            errors.push({ id, error: "Video frame analysis is not available" });
            continue;
          }

          const generatedTags = await generateTagsForImage(await analysisImageInput(mediaItem.thumbnail));

          if (generatedTags.length > 0) {
            const tags = Array.from(new Set([...(mediaItem.tags || []), ...generatedTags]));
            // Categorize the content
            const category = await categorizeContent(tags);

            // Update the media item with the generated tags and category
            await storage.updateMediaItem(mediaId, {
              tags,
              category
            });

            results.push({
              id: mediaId,
              success: true,
              tags,
              category
            });

          } else {
            errors.push({ id: mediaId, error: "Failed to generate tags" });
          }
        } catch (error) {
          console.error(`Error analyzing media ID ${id}`);
          errors.push({ 
            id,
            error: "AI analysis failed for this media"
          });
        }
      }

      res.json({
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

  return httpServer;
}

const entryRowsSchema = z.object({ rows: z.array(entryRowSchema).max(500) });
