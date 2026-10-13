import type { EntryRow, Event, Identification } from "@shared/schema";

export const scenes = ["Race Action", "Start", "Finish"] as const;
export type Scene = typeof scenes[number];

type CaptionEvent = Pick<Event, "title" | "date" | "round" | "track" | "platform">;

/** Shared context for newly generated captions; never rewrites stored text. */
function captionContext(event: CaptionEvent, seriesName: string | null = null): string {
  const round = event.round?.trim();
  const date = event.date ? new Date(event.date) : null;
  return [seriesName?.trim() || event.title?.trim(),
    round ? (/^round\b/i.test(round) ? round : `Round ${round}`) : null,
    event.track?.trim(), event.platform?.trim(),
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
  const context = captionContext(event, seriesName);
  const suggestion = safeMatch
    ? `${context} — ${[`#${safeMatch.number} ${safeMatch.team}`.trim(), safeMatch.car, safeMatch.drivers].filter(Boolean).join(" — ")}`
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

/** Deterministic, reference-backed caption; never claims a pictured driver's identity. */
export function matchedPhotoCaption(
  event: CaptionEvent,
  seriesName: string | null,
  identification: Identification[],
  manuallyConfirmed = false,
) {
  const context = captionContext(event, seriesName);
  // An explicit assignment can coexist with other visual-only vehicles. Include
  // only confirmed entries, without asserting identities for those other rows.
  const captionEntries = manuallyConfirmed ? identification.filter(row =>
    ["manual","reference"].includes(row.source) && /^\d{1,4}$/.test(row.number)) : identification;
  const matched = captionEntries.length > 0 && captionEntries.every(row =>
    (row.source === "reference" || (manuallyConfirmed && row.source === "manual")) && /^\d{1,4}$/.test(row.number) &&
    (manuallyConfirmed || !!row.team));
  const vehicles = matched ? captionEntries.map(row =>
    [`#${row.number} ${row.team}`.trim(), row.vehicle,
      row.drivers].filter(Boolean).join(" — ")) : [];
  // Do not partially truncate a lineup into a misleading fragment.
  const full = [context, ...vehicles].join(" | ");
  return {caption:(full.length <= 1000 ? full : context).slice(0,1000),
    matchStatus:matched ? "matched" : "no_unique_match"};
}