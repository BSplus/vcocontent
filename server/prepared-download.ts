import type { Event, MediaItem } from "@shared/schema";
import { Readable } from "node:stream";
import { isPreservedPhoto } from "@shared/image-provenance";
import { ThumbnailCache } from "./thumbnail-cache";
import { lowResolutionDownload } from "./low-resolution-download";
import { standardPhotoDownload } from "./standard-photo-download";

// Short-lived, bounded download-only memory cache. No persistent storage,
// quota changes or public URLs. Callers MUST recheck access before every use.
export const preparedDownloadCache = new ThumbnailCache({
  entries: 16, bytes: 32 * 1024 * 1024, entryBytes: 5_000_000, ttlMs: 120_000,
}, () => Date.now(), { active: 2, waiting: 4, waitMs: 5_000 });

export function needsPreparedDownload(item: MediaItem, event: Partial<Pick<Event, "creatorId">>, quality: "high" | "low") {
  return quality === "low" || (event.creatorId == null && item.type === "image" &&
    item.url.endsWith(".jpg") && isPreservedPhoto(item.url));
}

export function preparedDownload(item: MediaItem, event: Partial<Pick<Event, "creatorId">>,
  quality: "high" | "low", open: () => Readable) {
  // Source keys are immutable. Include ownership and content/safety versions
  // so an edit or ownership transition cannot reuse a different export.
  const key = JSON.stringify([item.id, item.url, item.contentVersion, item.safetyVersion, event.creatorId, quality]);
  return preparedDownloadCache.get(key, () => quality === "low"
    ? lowResolutionDownload(open) : standardPhotoDownload(open));
}
