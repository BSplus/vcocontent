import { z } from "zod";
import type { Identification } from "@shared/schema";
import { canonicalBrand } from "@shared/brand-tags";

export const VIDEO_BRANDING_POLICY = "video-commercial-brand-v1";
// Leave room for the numeric contract within its existing 4096-token ceiling.
export const VIDEO_BRANDING_LIMITS = { vehicles: 3, markings: 3 };
const normalized = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const markings = z.array(z.object({
  text: z.string().trim().min(1).max(160),
  kind: z.enum(["commercial", "team", "team_and_commercial", "unknown"]),
})).min(1).max(VIDEO_BRANDING_LIMITS.markings);
const assessment = {
  complete: z.boolean(),
  markings,
};
const branding = z.object({
  fullImageReadings: z.array(z.object({
    readingIndex: z.number().int().min(0).max(11), ...assessment,
  })).max(VIDEO_BRANDING_LIMITS.vehicles),
  vehicleReadings: z.array(z.object({
    vehicleIndex: z.number().int().min(0).max(11), ...assessment,
  })).max(VIDEO_BRANDING_LIMITS.vehicles),
});

/** Optional photo/video addition to the existing independent crop audit. */
export function videoBrandingPrompt(indices: number[]) {
  return `
Additionally inspect readable BODYWORK branding only for labelled vehicle crops ${indices.join(", ")}.
Do not identify any team, driver, manufacturer or car model from this lettering. No entry-list names or first-pass guesses are supplied.
Add branding:{fullImageReadings:[{readingIndex:number,complete:boolean,markings:[{text:string,kind:"commercial"|"team"|"team_and_commercial"|"unknown"}]}],vehicleReadings:[{vehicleIndex:number,complete:boolean,markings:[{text:string,kind:"commercial"|"team"|"team_and_commercial"|"unknown"}]}]}.
readingIndex is the zero-based index of the SAME car in your numeric fullImageReadings array, not a guessed vehicle number.
Inspect full-frame car lettering and each labelled source crop independently. Copy complete literal text only. Never copy classification from one view to the other.
Commercial means clearly identifiable commercial product/brand lettering, not proof of a sponsorship contract. An explicit team identifier is team. Use team_and_commercial ONLY when the same complete literal marking independently identifies BOTH a commercial brand and a team; this retains its team-identity meaning. A standalone readable commercial logo can be commercial even if that brand also names a racing team. Never derive a brand by removing words from a team name or from reference lists, captions or background knowledge about a team. Unfamiliar emblems, ambiguous abbreviations, partial/blurred lettering or uncertain purpose are unknown.
Branding does not require a readable race number. A car with an unknown number still has its own fullImageReadings record with number:"" and a whole-car rectangle; assess only that car's lettering.
Use complete:false when the visible branding cannot be assessed unambiguously. Do not guess a commercial classification merely because text resembles a known sponsor.
Ignore broadcast banners, trackside signs, other cars and background branding. Never use them to assess the cropped car.
Include any readable explicit team identifiers or uncertain identity-like lettering on that car, not just commercial logos. At most ${VIDEO_BRANDING_LIMITS.markings} markings per assessment and ${VIDEO_BRANDING_LIMITS.vehicles} requested cars; if more markings are needed use complete:false.
Missing or uncertain branding leaves the existing conflict unresolved.`;
}

/** Commercial tags may coexist with a team marking, but never certify a team. */
export function confirmedVisibleBrands(raw: unknown, readingIndex: number, vehicleIndex: number): string[] {
  const parsed = branding.safeParse(raw);
  if (!parsed.success) return [];
  const full = parsed.data.fullImageReadings.filter(r => r.readingIndex === readingIndex);
  const crop = parsed.data.vehicleReadings.filter(r => r.vehicleIndex === vehicleIndex);
  if (full.length !== 1 || crop.length !== 1 || !full[0].complete || !crop[0].complete) return [];
  const commercial = (rows: typeof full[0]["markings"]) =>
    rows.filter(m => m.kind === "commercial" || m.kind === "team_and_commercial")
      .map(m => canonicalBrand(m.text)).filter((b): b is string => !!b);
  const fullText = commercial(full[0].markings), cropText = new Set(commercial(crop[0].markings));
  return Array.from(new Set(fullText.filter(b => cropText.has(b))));
}

/** Number/geometry acceptance happens first. This cannot certify a number. */
export function confirmedCommercialHints(raw: unknown, v: Identification,
  readingIndex: number, vehicleIndex: number): string[] {
  const parsed = branding.safeParse(raw);
  if (!parsed.success) return [];
  const full = parsed.data.fullImageReadings.filter(r => r.readingIndex === readingIndex);
  const crop = parsed.data.vehicleReadings.filter(r => r.vehicleIndex === vehicleIndex);
  if (full.length !== 1 || crop.length !== 1 || !full[0].complete || !crop[0].complete) return [];
  // An explicit competing team or unknown identity-like marking is never
  // excused by a commercial logo elsewhere on the same car.
  if ([...full[0].markings, ...crop[0].markings].some(m => m.kind !== "commercial")) return [];
  const fullText = new Set(full[0].markings.map(m => normalized(m.text)));
  const cropText = new Set(crop[0].markings.map(m => normalized(m.text)));
  return Array.from(new Set([v.team, ...(v.referenceConstraints || []).map(c => c.team)]
    .filter(hint => normalized(hint) && fullText.has(normalized(hint)) && cropText.has(normalized(hint)))));
}

/** Clear only exact independently assessed commercial hints, never other fields. */
export function withoutCommercialTeamHints(v: Identification, confirmed: string[]): Identification {
  if (!confirmed.length) return v;
  const approved = new Set(confirmed.map(normalized));
  return {
    ...v,
    team: approved.has(normalized(v.team)) ? "" : v.team,
    ...(v.referenceConstraints ? { referenceConstraints: v.referenceConstraints.map(c => ({
      ...c, team: approved.has(normalized(c.team)) ? "" : c.team,
    })) } : {}),
  };
}
