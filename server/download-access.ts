/** Public low-res downloads are limited to non-premium VCO images. */
export function downloadAccess(
  media: { type: string; isPremium: boolean; archivedAt?: unknown },
  event: { creatorId: number | null; isPremium: boolean },
  quality: "high" | "low",
  authenticated: boolean,
): 200 | 400 | 401 | 403 {
  if (media.archivedAt || media.isPremium || event.isPremium) return 403;
  if (quality === "low" && media.type !== "image") return 400;
  if (!authenticated && !(quality === "low" && media.type === "image" && event.creatorId === null)) return 401;
  return 200;
}