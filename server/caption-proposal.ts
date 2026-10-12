import type { EntryRow, Event, Identification } from "@shared/schema";

export const scenes = ["Race Action", "Start", "Finish"] as const;
export type Scene = typeof scenes[number];

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
  event: Pick<Event, "title" | "date" | "round" | "track">,
  entries: EntryRow[],
  observedNumbers: string[],
  scene: Scene | null,
) {
  const numbers = Array.from(new Set(observedNumbers.filter(number => /^[0-9]{1,4}$/.test(number)))).slice(0, 12);
  const matches = entries.filter(entry => numbers.some(number => normalizeNumber(number) === normalizeNumber(entry.number)));
  const safeMatch = numbers.length === 1 && matches.length === 1 ? matches[0] : null;
  const date = new Date(event.date).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
  const context = [event.title, event.round, event.track, date].filter(Boolean).join(" · ");
  const suggestion = safeMatch
    ? `${context} — #${safeMatch.number} ${safeMatch.team}, ${safeMatch.car}, ${safeMatch.drivers}`
    : `${context}${scene ? ` — ${scene}` : ""}`;
  return { numbers, matches, ambiguous: numbers.length !== 1 || matches.length !== 1, suggestion: suggestion.slice(0, 1000) };
}

/** Conservative automatic captions never turn tags or registered lineups into
 * evidence of who appears in a photograph. Event context is sufficient. */
export function communityCaption(event: Pick<Event,"title"|"date"|"round"|"track">) {
  return proposeCaption(event,[],[],null).suggestion;
}

/** Deterministic, reference-backed caption; never claims a pictured driver's identity. */
export function matchedPhotoCaption(
  event: Pick<Event,"title"|"date"|"round"|"track"|"platform">,
  seriesName: string | null,
  identification: Identification[],
  manuallyConfirmed = false,
) {
  const date = new Date(event.date);
  const context = [event.platform, seriesName, event.title,
    event.round ? (/^round\b/i.test(event.round) ? event.round : `Round ${event.round}`) : null,
    event.track, Number.isFinite(+date) ? date.toLocaleDateString("en-GB",
      {timeZone:"UTC",day:"numeric",month:"long",year:"numeric"}) : null].filter(Boolean).join(" · ");
  // An explicit assignment can coexist with other visual-only vehicles. Include
  // only confirmed entries, without asserting identities for those other rows.
  const captionEntries = manuallyConfirmed ? identification.filter(row =>
    ["manual","reference"].includes(row.source) && /^\d{1,4}$/.test(row.number)) : identification;
  const matched = captionEntries.length > 0 && captionEntries.every(row =>
    (row.source === "reference" || (manuallyConfirmed && row.source === "manual")) && /^\d{1,4}$/.test(row.number) &&
    (manuallyConfirmed || !!row.team));
  const vehicles = matched ? captionEntries.map(row =>
    [`#${row.number} ${row.team}`, row.vehicle,
      row.drivers ? `Registered lineup: ${row.drivers}` : null].filter(Boolean).join(" — ")) : [];
  // Do not partially truncate a lineup into a misleading fragment.
  const full = [context, ...vehicles].join(" | ");
  return {caption:(full.length <= 1000 ? full : context).slice(0,1000),
    matchStatus:matched ? "matched" : "no_unique_match"};
}