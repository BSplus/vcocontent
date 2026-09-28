import type { MediaItem } from "@shared/schema";
import { topShotDownloadName } from "./top-shot-download";

export type DownloadQuality = "high" | "low";

export function downloadOptionLabel(item: MediaItem, quality: DownloadQuality): string {
  const bytes = quality === "high" ? item.highBytes : item.lowBytes;
  const size = typeof bytes === "number" && bytes > 0
    ? `${(bytes / 1_000_000).toFixed(2)} MB`
    : "size unavailable";
  return `${quality === "high" ? "High-Res" : "Low-Res"} (${size})`;
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
  const response = await fetch(result.url, { credentials: "include" });
  if (!response.ok) throw new Error(`Media download failed (${response.status}).`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = topShotDownloadName(item, quality, result.url, blob.type);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}