import {photoVehicleRegionSchema,type EntryRow,type Event,type Identification} from "@shared/schema";
import {canonicalVehicleMake,VEHICLE_MAKE_POLICY} from "@shared/vehicle-makes";

export const scenes = ["Race Action", "Start", "Finish"] as const;
export type Scene = typeof scenes[number];

type CaptionEvent = Pick<Event, "title" | "date" | "round" | "track" | "platform"> &
  Partial<Pick<Event,"vehicle">>;

/** Shared context for newly generated captions; never rewrites stored text. */
function captionContext(event: CaptionEvent, seriesName: string | null = null,includeVehicle=true): string {
  const round = event.round?.trim();
  const date = event.date ? new Date(event.date) : null;
  return [seriesName?.trim() || event.title?.trim(),
    round ? (/^round\b/i.test(round) ? round : `Round ${round}`) : null,
    event.track?.trim(), event.platform?.trim(),
    includeVehicle && event.vehicle?.trim() ? `Vehicle: ${event.vehicle.trim()}` : null,
    date && Number.isFinite(+date) ? date.toLocaleDateString("en-GB",
      { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }) : null,
  ].filter(Boolean).join(" · ");
}

export function normalizeNumber(value: string): string {
  return value.replace(/^0+(?=\d)/, "");
}

export function entryConflicts(rows: EntryRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.number) continue;
    const key = normalizeNumber(row.number);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return rows.flatMap(row => row.number && (counts.get(normalizeNumber(row.number)) || 0) > 1 ? [row.number] : []);
}

export function proposeCaption(
  event: CaptionEvent,
  entries: EntryRow[],
  observedNumbers: string[],
  scene: Scene | null,
  seriesName: string | null = null,
) {
  const numbers = Array.from(new Set(observedNumbers.filter(number => /^[0-9]{1,4}$/.test(number)))).slice(0, 12);
  const matches = entries.filter(entry => numbers.some(number => normalizeNumber(number) === normalizeNumber(entry.number)));
  const safeMatch = numbers.length === 1 && matches.length === 1 ? matches[0] : null;
  const context = captionContext(event, seriesName,!safeMatch);
  const suggestion = safeMatch
    ? `${context} — ${[`#${safeMatch.number} ${safeMatch.team}`.trim(), safeMatch.car || safeMatch.manufacturer || event.vehicle, safeMatch.drivers].filter(Boolean).join(" — ")}`
    : `${context}${scene ? ` — ${scene}` : ""}`;
  // Keep the complete lineup or fall back to context, never a partial name.
  return { numbers, matches, ambiguous: numbers.length !== 1 || matches.length !== 1,
    suggestion: (suggestion.length <= 1000 ? suggestion : context).slice(0, 1000) };
}

/** Conservative automatic captions never turn tags or registered lineups into
 * evidence of who appears in a photograph. Event context is sufficient. */
export function communityCaption(event: CaptionEvent, seriesName: string | null = null) {
  return proposeCaption(event,[],[],null,seriesName).suggestion;
}

export function visuallyCheckedMakes(vehicles:Identification[]):string[] {
  return Array.from(new Set(vehicles.filter(v=>v.source==="visual" &&
    v.manufacturerEvidence===VEHICLE_MAKE_POLICY && photoVehicleRegionSchema.safeParse(v.vehicleRegion).success)
    .map(v=>canonicalVehicleMake(v.manufacturer)).filter((make):make is string=>!!make))).slice(0,6);
}
function vehicleName(row:Identification,event:CaptionEvent):string {
  // Newly matched records distinguish registered facts from inherited visual
  // hints. Legacy/manual records retain their established vehicle fields.
  return (row.referenceVehicle ?? row.vehicle)?.trim() ||
    (row.referenceManufacturer ?? row.manufacturer)?.trim() || event.vehicle?.trim() || "";
}

/** Deterministic, reference-backed caption; never claims a pictured driver's identity. */
export function matchedPhotoCaption(
  event: CaptionEvent,
  seriesName: string | null,
  identification: Identification[],
  manuallyConfirmed = false,
  observations:Identification[]=identification,
) {
  // Each number-backed reference concerns only its own vehicle. Unknown cars
  // neither inherit its identity nor suppress a safely matched neighbour.
  // Photo evidence is enforced by the upstream matcher, not inferred here.
  const captionEntries = identification.filter(row =>
    (row.source === "reference" || (manuallyConfirmed && row.source === "manual")) &&
    /^\d{1,4}$/.test(row.number) && (manuallyConfirmed || !!row.team));
  const matched = captionEntries.length > 0;
  const context = captionContext(event, seriesName,!matched);
  const vehicles = matched ? captionEntries.map(row =>
    [`#${row.number} ${row.team}`.trim(), vehicleName(row,event),
      row.drivers].filter(Boolean).join(" — ")) : [];
  // No reference match: only independently checked makes, never guessed models,
  // numbers, teams or registered drivers. Explicit one-make context wins.
  const makes=!matched&&!event.vehicle?.trim()?visuallyCheckedMakes(observations):[];
  const description=makes.join(", ");
  // Do not partially truncate a lineup into a misleading fragment.
  const full = [context, ...vehicles,description].filter(Boolean).join(" | ");
  return {caption:(full.length <= 1000 ? full : context).slice(0,1000),
    matchStatus:matched ? "matched" : "no_unique_match"};
}