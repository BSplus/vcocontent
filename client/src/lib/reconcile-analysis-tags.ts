import { withoutRetiredMediaTags } from "@shared/media-tag-policy";

export function parseEditableTags(value: string): string[] {
  return value.split(",").map(tag => tag.trim()).filter(Boolean);
}

/** Merge effective saved tags, not raw AI output; retain additions and removals in the current draft. */
export function reconcileAnalysisTags(current: string[], atStart: string[], effective: string[]): string[] {
  const removedInDraft = new Set(atStart.filter(tag => !current.includes(tag)));
  return Array.from(new Set([...current, ...withoutRetiredMediaTags(effective).filter(tag => !removedInDraft.has(tag))]));
}
