import type { Event, MediaItem } from "@shared/schema";
import { SOCIAL_IMAGE } from "@shared/site-metadata";
import { creditByline } from "@shared/media-credit";
import { storage } from "./storage";
import { eventPublic, mediaPublic } from "./beta-access";
import { safeState } from "./beta-policy";
import { eventThumbnailReference } from "./event-thumbnails";
import { galleryFilePattern, galleryLegacyPattern, galleryThumbnailReference } from "./gallery-thumbnail-policy";
import { publicThumbnail } from "./seo-markup";
import { searchData } from "./public-search-data";

export type SharingImage = { image: string; mime?: string; credit?: string; alt?: string };
type SharingMedia = Pick<MediaItem, "id" | "eventId" | "type" | "thumbnail" | "caption" | "photographer" |
  "isPremium" | "archivedAt" | "safetyStatus" | "safetyPolicy" | "contentVersion" | "safetyVersion">;
export const brandSharingImage: SharingImage = { image: SOCIAL_IMAGE, mime: "image/jpeg" };

export async function mediaSharingImage(item: SharingMedia, event: Event): Promise<SharingImage | undefined> {
  if (item.eventId !== event.id || item.isPremium || event.isPremium || !safeState(item) ||
    !await mediaPublic(item as MediaItem, event)) return;
  const image = publicThumbnail(item);
  if (!image) return;
  // Both prepared and normalized historical thumbnails are delivered as WebP.
  return { image: `/api/sharing/media/${item.id}/image`, mime: "image/webp",
    credit: creditByline(item), alt: item.caption || undefined };
}

/** Public selection only: no user/session input, and no dependence on the visible gallery page. */
export async function eventSharingImage(event: Event, previews?: SharingMedia[]): Promise<SharingImage> {
  if (event.isPremium || !await eventPublic(event)) return brandSharingImage;
  for (const field of ["customThumbnail", "coverImage"] as const) {
    const image = eventThumbnailReference(event, field);
    if (!image) continue;
    const value = event[field]!;
    const file = galleryFilePattern.exec(value), legacy = galleryLegacyPattern.exec(value);
    let credit: string | undefined;
    if (file || legacy) {
      const media = file ? await storage.findMediaByKey(file[1], false) : await storage.getMediaItem(Number(legacy![1]), false);
      if (!media || galleryThumbnailReference(media, event, false) !== value || !await mediaSharingImage(media, event)) continue;
      credit = creditByline(media);
    }
    const staticImage = image.startsWith("/attached_assets/");
    return { image: staticImage ? image : `${image}&public=1`, credit,
      mime: staticImage ? (/\.png$/i.test(image) ? "image/png" : /\.jpe?g$/i.test(image) ? "image/jpeg" :
        /\.webp$/i.test(image) ? "image/webp" : /\.gif$/i.test(image) ? "image/gif" : undefined) : "image/webp" };
  }
  for (const item of previews ?? await searchData.images(event.id, 1, 48)) {
    const image = await mediaSharingImage(item, event);
    if (image) return image;
  }
  return brandSharingImage;
}
