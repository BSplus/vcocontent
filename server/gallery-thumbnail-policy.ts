import type { Event, MediaItem } from "@shared/schema";
import { safeState } from "./beta-policy";

export class EventImageError extends Error {}
export const galleryFilePattern = /^\/api\/media\/files\/(thumb-[0-9a-f-]{36}\.webp)$/;
export const galleryLegacyPattern = /^\/api\/media\/legacy\/([1-9][0-9]*)\/thumbnail$/;
const inlineImage = /^data:image\/(?:jpeg|png|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Selection is stricter than preserving an already-used historical photo. */
export function galleryThumbnailReference(media: MediaItem, event: Event, selecting = true): string | null {
  if (event.isPremium || media.eventId !== event.id || media.type !== "image" ||
      media.isPremium || !safeState(media) ||
      selecting && event.creatorId && media.safetyStatus !== "approved") return null;
  if (galleryFilePattern.test(media.thumbnail)) return media.thumbnail;
  if (inlineImage.test(media.thumbnail)) return `/api/media/legacy/${media.id}/thumbnail`;
  // Lists already replace inline data with its bounded delivery endpoint.
  if (media.thumbnail === `/api/media/legacy/${media.id}/thumbnail`) return media.thumbnail;
  return null;
}
