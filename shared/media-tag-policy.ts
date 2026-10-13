import { z } from "zod";

// Match the tag only, never substrings in descriptions or identity fields.
export const retiredTagMessage = 'The tag "Real Motorsport" is no longer supported. Remove it; use "Sim Racing" or "Esports" when appropriate.';
export const isRetiredMediaTag = (tag: string) =>
  tag.trim().replace(/\s+/g, " ").toLowerCase() === "real motorsport";
export const withoutRetiredMediaTags = (tags: string[]) => tags.filter(tag => !isRetiredMediaTag(tag));
export const mediaTagSchema = z.string().refine(tag => !isRetiredMediaTag(tag), retiredTagMessage);
export class RetiredMediaTagError extends Error {
  constructor() { super(retiredTagMessage); }
}
export function assertMediaTagsAllowed(item: { tags?: string[] | null; manualTags?: string[] | null; suppressedAITags?: string[] | null }) {
  if ([...(item.tags || []), ...(item.manualTags || []), ...(item.suppressedAITags || [])].some(isRetiredMediaTag))
    throw new RetiredMediaTagError();
}
