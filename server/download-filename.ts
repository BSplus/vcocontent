import type { Event, MediaItem } from "@shared/schema";

const extensions: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};

/** ASCII-only header-safe names, derived from event metadata and delivered MIME. */
export function downloadFilename(
  item: Pick<MediaItem, "id">,
  event: Pick<Event, "id" | "title" | "date">,
  quality: "high" | "low",
  contentType: string,
): string {
  const extension = extensions[contentType.split(";")[0].trim().toLowerCase()];
  if (!extension) throw new Error("Unsupported download format");
  // Persisted dates are UTC instants; never use the server's local calendar.
  const date = event.date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid event date");
  const slug = event.title.normalize("NFC").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 80).replace(/-+$/g, "") || `event-${event.id}`;
  return `vco_${date}_${slug}_m${item.id}_${quality}.${extension}`;
}
