import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { insertEventSchema, insertMediaItemSchema, insertSeriesSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  setupAuth(app);

  app.post("/api/header-image", async (req, res) => {
    console.log('Header image upload request received');
    console.log('Authentication status:', req.isAuthenticated());
    console.log('User:', req.user);

    if (!req.isAuthenticated() || !req.user.isAdmin) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    try {
      const { url } = req.body;

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: "Missing or invalid image data" });
      }

      if (!url.startsWith('data:image/')) {
        return res.status(400).json({ error: "Invalid image format. Please upload an image file." });
      }

      // Calculate base64 data size
      const base64Data = url.split(',')[1];
      if (!base64Data) {
        return res.status(400).json({ error: "Invalid base64 image data" });
      }

      const sizeInBytes = (base64Data.length * 3) / 4;
      const sizeInMB = sizeInBytes / (1024 * 1024);

      if (sizeInMB > 5) {
        return res.status(400).json({ 
          error: "Image file is too large. Maximum size is 5MB.",
          details: `Current size: ${sizeInMB.toFixed(2)}MB`
        });
      }

      const headerImage = await storage.createHeaderImage({ url });
      console.log('Header image created successfully:', headerImage);
      res.status(201).json(headerImage);
    } catch (error) {
      console.error('Failed to create header image:', error);
      res.status(500).json({ 
        error: "Failed to create header image",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}