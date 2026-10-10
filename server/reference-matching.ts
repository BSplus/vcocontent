import { and, eq, or, isNull } from "drizzle-orm";
import { db } from "./db";
import { referenceDocuments, eventEntries, type Event, type EntryRow, type Identification } from "@shared/schema";

export const normalizedNumber = (number: string) => number.replace(/^0+(?=\d)/, "");
export const seasonYear = (event: Event) => event.referenceSeasonYear || new Date(event.date).getUTCFullYear();
export function applicableDocuments(event: Event) {
  return or(eq(referenceDocuments.eventId, event.id),
    and(eq(referenceDocuments.scope, "season"),
      event.seriesId ? eq(referenceDocuments.seriesId, event.seriesId) : eq(referenceDocuments.id, -1),
      eq(referenceDocuments.seasonYear, seasonYear(event)),
      event.creatorId ? eq(referenceDocuments.ownerId, event.creatorId) : isNull(referenceDocuments.ownerId)));
}
export type MatchDocument = { scope: string; kind: string; session: string | null; rows: EntryRow[]; updatedAt: Date };
/** Result/event/session overrides merge available fields, not guesses. */
export function matchReferences(visible: Identification[], documents: MatchDocument[], session: string | null, eventTitle = ""): Identification[] {
  const applicable = documents.filter(d => !d.session || d.session === session);
  const priority = (d: MatchDocument) => (d.scope === "event" ? 10 : 0) + (d.session ? 4 : 0) + (d.kind === "result" ? 2 : 0);
  applicable.sort((a, b) => priority(a) - priority(b) || +new Date(a.updatedAt) - +new Date(b.updatedAt));
  return visible.map((observed): Identification => {
    let entry: EntryRow | undefined, ambiguous = false;
    if (observed.number) {
      const rowPriority = (document:MatchDocument,row:EntryRow) => priority(document)+
        (document.scope==="season" && row.eventName ? 10 : 0)+(!document.session && row.session ? 4 : 0);
      const levels = Array.from(new Set(applicable.flatMap(d=>d.rows.map(row=>rowPriority(d,row))))).sort((a,b)=>a-b);
      for (const level of levels) {
        const rows = applicable.flatMap(document => document.rows.filter(r =>
          rowPriority(document,r)===level && r.number && normalizedNumber(r.number) === normalizedNumber(observed.number)
          && (!r.session || r.session === session) && (document.scope === "event" || !r.eventName ||
            r.eventName.toLowerCase().trim() === eventTitle.toLowerCase().trim())));
        if (!rows.length) continue;
        const consensus = (key: keyof EntryRow) => Array.from(new Map(rows.map(row=>String(row[key] || "").trim()).filter(Boolean)
          .map(value=>[value.toLowerCase().replace(/\s+/g," "),value])).values());
        const teams = consensus("team");
        if (entry?.team && teams.length === 1 && entry.team.toLowerCase() !== teams[0].toLowerCase()) entry = undefined;
        entry ||= {number:observed.number,team:"",car:"",drivers:"",manufacturer:"",racingClass:"",discipline:""};
        for (const key of ["team","car","drivers","manufacturer","racingClass","discipline"] as const) {
          const values = consensus(key);
          if (values.length) entry[key] = values.length === 1 ? values[0] : "";
        }
        if (["team","car","manufacturer"].some(key=>consensus(key as keyof EntryRow).length>1) &&
          rows.some(row=>!row.drivers.trim())) entry.drivers="";
      }
    }
    if (entry && !ambiguous) return { ...observed, team: entry.team || observed.team, drivers: entry.drivers,
      vehicle: entry.car || observed.vehicle, manufacturer: entry.manufacturer || observed.manufacturer,
      racingClass: entry.racingClass || observed.racingClass, discipline: entry.discipline || observed.discipline, source: "reference" };
    // Team-only branding can match a team, never infer an individual driver.
    if (!observed.number && observed.team) {
      const names = applicable.flatMap(d => d.rows.filter(r=>(!r.session || r.session === session) &&
        (d.scope === "event" || !r.eventName || r.eventName.toLowerCase().trim() === eventTitle.toLowerCase().trim())))
        .filter(r => r.team.toLowerCase() === observed.team.toLowerCase());
      if (names.length) return { ...observed, team: names[0].team, drivers: "", source: "reference" };
    }
    return { ...observed, drivers: "", source: "visual" };
  });
}
export async function identifyEntries(event: Event, visible: Identification[], session: string | null, executor: Pick<typeof db, "select"> = db) {
  const documents = await executor.select().from(referenceDocuments).where(applicableDocuments(event));
  const legacy = await executor.select().from(eventEntries).where(eq(eventEntries.eventId, event.id));
  return matchReferences(visible, [...documents, ...(legacy.length ? [{ scope: "event", kind: "entry", session: null, rows: legacy, updatedAt: new Date(0) }] : [])], session,event.title);
}
