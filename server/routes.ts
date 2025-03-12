import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { insertEventSchema, insertMediaItemSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  setupAuth(app);

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
  app.get("/api/events/:eventId/media", async (req, res) => {
    const media = await storage.getMediaItems(parseInt(req.params.eventId));
    res.json(media);
  });

  app.post("/api/media", async (req, res) => {
    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.status(403).send("Unauthorized");
    }

    console.log('Received media upload request:', {
      eventId: req.body.eventId,
      type: req.body.type,
      caption: req.body.caption,
      photographer: req.body.photographer,
      tags: req.body.tags,
    });

    const parseResult = insertMediaItemSchema.safeParse(req.body);
    if (!parseResult.success) {
      console.error('Media upload validation failed:', parseResult.error);
      return res.status(400).json(parseResult.error);
    }

    try {
      const mediaItem = await storage.createMediaItem(parseResult.data);
      console.log('Media item created successfully:', mediaItem.id);
      res.status(201).json(mediaItem);
    } catch (error) {
      console.error('Failed to create media item:', error);
      res.status(500).send((error as Error).message);
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