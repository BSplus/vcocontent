import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { insertEventSchema, insertMediaItemSchema, insertSeriesSchema } from "@shared/schema";
import express from "express";
import path from "path";
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from "http";
import { parse as parseCookie } from "cookie";

export async function registerRoutes(app: Express): Promise<Server> {
  setupAuth(app);

  // Serve static files from the attached_assets directory
  app.use('/attached_assets', express.static(path.join(process.cwd(), 'attached_assets')));

  // API Routes
  app.get("/api/events", async (req, res) => {
    try {
      const events = await storage.getEvents();
      res.json(events);
    } catch (error) {
      console.error('Error fetching events:', error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  // Get top shots
  app.get("/api/media/top-shots", async (req, res) => {
    try {
      const media = await storage.getAllMediaItems();
      console.log('Fetching top shots, total media items:', media.length);

      const topShots = media
        .filter(item => item.type === "image")
        .sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0))
        .slice(0, 3);

      console.log('Top shots selected:', topShots.map(shot => ({
        id: shot.id,
        downloads: shot.downloadCount,
        type: shot.type
      })));

      res.json(topShots);
    } catch (error) {
      console.error('Error fetching top shots:', error);
      res.status(500).json({ error: "Failed to fetch top shots" });
    }
  });

  // Track downloads and increment counter
  app.post("/api/media/:id/download", async (req, res) => {
    try {
      const mediaId = parseInt(req.params.id);
      const mediaItem = await storage.getMediaItem(mediaId);

      if (!mediaItem) {
        return res.status(404).json({ error: "Media item not found" });
      }

      await storage.updateMediaItem(mediaId, {
        ...mediaItem,
        downloadCount: (mediaItem.downloadCount || 0) + 1
      });

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error tracking download:', error);
      res.status(500).json({ error: "Failed to track download" });
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
      const media = await storage.getMediaItems(parseInt(req.params.id));
      res.json(media);
    } catch (error) {
      console.error('Error fetching event media:', error);
      res.status(500).json({ error: "Failed to fetch event media" });
    }
  });

  // Get all media
  app.get("/api/media", async (req, res) => {
    try {
      const media = await storage.getAllMediaItems();
      res.json(media);
    } catch (error) {
      console.error('Error fetching all media:', error);
      res.status(500).json({ error: "Failed to fetch media" });
    }
  });

  // Create media items
  app.post("/api/media", async (req, res) => {
    try {
      const mediaItems = Array.isArray(req.body) ? req.body : [req.body];
      const parsedItems = mediaItems.map(item => insertMediaItemSchema.parse(item));

      const createdItems = await Promise.all(
        parsedItems.map(item => storage.createMediaItem(item))
      );

      res.status(201).json(createdItems);
    } catch (error) {
      console.error('Error creating media items:', error);
      res.status(400).json({ error: "Failed to create media items", details: error });
    }
  });

  // Delete media item
  app.delete("/api/media/:id", async (req, res) => {
    try {
      await storage.deleteMediaItem(parseInt(req.params.id));
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
  app.post("/api/series", async (req, res) => {
    try {
      const seriesData = insertSeriesSchema.parse(req.body);
      const series = await storage.createSeries(seriesData);
      res.status(201).json(series);
    } catch (error) {
      console.error('Error creating series:', error);
      res.status(400).json({ error: "Failed to create series" });
    }
  });

  // Update series
  app.put("/api/series/:id", async (req, res) => {
    try {
      const seriesData = insertSeriesSchema.partial().parse(req.body);
      const series = await storage.updateSeries(parseInt(req.params.id), seriesData);
      res.json(series);
    } catch (error) {
      console.error('Error updating series:', error);
      res.status(400).json({ error: "Failed to update series" });
    }
  });

  // Delete series
  app.delete("/api/series/:id", async (req, res) => {
    try {
      const seriesId = parseInt(req.params.id);

      // First, update any events that reference this series to remove the reference
      const events = await storage.getEvents();
      const eventsToUpdate = events.filter(event => event.seriesId === seriesId);

      for (const event of eventsToUpdate) {
        await storage.updateEvent(event.id, { ...event, seriesId: null });
      }

      // Then delete the series
      await storage.deleteSeries(seriesId);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting series:', error);
      res.status(500).json({ error: "Failed to delete series" });
    }
  });

  // Delete event
  app.delete("/api/events/:id", async (req, res) => {
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

  // Add these new creator endpoints after existing routes but before WebSocket setup
  app.post("/api/creator/request", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await storage.updateUserCreatorStatus(req.user.id, 'pending');
      res.json(user);
    } catch (error) {
      console.error('Error requesting creator status:', error);
      res.status(500).json({ error: "Failed to request creator status" });
    }
  });

  app.get("/api/creator/events", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (!req.user.isCreator) {
        return res.status(403).json({ error: "Not a creator" });
      }

      const events = await storage.getEventsByCreator(req.user.id);
      res.json(events);
    } catch (error) {
      console.error('Error fetching creator events:', error);
      res.status(500).json({ error: "Failed to fetch creator events" });
    }
  });

  app.get("/api/creator/earnings", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (!req.user.isCreator) {
        return res.status(403).json({ error: "Not a creator" });
      }

      const earnings = await storage.getCreatorEarnings(req.user.id);
      res.json(earnings);
    } catch (error) {
      console.error('Error fetching creator earnings:', error);
      res.status(500).json({ error: "Failed to fetch creator earnings" });
    }
  });

  // Add this before the existing events POST endpoint
  app.post("/api/creator/events", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (!req.user.isCreator) {
        return res.status(403).json({ error: "Not a creator" });
      }

      const eventData = insertEventSchema.parse({
        ...req.body,
        creatorId: req.user.id
      });

      const event = await storage.createEvent(eventData);
      res.status(201).json(event);
    } catch (error) {
      console.error('Error creating creator event:', error);
      res.status(400).json({ error: "Failed to create event" });
    }
  });


  app.post("/api/events", async (req, res) => {
    try {
      const eventData = insertEventSchema.parse(req.body);
      const event = await storage.createEvent(eventData);
      res.status(201).json(event);
    } catch (error) {
      console.error('Error creating event:', error);
      res.status(400).json({ error: "Failed to create event" });
    }
  });

  const httpServer = createServer(app);

  // Set up WebSocket server with improved error handling and secure configuration
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    clientTracking: true,
    // Verify client authentication with better error handling
    verifyClient: async (info: { req: IncomingMessage }, done: (res: boolean, code?: number, message?: string) => void) => {
      try {
        // Log all headers for debugging
        console.log('WebSocket: Connection attempt - Headers:', info.req.headers);

        const cookie = info.req.headers.cookie;
        if (!cookie) {
          console.log('WebSocket: No cookie found in connection request');
          // During development, allow connections without cookie
          if (process.env.NODE_ENV === 'development') {
            console.log('WebSocket: Development mode - accepting connection without cookie');
            done(true);
            return;
          }
          done(false, 401, 'No authentication cookie found');
          return;
        }

        const cookies = parseCookie(cookie);
        console.log('WebSocket: Parsed cookies:', cookies);

        const sessionId = cookies['vco.sid']; // Match your session cookie name
        if (!sessionId) {
          console.log('WebSocket: No session ID found in cookies');
          // During development, allow connections without session
          if (process.env.NODE_ENV === 'development') {
            console.log('WebSocket: Development mode - accepting connection without session');
            done(true);
            return;
          }
          done(false, 401, 'No session ID found');
          return;
        }

        // Accept the connection if we have a session ID
        console.log('WebSocket: Valid session found, accepting connection');
        done(true);
      } catch (error) {
        console.error('WebSocket: Error verifying client:', error);
        done(false, 500, 'Internal server error during authentication');
      }
    }
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    console.log('WebSocket: New connection established');

    // Handle connection setup
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      // Try to send error to client if connection is still open
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Connection error occurred'
        }));
      }
    });

    // Send initial connection status
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'connection',
        status: 'connected',
        message: 'Successfully connected to WebSocket server'
      }));
    }

    // Handle client messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('WebSocket: Received message type:', message.type);

        // Handle different message types
        switch (message.type) {
          case 'auth':
            // Authentication already handled by verifyClient
            ws.send(JSON.stringify({ type: 'auth_success' }));
            break;
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
          default:
            console.log('WebSocket: Unhandled message type:', message.type);
        }
      } catch (error) {
        console.error('WebSocket: Error processing message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Failed to process message'
        }));
      }
    });

    // Handle client disconnection
    ws.on('close', () => {
      console.log('WebSocket: Client disconnected');
    });
  });

  return httpServer;
}