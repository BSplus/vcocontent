/**
 * Accounting follows the persisted gallery, never the uploader, author credit,
 * series or association. This contract does not activate subscription quotas.
 */
export type GalleryOwnership =
  | Readonly<{ galleryId: number; category: "OFFICIAL_VCO"; ownerId: null }>
  | Readonly<{ galleryId: number; category: "CREATOR"; ownerId: number }>;

export class GalleryOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GalleryOwnershipError";
  }
}

export function resolveGalleryOwnership(
  gallery: { id: number; creatorId: number | null } | null | undefined,
): GalleryOwnership {
  if (!gallery || !Number.isSafeInteger(gallery.id) || gallery.id <= 0)
    throw new GalleryOwnershipError("Gallery is missing or invalid");
  if (gallery.creatorId === null)
    return Object.freeze({ galleryId: gallery.id, category: "OFFICIAL_VCO", ownerId: null });
  if (!Number.isSafeInteger(gallery.creatorId) || gallery.creatorId <= 0)
    throw new GalleryOwnershipError("Gallery owner is invalid");
  return Object.freeze({ galleryId: gallery.id, category: "CREATOR", ownerId: gallery.creatorId });
}

/** Revalidate a reservation's owner snapshot against a freshly locked gallery. */
export function assertGalleryOwnership(
  gallery: Parameters<typeof resolveGalleryOwnership>[0],
  expected: GalleryOwnership,
): GalleryOwnership {
  const current = resolveGalleryOwnership(gallery);
  if (current.galleryId !== expected.galleryId || current.category !== expected.category ||
      current.ownerId !== expected.ownerId)
    throw new GalleryOwnershipError("Gallery owner changed during upload");
  return current;
}
