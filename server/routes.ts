import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { insertEventSchema, insertMediaItemSchema, insertSeriesSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  setupAuth(app);

  // Series routes
  app.get("/api/series", async (_req, res) => {
    const seriesList = await storage.getSeries();
    res.json(seriesList);
  });

  app.get("/api/series/:id", async (req, res) => {
    const series = await storage.getSeries(parseInt(req.params.id));
    if (!series) return res.status(404).send("Series not found");
    res.json(series);
  });

  app.post("/api/series", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.status(403).send("Unauthorized");
    }

    const parseResult = insertSeriesSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(parseResult.error);
    }

    const series = await storage.createSeries(parseResult.data);
    res.status(201).json(series);
  });

  app.put("/api/series/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.status(403).send("Unauthorized");
    }

    const parseResult = insertSeriesSchema.partial().safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(parseResult.error);
    }

    try {
      const series = await storage.updateSeries(parseInt(req.params.id), parseResult.data);
      res.json(series);
    } catch (error) {
      res.status(404).send((error as Error).message);
    }
  });

  app.delete("/api/series/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.status(403).send("Unauthorized");
    }

    try {
      await storage.deleteSeries(parseInt(req.params.id));
      res.sendStatus(204);
    } catch (error) {
      res.status(404).send((error as Error).message);
    }
  });

  // Event routes
  app.get("/api/events", async (_req, res) => {
    const events = await storage.getEvents();
    res.json(events);
  });

  app.get("/api/events/:id", async (req, res) => {
    const event = await storage.getEvent(parseInt(req.params.id));
    if (!event) return res.status(404).send("Event not found");
    res.json(event);
  });

  app.post("/api/events", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.status(403).send("Unauthorized");
    }

    const parseResult = insertEventSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(parseResult.error);
    }

    const event = await storage.createEvent(parseResult.data);
    res.status(201).json(event);
  });

  app.put("/api/events/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.status(403).send("Unauthorized");
    }

    const parseResult = insertEventSchema.partial().safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(parseResult.error);
    }

    try {
      const event = await storage.updateEvent(parseInt(req.params.id), parseResult.data);
      res.json(event);
    } catch (error) {
      res.status(404).send((error as Error).message);
    }
  });

  app.delete("/api/events/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.status(403).send("Unauthorized");
    }

    await storage.deleteEvent(parseInt(req.params.id));
    res.sendStatus(204);
  });

  // Media routes
  app.get("/api/media", async (_req, res) => {
    try {
      console.time('getAllMedia');
      const allMedia = await storage.getAllMediaItems();
      console.timeEnd('getAllMedia');
      console.log(`Retrieved ${allMedia.length} media items`);
      res.json(allMedia);
    } catch (error) {
      console.error('Failed to fetch all media items:', error);
      res.status(500).json({ error: "Failed to fetch media items" });
    }
  });

  app.get("/api/events/:eventId/media", async (req, res) => {
    const eventId = parseInt(req.params.eventId);
    console.time(`getEventMedia-${eventId}`);

    try {
      console.log(`Fetching media for event ${eventId}`);
      const media = await storage.getMediaItems(eventId);
      console.log(`Retrieved ${media.length} media items for event ${eventId}`);
      console.timeEnd(`getEventMedia-${eventId}`);
      res.json(media);
    } catch (error) {
      console.error(`Error fetching media for event ${eventId}:`, error);
      res.status(500).json({ error: "Failed to fetch media items" });
    }
  });

  app.post("/api/media", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.status(403).send("Unauthorized");
    }

    try {
      // Verify event exists before creating media
      const event = await storage.getEvent(req.body.eventId);
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      const parseResult = insertMediaItemSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json(parseResult.error);
      }

      const mediaItem = await storage.createMediaItem(parseResult.data);
      res.status(201).json(mediaItem);
    } catch (error) {
      console.error('Failed to create media item:', error);
      res.status(500).json({ error: "Failed to create media item" });
    }
  });

  app.put("/api/media/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.status(403).send("Unauthorized");
    }

    const parseResult = insertMediaItemSchema.partial().safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json(parseResult.error);
    }

    try {
      const mediaItem = await storage.updateMediaItem(parseInt(req.params.id), parseResult.data);
      res.json(mediaItem);
    } catch (error) {
      res.status(404).send((error as Error).message);
    }
  });

  app.delete("/api/media/:id", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.status(403).send("Unauthorized");
    }

    await storage.deleteMediaItem(parseInt(req.params.id));
    res.sendStatus(204);
  });

  const httpServer = createServer(app);
  return httpServer;
}