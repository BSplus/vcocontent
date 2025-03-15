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
import Stripe from "stripe";
import { requireAuth, requireAdmin, requireCreator, requireOwnershipOrAdmin } from "./middleware/auth";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing required Stripe secret: STRIPE_SECRET_KEY');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
  typescript: true
});

export async function registerRoutes(app: Express): Promise<Server> {
  setupAuth(app);

  // Serve static files from the attached_assets directory
  app.use('/attached_assets', express.static(path.join(process.cwd(), 'attached_assets')));

  // Public routes (no auth required)
  app.get("/api/events", async (req, res) => {
    try {
      const events = await storage.getEvents();
      res.json(events);
    } catch (error) {
      console.error('Error fetching events:', error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  // Creator routes
  app.post("/api/creator/events", requireCreator, async (req, res) => {
    try {
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

  // Update event (creator can only update own events, admin can update any)
  app.put("/api/events/:id", requireOwnershipOrAdmin('creatorId'), async (req, res) => {
    try {
      const eventId = parseInt(req.params.id);
      const event = await storage.getEvent(eventId);

      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      // Only allow creators to update their own events
      if (!req.user.isAdmin && event.creatorId !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      const updatedEvent = await storage.updateEvent(eventId, req.body);
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
      const event = await storage.getEvent(eventId);

      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      // Only allow creators to delete their own events
      if (!req.user.isAdmin && event.creatorId !== req.user.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      await storage.deleteEvent(eventId);
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting event:', error);
      res.status(500).json({ error: "Failed to delete event" });
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
          // Additional admin management logic here
          break;
        default:
          return res.status(400).json({ error: "Invalid action" });
      }

      const updatedUser = await storage.getUser(userId);
      res.json(updatedUser);
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // Credit purchase endpoint
  app.post("/api/credits/purchase", requireAuth, async (req, res) => {
    try {
      const { amount } = req.body;
      const numericAmount = parseInt(amount);

      console.log('Processing purchase request:', {
        amount,
        numericAmount,
        userId: req.user.id
      });

      if (!numericAmount || numericAmount < 1) {
        console.log('Invalid amount provided:', amount);
        return res.status(400).json({ error: "Invalid amount" });
      }

      // Create a payment intent with Stripe
      const paymentIntent = await stripe.paymentIntents.create({
        amount: numericAmount * 100, // Convert to cents
        currency: "eur",
        payment_method_types: ['card'],
        metadata: {
          userId: req.user.id.toString(),
          creditAmount: numericAmount.toString()
        },
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never'
        },
        confirmation_method: 'automatic',
        setup_future_usage: 'off_session'
      });

      console.log('Payment intent created successfully:', {
        intentId: paymentIntent.id,
        status: paymentIntent.status,
        hasClientSecret: !!paymentIntent.client_secret
      });

      res.json({
        clientSecret: paymentIntent.client_secret,
        intentId: paymentIntent.id
      });
    } catch (error) {
      console.error('Stripe error details:', {
        error: error instanceof Stripe.errors.StripeError ? {
          type: error.type,
          code: error.code,
          message: error.message,
          declineCode: error.decline_code
        } : error
      });

      res.status(500).json({
        error: "Failed to create payment intent",
        details: error instanceof Error ? error.message : "Unknown error occurred"
      });
    }
  });

  // Configure raw body parser specifically for Stripe webhook
  app.post("/api/webhook/stripe", express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];

    try {
      console.log('Processing Stripe webhook:', {
        signature: sig ? 'present' : 'missing',
        bodyType: typeof req.body,
        bodyLength: req.body.length
      });
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      console.log('Webhook event processed:', {
        type: event.type,
        object: event.data.object
      });

      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const userId = parseInt(paymentIntent.metadata.userId);
        const creditAmount = parseInt(paymentIntent.metadata.creditAmount);

        console.log('Processing successful payment:', {
          userId,
          creditAmount
        });

        // Update user's credits
        const user = await storage.getUser(userId);
        if (user) {
          const currentCredits = parseFloat(user.credits) || 0;
          await storage.updateUserCredits(userId, currentCredits + creditAmount);
          console.log('Credits updated successfully:', {
            userId,
            oldCredits: currentCredits,
            newCredits: currentCredits + creditAmount
          });
        }
      }

      res.json({ received: true });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  // Use JSON parser for all other routes
  app.use(express.json());


  // Download endpoint with credit check
  app.post("/api/media/:id/download", requireAuth, async (req, res) => {
    try {
      const mediaId = parseInt(req.params.id);
      const mediaItem = await storage.getMediaItem(mediaId);

      if (!mediaItem) {
        return res.status(404).json({ error: "Media item not found" });
      }

      console.log('Processing download request:', {
        mediaId,
        isPremium: mediaItem.isPremium,
        cost: mediaItem.creditCost
      });

      // Check if the media is premium and user has enough credits
      if (mediaItem.isPremium) {
        const user = await storage.getUser(req.user.id);
        const currentCredits = parseFloat(user.credits) || 0;
        const cost = mediaItem.creditCost || 1;

        console.log('Checking user credits:', {
          userId: user.id,
          currentCredits,
          requiredCredits: cost
        });

        if (currentCredits < cost) {
          return res.status(402).json({ error: "Insufficient credits" });
        }

        // Deduct credits and update download count
        await storage.updateUserCredits(req.user.id, currentCredits - cost);

        // If there's a creator, give them 70% of the credits
        if (mediaItem.eventId) {
          const event = await storage.getEvent(mediaItem.eventId);
          if (event?.creatorId) {
            const creator = await storage.getUser(event.creatorId);
            if (creator) {
              const creatorCredits = parseFloat(creator.credits) || 0;
              const creatorShare = cost * 0.7;
              await storage.updateUserCredits(event.creatorId, creatorCredits + creatorShare);

              console.log('Creator earnings processed:', {
                creatorId: creator.id,
                share: creatorShare,
                newTotal: creatorCredits + creatorShare
              });
            }
          }
        }
      }

      // Update download count
      await storage.updateMediaItem(mediaId, {
        ...mediaItem,
        downloadCount: (mediaItem.downloadCount || 0) + 1
      });

      console.log('Download processed successfully:', {
        mediaId,
        newDownloadCount: (mediaItem.downloadCount || 0) + 1
      });

      res.json({ success: true, url: mediaItem.url });
    } catch (error) {
      console.error('Error processing download:', error);
      res.status(500).json({ error: "Failed to process download" });
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
  app.post("/api/media", requireAuth, async (req, res) => {
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
  app.delete("/api/media/:id", requireAuth, async (req, res) => {
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
  app.post("/api/series", requireAuth, async (req, res) => {
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
  app.put("/api/series/:id", requireAuth, async (req, res) => {
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
  app.delete("/api/series/:id", requireAuth, async (req, res) => {
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
      console.log('Successfully updated user status:', user);
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
      const user = await storage.updateUserCreatorStatus(req.user.id, 'pending');
      res.json(user);
    } catch (error) {
      console.error('Error requesting creator status:', error);
      res.status(500).json({ error: "Failed to request creator status" });
    }
  });

  app.get("/api/creator/events", requireCreator, async (req, res) => {
    try {
      const events = await storage.getEventsByCreator(req.user.id);
      res.json(events);
    } catch (error) {
      console.error('Error fetching creator events:', error);
      res.status(500).json({ error: "Failed to fetch creator events" });
    }
  });

  app.get("/api/creator/earnings", requireCreator, async (req, res) => {
    try {
      const earnings = await storage.getCreatorEarnings(req.user.id);
      res.json(earnings);
    } catch (error) {
      console.error('Error fetching creator earnings:', error);
      res.status(500).json({ error: "Failed to fetch creator earnings" });
    }
  });

  app.post("/api/events", requireAuth, async (req, res) => {
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

  // Update WebSocket server configuration section
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