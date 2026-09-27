import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { insertEventSchema, insertMediaItemSchema, insertSeriesSchema, users } from "@shared/schema";
import express from "express";
import path from "path";
import { requireAuth, requireAdmin, requireCreator, requireOwnershipOrAdmin } from "./middleware/auth";
import { log } from "./vite";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { mediaUpload, uploadMedia, deleteStoredMedia, readMediaStream, getMediaContentType } from "./media-storage";
import { z } from "zod";
import { generateTagsForImage, generateTagsForVideo, categorizeContent, isAITaggingConfigured } from "./utils/ai-tagger";

const BETA_NOTICE = "Paid downloads are not available during the public beta";
const canManageEvent = (user: Express.User | undefined, creatorId: number | null) =>
  !!user && (user.isAdmin || (user.isCreator && creatorId === user.id));
const publicMedia = <T extends { isPremium: boolean; url: string; thumbnail: string }>(item: T): T => ({
  ...item,
  url: item.isPremium ? "" : item.url,
  thumbnail: item.isPremium && item.thumbnail.startsWith("data:")
    ? "/attached_assets/%2389_3.png"
    : item.thumbnail,
});

async function analysisImageInput(url: string): Promise<string> {
  const key = /^\/api\/media\/files\/(thumb-[0-9a-f-]{36}\.webp)$/.exec(url)?.[1];
  if (!key) {
    if (/^https:\/\//.test(url) || /^data:image\/(jpeg|png|webp);base64,/.test(url)) return url;
    throw new Error("No analyzable image thumbnail");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of readMediaStream(key)) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 5 * 1024 * 1024) throw new Error("Thumbnail exceeds analysis limit");
    chunks.push(bytes);
  }
  return `data:image/webp;base64,${Buffer.concat(chunks).toString("base64")}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth already set up in index.ts

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
        return res.status(404).json(result);
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

  // Authorize a free download; the original file route checks again before serving.
  app.post("/api/media/:id/download", requireAuth, async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const mediaId = parseInt(req.params.id);
      const mediaItem = await storage.getMediaItem(mediaId);

      if (!mediaItem) {
        return res.status(404).json({ error: "Media item not found" });
      }

      if (mediaItem.isPremium) {
        return res.status(403).json({ error: BETA_NOTICE });
      }
      const event = mediaItem.eventId ? await storage.getEvent(mediaItem.eventId) : undefined;
      if (event?.isPremium) return res.status(403).json({ error: BETA_NOTICE });

      await storage.updateMediaItem(mediaId, {
        downloadCount: (mediaItem.downloadCount || 0) + 1
      });
      res.json({ success: true, url: mediaItem.url });
    } catch (error) {
      console.error('Error processing download:', error);
      res.status(500).json({ error: "Failed to process download" });
    }
  });

  // Use JSON parser for all other routes
  app.use(express.json());

  // Get top shots
  app.get("/api/media/top-shots", async (req, res) => {
    try {
      const media = await storage.getAllMediaItems();
      const eventsByCreator = new Set((await storage.getEvents()).filter(event => event.creatorId).map(event => event.id));
      console.log('Fetching top shots, total media items:', media.length);

      const premiumEvents = new Set((await storage.getEvents()).filter(event => event.isPremium).map(event => event.id));
      const topShots = media
        .filter(item => item.type === "image" && !item.isPremium && !eventsByCreator.has(item.eventId ?? -1) && !premiumEvents.has(item.eventId ?? -1))
        .sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0))
        .slice(0, 3);

      console.log('Top shots selected:', topShots.map(shot => ({
        id: shot.id,
        downloads: shot.downloadCount,
        type: shot.type
      })));

      res.json(topShots.map(publicMedia));
    } catch (error) {
      console.error('Error fetching top shots:', error);
      res.status(500).json({ error: "Failed to fetch top shots" });
    }
  });
  
  // Get popular creator content
  app.get("/api/media/creator-top", async (req, res) => {
    try {
      const media = await storage.getAllMediaItems();
      const events = await storage.getEvents();
      console.log('Fetching popular creator content, total media items:', media.length);

      // Get all media items from creator events
      const creatorMedia = media.filter(item => {
        // If media is associated with an event, check if that event has a creator
        if (item.eventId) {
          // Find the event that contains this media item
          const event = events.find(e => e.id === item.eventId);
          if (event && event.creatorId) return true;
        }
        
        return false;
      });
      
      console.log('Found creator media items:', creatorMedia.length);

      const topCreatorMedia = creatorMedia
        .filter(item => !item.isPremium && !events.some(event => event.id === item.eventId && event.isPremium))
        .sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0))
        .slice(0, 3);

      console.log('Top creator content selected:', topCreatorMedia.map(item => ({
        id: item.id,
        downloads: item.downloadCount,
        type: item.type,
        isPremium: item.isPremium
      })));

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
      
      const media = await storage.getAllMediaItems();
      const events = await storage.getEvents();
      
      // Get all media items from this specific creator's events
      const creatorMedia = media.filter(item => {
        // If media item has this creator's ID directly
        // If media is associated with an event created by this creator
        if (item.eventId) {
          const event = events.find(e => e.id === item.eventId);
          if (event && event.creatorId === creatorId) return true;
        }
        
        return false;
      });
      
      // Sort by download count, views, or other popularity metrics
      const topCreatorMedia = creatorMedia
        .filter(item => !item.isPremium && !events.some(event => event.id === item.eventId && event.isPremium))
        .sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0))
        .slice(0, 8); // Return more items for the creator profile page
      
      res.json(topCreatorMedia.map(publicMedia));
    } catch (error) {
      console.error(`Error fetching creator ${req.params.id} top media:`, error);
      res.status(500).json({ error: "Failed to fetch creator's popular media" });
    }
  });
  // Get single event
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
      const event = await storage.getEvent(parseInt(req.params.id));
      if (!event) return res.status(404).json({ error: "Event not found" });
      if (event.isPremium) return res.json([]);
      const media = await storage.getMediaItems(parseInt(req.params.id));
      res.json(media.map(publicMedia));
    } catch (error) {
      console.error('Error fetching event media:', error);
      res.status(500).json({ error: "Failed to fetch event media" });
    }
  });

  // Get all media (different behavior based on auth status)
  app.get("/api/media", async (req, res) => {
    try {
      const allMedia = await storage.getAllMediaItems();
      const premiumEvents = new Set((await storage.getEvents()).filter(event => event.isPremium).map(event => event.id));
      return res.json(allMedia.filter(item => !premiumEvents.has(item.eventId ?? -1)).map(publicMedia));
    } catch (error) {
      console.error('Error fetching all media:', error);
      res.status(500).json({ error: "Failed to fetch media" });
    }
  });

  // Private objects are served only after looking up their owning media record.
  app.get("/api/media/files/:key", async (req, res) => {
    const key = req.params.key;
    if (!/^(media|thumb)-[0-9a-f-]{36}\.(jpg|png|gif|webp|mp4|mov|webm)$/.test(key)) {
      return res.status(404).end();
    }
    try {
      const storedUrl = `/api/media/files/${key}`;
      const record = (await storage.getAllMediaItems()).find(item =>
        item.url === storedUrl || item.thumbnail === storedUrl);
      if (!record) return res.status(404).end();
      const event = record.eventId ? await storage.getEvent(record.eventId) : undefined;
      const isOriginal = record.url === storedUrl;
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
        if (uploadError) return res.status(400).json({ error: uploadError.message });
        if (!req.file) return res.status(400).json({ error: "A file is required" });
        let saved: Awaited<ReturnType<typeof uploadMedia>> | undefined;
        try {
          const metadata = z.object({
            type: z.enum(["image", "video"]),
            caption: z.string().max(200).optional(),
            photographer: z.string().max(150).optional(),
            tags: z.string().max(1500).optional(),
          }).parse(req.body);
          const tags = metadata.tags ? JSON.parse(metadata.tags) : [];
          if (!Array.isArray(tags) || !tags.every(tag => typeof tag === "string" && tag.length <= 100)) {
            throw new Error("Invalid tags");
          }
          saved = await uploadMedia(req.file, metadata.type);
          const item = await storage.createMediaItem(insertMediaItemSchema.parse({
            eventId,
            type: saved.mediaType,
            url: saved.url,
            thumbnail: saved.thumbnail,
            caption: metadata.caption || "",
            photographer: metadata.photographer || "",
            tags: tags.slice(0, 30),
            isPremium: false,
          }));
          res.status(201).json(item);
        } catch (error) {
          if (saved) {
            try {
              await deleteStoredMedia(saved);
            } catch (cleanupError) {
              console.error("Failed to remove objects for rejected upload:", cleanupError);
            }
          }
          console.error("Media upload failed:", error);
          res.status(error instanceof z.ZodError ? 400 : 502).json({
            error: error instanceof z.ZodError ? "Invalid upload details" : "Could not store media",
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

      const generatedTags = await generateTagsForImage(await analysisImageInput(mediaItem.thumbnail));

      if (generatedTags.length === 0) {
        return res.status(422).json({ error: "No matching tags were found" });
      }

      // Combine with existing tags if present
      const existingTags = Array.isArray(mediaItem.tags) ? mediaItem.tags : [];
      const combinedTags = Array.from(new Set([...existingTags, ...generatedTags]));

      // Attempt to categorize the content
      const category = await categorizeContent(combinedTags);
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
      console.error('AI media analysis failed');
      res.status(502).json({ error: "AI analysis failed. Please try again later." });
    }
  });

  app.post("/api/media", requireCreator, (_req, res) => {
    res.status(410).json({ error: "Use the multipart event media upload endpoint" });
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
      const eventData = insertEventSchema.parse({ ...req.body, creatorId: null, isPremium: false });
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

      log(`Processing batch AI analysis for ${mediaIds.length} media items`, 'batch-analysis');

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

          // Generate tags based on media type
          let tags: string[] = [];
          if (mediaItem.type === 'image') {
            tags = await generateTagsForImage(await analysisImageInput(mediaItem.thumbnail));
          } else if (mediaItem.type === 'video') {
            tags = await generateTagsForVideo(mediaItem.url, mediaItem.thumbnail || mediaItem.url);
          }

          if (tags.length > 0) {
            // Categorize the content
            const category = await categorizeContent(tags);

            // Update the media item with the generated tags and category
            const updatedMediaItem = await storage.updateMediaItem(mediaId, {
              tags,
              category
            });

            results.push({
              id: mediaId,
              success: true,
              tags,
              category
            });

            log(`AI analysis completed for media ID: ${mediaId}`, 'batch-analysis');
          } else {
            errors.push({ id: mediaId, error: "Failed to generate tags" });
          }
        } catch (error) {
          console.error("AI batch analysis failed");
          errors.push({ 
            id,
            error: "AI analysis failed. Please try again later."
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
      console.error('Error in batch AI analysis:', error);
      res.status(500).json({ 
        error: "Batch AI analysis failed", 
        details: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
