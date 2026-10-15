import { and, eq, or, isNull } from "drizzle-orm";
import { db } from "./db";
import { referenceDocuments, eventEntries, type Event, type EntryRow, type Identification } from "@shared/schema";
import { supportedPhotoObservations } from "./utils/photo-number-evidence";
import { photoTeamHintConflict } from "./photo-team-hints";
// Video callers supply frame-bound checked observations and use the same strict
// uniqueness/conflict gates as photos; manual assignments remain protected.

export const normalizedNumber = (number: string) => number.replace(/^0+(?=\d)/, "");
export const seasonYear = (event: Event) => event.referenceSeasonYear || new Date(event.date).getUTCFullYear();
export function applicableDocuments(event: Event) {
   return or(and(eq(referenceDocuments.eventId, event.id),
     event.creatorId ? eq(referenceDocuments.ownerId,event.creatorId) : isNull(referenceDocuments.ownerId)),
    and(eq(referenceDocuments.scope, "season"),
      event.seriesId ? eq(referenceDocuments.seriesId, event.seriesId) : eq(referenceDocuments.id, -1),
      eq(referenceDocuments.seasonYear, seasonYear(event)),
      event.creatorId ? eq(referenceDocuments.ownerId, event.creatorId) : isNull(referenceDocuments.ownerId)));
}
export type MatchDocument = { scope: string; kind: string; session: string | null; rows: EntryRow[]; updatedAt: Date };
export const referencePriority = (d: MatchDocument) =>
  (d.scope === "event" ? 10 : 0) + (d.session ? 4 : 0) + (d.kind === "result" ? 2 : 0);
export const referenceRowPriority = (d: MatchDocument, row: EntryRow) =>
  referencePriority(d) + (d.scope === "season" && row.eventName ? 10 : 0) + (!d.session && row.session ? 4 : 0);
export const referenceRowApplies = (d: MatchDocument, row: EntryRow, session: string | null, eventTitle: string) =>
  (!d.session || d.session === session) && (!row.session || row.session === session) &&
  (d.scope === "event" || !row.eventName || row.eventName.toLowerCase().trim() === eventTitle.toLowerCase().trim());
/** Result/event/session overrides merge available fields, not guesses. */
export function matchReferences(visible: Identification[], documents: MatchDocument[], session: string | null, eventTitle = "", strictPhoto = false, requirePhotoEvidence = false): Identification[] {
  const applicable = documents.filter(d => !d.session || d.session === session);
  const applicableTeams = strictPhoto ? applicable.flatMap(d => d.rows
    .filter(row => referenceRowApplies(d, row, session, eventTitle)).map(row => row.team)) : [];
  const priority = referencePriority;
  applicable.sort((a, b) => priority(a) - priority(b) || +new Date(a.updatedAt) - +new Date(b.updatedAt));
  return visible.map((input): Identification => {
    if (requirePhotoEvidence && input.source === "manual") return input;
    const observed = requirePhotoEvidence ? supportedPhotoObservations([input])[0] : input;
    let entry: EntryRow | undefined, ambiguous = false;
    if (observed.number) {
      const rowPriority = referenceRowPriority;
      const levels = Array.from(new Set(applicable.flatMap(d=>d.rows.map(row=>rowPriority(d,row))))).sort((a,b)=>a-b);
      for (const level of levels) {
        const rows = applicable.flatMap(document => document.rows.filter(r =>
          rowPriority(document,r)===level && r.number && normalizedNumber(r.number) === normalizedNumber(observed.number)
          && referenceRowApplies(document,r,session,eventTitle)));
        if (!rows.length) continue;
        const consensus = (key: keyof EntryRow) => Array.from(new Map(rows.map(row=>String(row[key] || "").trim()).filter(Boolean)
          .map(value=>[value.toLowerCase().replace(/\s+/g," "),value])).values());
        const teams = consensus("team");
        ambiguous = ["team","car","drivers","manufacturer","racingClass"].some(key=>consensus(key as keyof EntryRow).length>1);
        if (entry?.team && teams.length === 1 && entry.team.toLowerCase() !== teams[0].toLowerCase()) entry = undefined;
        entry ||= {number:observed.number,team:"",car:"",drivers:"",manufacturer:"",racingClass:"",discipline:""};
        for (const key of ["team","car","drivers","manufacturer","racingClass","discipline"] as const) {
          const values = consensus(key);
          if (values.length) entry[key] = values.length === 1 ? values[0] : "";
        }
        if (["team","car","manufacturer"].some(key=>consensus(key as keyof EntryRow).length>1) &&
          rows.some(row=>!row.drivers.trim())) entry.drivers="";
        if (strictPhoto && ambiguous) entry=undefined;
      }
    }
    // Vehicle/model appearance is not authority over a number-backed entry.
    // Keep independent team conflicts, number evidence and reference ambiguity.
    if (strictPhoto && entry && [{team:observed.team},
       ...(observed.referenceConstraints || []),
       ...(observed.teamMarkingEvidence?.markings || []).map(team=>({team}))].some(hint=>
       photoTeamHintConflict(hint.team,entry!,applicableTeams,observed.teamMarkingEvidence))) {
      entry=undefined;
    }
    if (entry && (!strictPhoto || !ambiguous) && (!strictPhoto || !!entry.team)) return { ...observed, team: entry.team || observed.team, drivers: entry.drivers,
      vehicle: entry.car || observed.vehicle,
      // A model-only reference must not inherit a contradictory guessed make.
      manufacturer: entry.manufacturer || (entry.car?.trim() ? "" : observed.manufacturer),
      manufacturerEvidence:entry.car?.trim() || entry.manufacturer?.trim() ? undefined : observed.manufacturerEvidence,
      referenceVehicle:entry.car,referenceManufacturer:entry.manufacturer || "",
      racingClass: entry.racingClass || observed.racingClass, discipline: entry.discipline || observed.discipline, source: "reference" };
    // Team-only branding can match a team, never infer an individual driver.
    if (!strictPhoto && !observed.number && observed.team) {
      const names = applicable.flatMap(d => d.rows.filter(r=>(!r.session || r.session === session) &&
        (d.scope === "event" || !r.eventName || r.eventName.toLowerCase().trim() === eventTitle.toLowerCase().trim())))
        .filter(r => r.team.toLowerCase() === observed.team.toLowerCase());
      if (names.length) return { ...observed, team: names[0].team, drivers: "", source: "reference" };
    }
    return { ...observed, drivers: "", source: "visual" };
  });
}
export async function loadMatchDocuments(event: Event, executor: Pick<typeof db, "select"> = db):Promise<MatchDocument[]> {
  const documents = await executor.select().from(referenceDocuments).where(applicableDocuments(event));
  const legacy = await executor.select().from(eventEntries).where(eq(eventEntries.eventId, event.id));
  return [...documents, ...(legacy.length ? [{ scope: "event", kind: "entry", session: null, rows: legacy, updatedAt: new Date(0) }] : [])];
}

/** Scheduling hint only: provisional numbers NEVER authorize an entry match.
 * The verifier rechecks this decision after independently validating digits. */
export function visualMakeNeeded(documents:MatchDocument[], session:string|null, eventTitle:string, eventVehicle?:string|null) {
  return (vehicle:Identification):boolean => {
    if(eventVehicle?.trim()) return false;
    const [matched]=matchReferences([vehicle],documents,session,eventTitle,true,false);
    return matched.source!=="reference" || !(
      matched.referenceVehicle?.trim() || matched.referenceManufacturer?.trim());
  };
}

export async function identifyEntries(event: Event, visible: Identification[], session: string | null, executor: Pick<typeof db, "select"> = db, strictPhoto = false, requirePhotoEvidence = false) {
  return matchReferences(visible, await loadMatchDocuments(event,executor), session,event.title,strictPhoto,requirePhotoEvidence);
}
