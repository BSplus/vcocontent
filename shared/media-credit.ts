import { z } from "zod";

// Keep the existing photographer storage/search field for both media types.
export const mediaCreditSchema = z.string().trim().max(150, "Credit cannot exceed 150 characters");

export function creditLabel(type?: string): string {
  return type === "video" ? "Videographer" : type === "image" ? "Photographer" : "Photographer / Videographer";
}

export function uploadCreditLabel(types: string[]): string {
  const unique = new Set(types);
  return creditLabel(unique.size === 1 ? types[0] : undefined);
}

export function creditByline(item: { type?: string; photographer?: string | null }): string | undefined {
  return item.photographer?.trim()
    ? `${item.type === "video" ? "Video" : "Photo"} by ${item.photographer.trim()}`
    : undefined;
}

export function creditText(item: { type?: string; photographer?: string | null }): string {
  return item.photographer?.trim() ? `${creditLabel(item.type)}: ${item.photographer.trim()}` : "";
}
