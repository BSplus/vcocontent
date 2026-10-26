import type { Express } from "express";
import { pageMetadata } from "@shared/pagination";
import type { Event } from "@shared/schema";
import { createHash } from "crypto";
import sharp from "sharp";
import { storage } from "./storage";
import { canManage, eventPublic, mediaPublic } from "./beta-access";
import { mediaPolicy } from "./media-policy";
import { MediaBusyError, withMediaWorkBudget } from "./media-work-budget";
import { eventImagePolicy } from "@shared/event-image-policy";
import { readMediaStream } from "./media-storage";
import { EventImageError, galleryThumbnailReference } from "./gallery-thumbnail-policy";
import { requireAuth } from "./middleware/auth";
import { thumbnailCache, sendPrivateThumbnail } from "./thumbnail-cache";
import { thumbnailDigest } from "./thumbnail-cache";
import { legacyThumbnail } from "./legacy-thumbnail";
import { sendPreparedThumbnail } from "./prepared-thumbnail";
import { safeState } from "./beta-policy";

type Field = "customThumbnail" | "coverImage";
export const DEFAULT_EVENT_IMAGE = "/attached_assets/%2389_3.png";
const filePattern = /^\/api\/media\/files\/(thumb-[0-9a-f-]{36}\.webp)$/;
const legacyPattern = /^\/api\/media\/legacy\/([1-9][0-9]*)\/thumbnail$/;
const inlinePattern = /^data:image\/(jpeg|png|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export { EventImageError };

async function validateImageBytes(input: Buffer, format?: string) {
  if (!input.length || input.length > eventImagePolicy.bytes)
    throw new EventImageError("Image file must not exceed 1 MiB.");
  await withMediaWorkBudget(async () => {
    try {
      const image = sharp(input, { animated: true, limitInputPixels: eventImagePolicy.pixels, failOn: "warning" });
      const info = await image.metadata();
      if (!["jpeg", "png", "webp", "gif"].includes(info.format ?? "") || format && info.format !== format)
        throw new EventImageError("Use JPEG, PNG, WebP or GIF; the image content must match its declared format.");
      if (!info.width || !info.height || info.width * info.height > eventImagePolicy.pixels)
        throw new EventImageError("Image must not exceed 40 megapixels (all frames combined).");
      // Metadata alone accepts truncated files. Decode every frame before saving.
      await image.raw().toBuffer();
    } catch (error) {
      if (error instanceof EventImageError) throw error;
      if (error instanceof Error && /pixel limit/i.test(error.message))
        throw new EventImageError("Image must not exceed 40 megapixels (all frames combined).");
      throw new EventImageError("Image is damaged or cannot be decoded. Choose a valid JPEG, PNG, WebP or GIF.");
    }
  });
}

/** Validate only changed official fields; never retroactively reject historical values. */
export async function validateOfficialEventImages(changes: Partial<Pick<Event, Field>>, previous?: Event) {
  for (const field of ["customThumbnail", "coverImage"] as const) {
    const value = changes[field];
    if (value === undefined || value === null || value === "" || value === previous?.[field]) continue;
    try {
      if (value.startsWith("data:")) {
        if (value.length > Math.ceil(eventImagePolicy.bytes * 4 / 3) + 100)
          throw new EventImageError("Image file must not exceed 1 MiB.");
        const match = inlinePattern.exec(value);
        if (!match) throw new EventImageError("Use JPEG, PNG, WebP or GIF encoded as a Base64 image.");
        const bytes = Buffer.from(match[2], "base64");
        if (bytes.toString("base64") !== match[2])
          throw new EventImageError("Image Base64 data is invalid.");
        await validateImageBytes(bytes, match[1]);
      } else if (value === DEFAULT_EVENT_IMAGE) {
        // Trusted built-in preset, not a new upload (historical asset exceeds upload limits).
        continue;
      } else {
        const file = filePattern.exec(value);
        const legacy = legacyPattern.exec(value);
        const media = previous && (file || legacy)
          ? file ? await storage.findMediaByKey(file[1]) : await storage.getMediaItem(Number(legacy![1]))
          : undefined;
        if (!media || !previous || galleryThumbnailReference(media, previous) !== value)
          throw new EventImageError("Choose an image file or a public, non-premium thumbnail from this event. External URLs, original files and other events' media are not allowed.");
        if (file) {
          const stream = readMediaStream(file[1]);
          const timer = setTimeout(() => stream.destroy(new Error("Image read timed out")), 10000);
          try {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of stream) {
              const bytes = Buffer.from(chunk);
              size += bytes.length;
              if (size > eventImagePolicy.bytes) throw new EventImageError("Image file must not exceed 1 MiB.");
              chunks.push(bytes);
            }
            await validateImageBytes(Buffer.concat(chunks), "webp");
          } finally { clearTimeout(timer); stream.destroy(); }
        } else {
          // Historical thumbnail URLs must still point to bounded, real image data.
          const match = inlinePattern.exec(media.thumbnail);
          if (!match || media.thumbnail.length > Math.ceil(eventImagePolicy.bytes * 4 / 3) + 100)
            throw new EventImageError("This historical thumbnail cannot be validated. Choose an image file instead.");
          await validateImageBytes(Buffer.from(match[2], "base64"), match[1]);
        }
      }
    } catch (error) {
      if (error instanceof MediaBusyError) throw new EventImageError("Image processing is busy. Please retry shortly.");
      const label = field === "coverImage" ? "Cover image" : "Event thumbnail";
      throw new EventImageError(`${label}: ${error instanceof EventImageError ? error.message : "Image could not be read. Choose another image or retry."}`);
    }
  }
}

/** Creator images must be independently approved gallery photos, never uploads. */
export async function validateEventImages(changes: Partial<Pick<Event, Field>>, previous: Event) {
  if (previous.creatorId) {
    for (const field of ["customThumbnail", "coverImage"] as const) {
      const value = changes[field];
      if (!value || value === previous[field]) continue;
      if (!filePattern.test(value) && !legacyPattern.test(value))
        throw new EventImageError("Select an approved photo from this gallery; external images are not allowed.");
    }
  }
  await validateOfficialEventImages(changes, previous);
}

function staticImage(value: string): boolean {
  if (!/^\/attached_assets\/[^/?#]+\.(?:png|jpe?g|gif|webp)$/i.test(value)) return false;
  try {
    const filename = decodeURIComponent(value.slice("/attached_assets/".length));
    return !/[\\/\0]/.test(filename) && filename !== "..";
  } catch { return false; }
}

function signature(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

/** No inline payloads, external origins or original-file links in public lists. */
export function eventThumbnailReference(event: Event, field: Field): string | null {
  const value = event[field];
  if (!value || event.isPremium) return null;
  const managed = filePattern.test(value) || legacyPattern.test(value);
  const official = !event.creatorId && (staticImage(value) ||
    value.length <= Math.ceil(mediaPolicy.imageBytes * 4 / 3) + 100 && inlinePattern.test(value));
  if (!managed && !official) return null;
  if (value === DEFAULT_EVENT_IMAGE) return value;
  return `/api/events/${event.id}/thumbnail?field=${field}&v=${signature(value)}&direct=1`;
}

export function publicEventThumbnails(event: Event): Event {
  return { ...event, customThumbnail: eventThumbnailReference(event, "customThumbnail"),
    coverImage: eventThumbnailReference(event, "coverImage") };
}

/** Bounded, shared-budget decoding; cache only small output, never source Base64. */
export async function inlineEventThumbnail(value: string): Promise<Buffer> {
  if (value.length > Math.ceil(mediaPolicy.imageBytes * 4 / 3) + 100)
    throw new Error("Thumbnail exceeds image budget");
  const match = inlinePattern.exec(value);
  if (!match) throw new Error("Unsupported thumbnail");
  const key = signature(value);
  return thumbnailCache.get(`event-${mediaPolicy.thumbnailEdge}-${key}`, () => withMediaWorkBudget(async () => {
    const input = Buffer.from(match[2], "base64");
    if (!input.length || input.length > mediaPolicy.imageBytes) throw new Error("Invalid image size");
    const options = { limitInputPixels: mediaPolicy.maxPixels, failOn: "error" as const };
    const metadata = await sharp(input, options).metadata();
    if (metadata.format !== match[1]) throw new Error("Image type mismatch");
    for (const quality of [76, 62, 48, 36, 24]) {
      const output = await sharp(input, options).rotate()
        .resize({ width: mediaPolicy.thumbnailEdge, height: mediaPolicy.thumbnailEdge,
          fit: "inside", withoutEnlargement: true }).webp({ quality }).toBuffer();
      if (output.length < 100 * 1024) return output;
    }
    throw new Error("Thumbnail exceeds output budget");
  }));
}

export function registerEventThumbnailRoute(app: Express) {
  app.get("/api/events/:id/card-preview", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(404).end();
    try {
      const event = await storage.getEvent(id, false);
      if (!event || !await eventPublic(event)) return res.status(404).end();
      const fallbacks = await storage.getEventCardFallbacks([id]);
      return res.json({ galleryThumbnail: fallbacks.get(id) ?? null });
    } catch { return res.status(503).end(); }
  });
  app.get("/api/events/:id/thumbnail-options", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(page) || page < 1 || page > 100000)
      return res.status(400).json({ error: "Invalid gallery or page." });
    try {
      const event = await storage.getEvent(id);
      if (!event) return res.status(404).json({ error: "Gallery not found." });
      if (!canManage(req.user, event)) return res.status(403).json({ error: "You cannot edit this gallery." });
      const metadata = pageMetadata(await storage.countEventThumbnailOptions(event),page,24);
      const photos = await storage.getEventThumbnailOptions(event, metadata.page);
      res.json({ ...metadata, photos: photos.slice(0, 24).map(photo => ({
        id: photo.id, caption: photo.caption, reference: galleryThumbnailReference(photo, event),
        preview: galleryThumbnailReference(photo, event),
      })) });
    } catch {
      res.status(500).json({ error: "Gallery photos could not be loaded. Please retry." });
    }
  });
  app.get("/api/events/:id/thumbnail", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const id = Number(req.params.id);
    const field = req.query.field ?? "customThumbnail";
    if (!Number.isSafeInteger(id) || id < 1 || !["customThumbnail", "coverImage"].includes(field as string))
      return res.status(404).end();
    try {
      // Always re-authorize, even when the bounded generated image is cached.
      const event = await storage.getEvent(id);
      const publicOnly = req.query.public === "1";
      if (!event || event.isPremium || ((publicOnly || !canManage(req.user, event)) && !await eventPublic(event))) return res.status(404).end();
      const value = event[field as Field];
      if (!value || !eventThumbnailReference(event, field as Field)) return res.status(404).end();
      const file = filePattern.exec(value);
      const legacy = legacyPattern.exec(value);
      if (file || legacy) {
        const media = file ? await storage.findMediaByKey(file[1], false) : await storage.getMediaItem(Number(legacy![1]), false);
        if (!media || galleryThumbnailReference(media, event, false) !== value ||
          (publicOnly && !safeState(media)) ||
          ((publicOnly || !canManage(req.user, event)) && !await mediaPublic(media, event))) return res.status(404).end();
        if (req.query.direct === "1") {
          if (file) return await sendPreparedThumbnail(req, res, file[1]);
          return sendPrivateThumbnail(req, res, await legacyThumbnail(media.thumbnail), thumbnailDigest(media.thumbnail));
        }
        return res.redirect(302, value);
      }
      if (staticImage(value)) return res.redirect(302, value);
      const thumbnail = await inlineEventThumbnail(value);
      sendPrivateThumbnail(req, res, thumbnail, signature(value));
    } catch (error) {
      if (error instanceof MediaBusyError) res.setHeader("Retry-After", "5");
      if (!res.headersSent) res.status(error instanceof MediaBusyError ? 503 : 404).end();
      else res.destroy();
    }
  });
}
