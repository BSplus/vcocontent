/**
 * Existing byte-identical Creator sources use application UUIDv8 keys.
 * Historical storage keys were generated exclusively with randomUUID (v4).
 * The version marker is server-generated only after target-context validation;
 * it is not an access-control decision and never promotes historical files.
 */
export function isCreatorOriginal(url: string): boolean {
  return /^\/api\/media\/files\/media-[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/.test(url);
}

/** New official byte-identical JPEG intake uses UUIDv7; old v4 sources stay legacy. */
export function isOfficialJpegOriginal(url: string): boolean {
  return /^\/api\/media\/files\/media-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/.test(url);
}

/** Provenance only; gallery ownership remains the authorization authority. */
export function isPreservedPhoto(url: string): boolean {
  return isCreatorOriginal(url) || isOfficialJpegOriginal(url);
}
