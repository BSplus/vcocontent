import type { Express } from "express";
import { storage } from "./storage";
import { eventPublic, mediaPublic } from "./beta-access";
import { brandSharingImage, eventSharingImage, mediaSharingImage } from "./sharing-selection";
import { galleryFilePattern } from "./gallery-thumbnail-policy";
import { sendPreparedThumbnail } from "./prepared-thumbnail";
import { legacyThumbnail } from "./legacy-thumbnail";
import { sendPrivateThumbnail, thumbnailDigest } from "./thumbnail-cache";
import { MediaBusyError } from "./media-work-budget";

export function registerSharingRoutes(app: Express) {
  app.get("/api/sharing/media/:id/image", async (req, res) => {
    res.set("Cache-Control", "private, no-store").set("X-Content-Type-Options", "nosniff");
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) return res.status(404).end();
    try {
      const item = await storage.getMediaItem(id);
      const event = item?.eventId ? await storage.getEvent(item.eventId) : undefined;
      if (!item || !event || !await mediaSharingImage(item, event)) return res.status(404).end();
      const file = galleryFilePattern.exec(item.thumbnail);
      if (file) return await sendPreparedThumbnail(req, res, file[1]);
      return sendPrivateThumbnail(req, res, await legacyThumbnail(item.thumbnail), thumbnailDigest(item.thumbnail));
    } catch (error) {
      if (!res.headersSent) res.status(error instanceof MediaBusyError ? 503 : 404).end();
      else res.destroy();
    }
  });
  app.get("/api/sharing/:kind/:id", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647 || !["event", "media"].includes(req.params.kind))
      return res.status(404).end();
    try {
      const item = req.params.kind === "media" ? await storage.getMediaItem(id) : undefined;
      const eventId = item ? item.eventId : id;
      const event = eventId ? await storage.getEvent(eventId) : undefined;
      if (!event || event.isPremium || !await eventPublic(event) ||
        req.params.kind === "media" && (!item || item.isPremium || !await mediaPublic(item, event)))
        return res.status(404).end();
      const selected = item ? await mediaSharingImage(item, event) : await eventSharingImage(event);
      if (!selected) return res.status(404).end();
      return res.json({ ...selected, branded: selected.image === brandSharingImage.image });
    } catch { return res.status(503).end(); }
  });
}
