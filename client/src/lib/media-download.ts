import type { MediaItem } from "@shared/schema";
import { isCreatorOriginal, isOfficialJpegOriginal } from "@shared/image-provenance";

export type DownloadQuality = "high" | "low";

export function downloadOptionLabel(item: MediaItem, quality: DownloadQuality, measuredBytes?: number | null, status?: string): string {
  const converted = quality === "low" || (item.type === "image" && isOfficialJpegOriginal(item.url));
  const bytes = measuredBytes === undefined && !converted ? item.highBytes : measuredBytes;
  const size = typeof bytes === "number" && bytes > 0
    ? `${(bytes / 1_000_000).toFixed(2)} MB`
    : status || "size unavailable";
  const label = quality === "low" ? "Low-Res · JPEG" :
    item.type === "image" && isOfficialJpegOriginal(item.url) ? "High-Res · JPEG" :
    item.type === "video" ? "Video Download" :
    isCreatorOriginal(item.url) ? "Original Download · uploaded file" : "High-Res Download · optimized";
  return `${label} (${size})`;
}

export async function downloadMedia(item: MediaItem, quality: DownloadQuality): Promise<void> {
  if (quality === "low" && item.type !== "image") {
    throw new Error("Low-Res downloads are available for photos only.");
  }
  const authorization = await fetch(`/api/media/${item.id}/download?quality=${quality}`, {
    method: "POST",
    credentials: "include",
  });
  if (!authorization.ok) {
    if (authorization.status === 401) throw new Error("Sign in or register to download this version.");
    throw new Error(`Download unavailable (${authorization.status}).`);
  }
  const result: unknown = await authorization.json();
  if (!result || typeof result !== "object" || !("url" in result)
      || typeof result.url !== "string" || !result.url.startsWith("/api/media/")) {
    throw new Error("The server did not provide a valid download URL.");
  }
  const link = document.createElement("a");
  link.href = result.url;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}