export const LEGACY_EVENT_IMAGE = "/attached_assets/%2389_3.png";
export const OFFICIAL_EVENT_IMAGE_FALLBACK = "/brand/vco-logo-white.png";

export function isLegacyEventImage(value: string | null | undefined): boolean {
  if (!value) return false;

  try {
    const pathname = new URL(value, "https://vco.local").pathname;
    return decodeURIComponent(pathname) === "/attached_assets/#89_3.png";
  } catch {
    return value === LEGACY_EVENT_IMAGE;
  }
}
