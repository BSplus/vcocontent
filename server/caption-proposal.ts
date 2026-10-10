import type { EntryRow, Event } from "@shared/schema";

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
  const date = new Date(event.date).toLocaleDateString("de-DE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
  const context = [event.title, event.round, event.track, date].filter(Boolean).join(" · ");
  const suggestion = safeMatch
    ? `${context} — #${safeMatch.number} ${safeMatch.team}, ${safeMatch.car}, ${safeMatch.drivers}`
    : `${context}${scene ? ` — ${scene}` : ""}`;
  return { numbers, matches, ambiguous: numbers.length !== 1 || matches.length !== 1, suggestion: suggestion.slice(0, 1000) };
}