import { z } from "zod";

export const photoMatchingChangesSchema = z.object({
  enabled: z.boolean().optional(),
  platform: z.string().trim().max(120).nullable().optional(),
}).strict().refine(value => value.enabled !== undefined || value.platform !== undefined,
  "Provide a setting to change.");

export const photoMatchingSettingsSchema = z.object({
  id: z.number().int().positive(),
  enabled: z.boolean(),
  platform: z.string().max(120).nullable(),
  contentVersion: z.number().int().nonnegative(),
  referenceRevision: z.number().int().nonnegative(),
  photoMatchingRevision: z.number().int().nonnegative(),
});
export const photoMatchingSaveSchema = photoMatchingSettingsSchema.extend({
  saveStatus: z.enum(["saved", "unchanged"]),
  safetyCheckStatus: z.literal("unavailable").optional(),
});
export type PhotoMatchingSettings = z.infer<typeof photoMatchingSettingsSchema>;
export type PhotoMatchingChanges = z.infer<typeof photoMatchingChangesSchema>;

export function settingsAtLeastAsNew(next: PhotoMatchingSettings, current: PhotoMatchingSettings) {
  return next.id === current.id && next.contentVersion >= current.contentVersion &&
    next.referenceRevision >= current.referenceRevision &&
    next.photoMatchingRevision >= current.photoMatchingRevision;
}
