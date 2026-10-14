export const BRAND_TAG_PREFIX = "Brand: ";
export const BRAND_EVIDENCE_POLICY = "on-car-commercial-v1";
const brandCharacters = new RegExp("^[\\p{L}\\p{N}][\\p{L}\\p{N} .&+'’®™()/-]*$", "u");
export function canonicalBrand(value: string): string | undefined {
  const text = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (text.length < 2 || text.length > 75 ||
    !brandCharacters.test(text)) return undefined;
  return text.toUpperCase();
}
export function brandNameFromTag(tag: string): string | undefined {
  return tag.startsWith(BRAND_TAG_PREFIX) ? canonicalBrand(tag.slice(BRAND_TAG_PREFIX.length)) : undefined;
}
export function visibleBrandTags(brands: string[]): string[] {
  return Array.from(new Set(brands.map(canonicalBrand).filter((b): b is string => !!b)))
    .slice(0, 12).map(b => BRAND_TAG_PREFIX + b);
}
