import type { Express } from "express";
import type { Event } from "@shared/schema";
import { createHash } from "crypto";
import sharp from "sharp";
import { storage } from "./storage";
import { eventPublic, mediaPublic } from "./beta-access";
import { mediaPolicy } from "./media-policy";
import { MediaBusyError, withMediaWorkBudget } from "./media-work-budget";

type Field = "customThumbnail" | "coverImage";
export const DEFAULT_EVENT_IMAGE = "/attached_assets/%2389_3.png";
const filePattern = /^\/api\/media\/files\/(thumb-[0-9a-f-]{36}\.webp)$/;
const legacyPattern = /^\/api\/media\/legacy\/([1-9][0-9]*)\/thumbnail$/;
const inlinePattern = /^data:image\/(jpeg|png|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const previews = new Map<string, Promise<Buffer>>();

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
  return `/api/events/${event.id}/thumbnail?field=${field}&v=${signature(value)}`;
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
  const existing = previews.get(key);
  if (existing) return existing;
  const result = withMediaWorkBudget(async () => {
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
  });
  if (previews.size >= 16) previews.delete(previews.keys().next().value!);
  previews.set(key, result);
  try { return await result; }
  catch (error) { if (previews.get(key) === result) previews.delete(key); throw error; }
}

export function registerEventThumbnailRoute(app: Express) {
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
      if (!event || event.isPremium || !await eventPublic(event)) return res.status(404).end();
      const value = event[field as Field];
      if (!value || !eventThumbnailReference(event, field as Field)) return res.status(404).end();
      const file = filePattern.exec(value);
      const legacy = legacyPattern.exec(value);
      if (file || legacy) {
        const media = file ? await storage.findMediaByKey(file[1]) : await storage.getMediaItem(Number(legacy![1]));
        if (!media || media.eventId !== id || media.type !== "image" || media.isPremium ||
          !await mediaPublic(media, event)) return res.status(404).end();
        return res.redirect(302, value);
      }
      if (staticImage(value)) return res.redirect(302, value);
      const thumbnail = await inlineEventThumbnail(value);
      res.type("image/webp").send(thumbnail);
    } catch (error) {
      if (error instanceof MediaBusyError) res.setHeader("Retry-After", "5");
      res.status(error instanceof MediaBusyError ? 503 : 404).end();
    }
  });
}
