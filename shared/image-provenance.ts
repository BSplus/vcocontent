/**
 * New byte-identical creator downloads use an application-specific UUIDv8.
 * Historical storage keys were generated exclusively with randomUUID (v4).
 * The version marker is server-generated only after target-context validation;
 * it is not an access-control decision and never promotes historical files.
 */
export function isCreatorOriginal(url: string): boolean {
  return /^\/api\/media\/files\/media-[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/.test(url);
}
