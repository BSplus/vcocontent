import type { MediaItem } from "@shared/schema";

export function topShotDownloadName(item: Pick<MediaItem, "id" | "type">, quality: "high" | "low", url: string, contentType: string): string {
  const pathExtension = url.split(/[?#]/)[0].match(/\.(jpe?g|png|webp|gif|mp4|mov|webm)$/i)?.[1]?.toLowerCase();
  const mimeExtension: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  };
  const extension = quality === "low"
    ? (mimeExtension[contentType.split(";")[0]] || "jpg")
    : (pathExtension || mimeExtension[contentType.split(";")[0]] || (item.type === "video" ? "mp4" : "jpg"));
  const label = item.type === "video" && quality === "low" ? "poster" : quality;
  return `media-${item.id}-${label}.${extension}`;
}