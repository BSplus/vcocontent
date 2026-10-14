import { z } from "zod";

export const vehicleLimit = 12;
export const normalizedRaceNumber = (value: string) => value.replace(/^0+(?=\d)/, "");
export const assignmentReplaceIndexSchema = z.coerce.number().int().min(0).max(vehicleLimit - 1);
export const manualNumberAssignmentSchema = z.object({
  snapshot: z.string().regex(/^[a-f0-9]{64}$/),
  selectionId: z.string().min(1).max(100).optional(),
  selectionIds: z.array(z.string().min(1).max(100)).min(1).max(vehicleLimit).optional(),
  replaceIndex: assignmentReplaceIndexSchema.optional(),
  replaceCaption: z.boolean().default(false),
}).strict().superRefine((body, ctx) => {
  if ((body.selectionId === undefined) === (body.selectionIds === undefined))
    ctx.addIssue({ code: "custom", message: "Provide one selection or a list of selections." });
  if (body.replaceIndex !== undefined && new Set(body.selectionIds || [body.selectionId]).size !== 1)
    ctx.addIssue({ code: "custom", message: "Replacement requires exactly one vehicle." });
});
