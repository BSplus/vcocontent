import { createHash } from "crypto";
import type { EntryRow, Identification } from "@shared/schema";
import { normalizedNumber, referenceRowApplies, referenceRowPriority, type MatchDocument } from "./reference-matching";
import { vehicleLimit } from "@shared/manual-number-assignment";

export const assignmentHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fields = ["team", "car", "drivers", "manufacturer", "racingClass", "discipline"] as const;
const canonical = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
export type NumberDocument = MatchDocument & { title: string };
export type NumberOption = { id: string; number: string; identification: Identification; contexts: string[]; conflict: boolean };

/** Uses matching priority, but an explicit conflicting selection uses a complete
 * real row, never a synthetic combination of two contradictory identities. */
export function manualNumberOptions(documents: NumberDocument[], session: string | null, title: string): NumberOption[] {
  const rows = documents.flatMap(doc => doc.rows.filter(row =>
    /^\d{1,4}$/.test(row.number) && referenceRowApplies(doc, row, session, title))
    .map(row => ({ row, priority: referenceRowPriority(doc, row),
      context: `${doc.title} · ${doc.scope === "season" ? "Season-wide" : "Event"} ${doc.kind} list${doc.session || row.session ? ` · ${doc.session || row.session}` : ""}` })));
  const numbers = Array.from(new Set(rows.map(({row}) => normalizedNumber(row.number))))
    .sort((a,b) => Number(a)-Number(b) || a.localeCompare(b));
  return numbers.flatMap(number => {
    const matching = rows.filter(({row}) => normalizedNumber(row.number) === number);
    const levels = Array.from(new Set(matching.map(row => row.priority))).sort((a,b) => a-b);
    let merged: EntryRow = {number, team:"", car:"", drivers:""};
    let conflict = false;
    let contexts: string[] = [];
    for (const level of levels) {
      const atLevel = matching.filter(row => row.priority === level);
      const consensus = (field: typeof fields[number]) => Array.from(new Map(atLevel
        .map(({row}) => (row[field] || "").trim()).filter(Boolean).map(value => [canonical(value),value])).values());
      const teams = consensus("team");
      if (merged.team && teams.length === 1 && canonical(merged.team) !== canonical(teams[0])) {
        merged = {number,team:"",car:"",drivers:""}; contexts = [];
      }
      conflict = fields.some(field => consensus(field).length > 1);
      for (const field of fields) {
        const values = consensus(field);
        if (values.length) merged[field] = values.length === 1 ? values[0] : "";
      }
      // Keep spelling/leading zeros from the highest-priority saved row.
      merged.number = atLevel[0].row.number;
      contexts.push(...atLevel.map(row => row.context));
    }
    const candidates = conflict
      ? matching.filter(row => row.priority === levels[levels.length-1]).map(({row,context}) => ({row,contexts:[context]}))
      : [{row:merged,contexts}];
    const unique = new Map<string, NumberOption>();
    for (const {row,contexts: sourceContexts} of candidates) {
      const identification: Identification = {number:row.number,team:row.team || "",vehicle:row.car || "",
        drivers:row.drivers || "",manufacturer:row.manufacturer || "",racingClass:row.racingClass || "",
        discipline:row.discipline || "",source:"manual"};
      const identity = assignmentHash(fields.map(field => canonical(row[field] || "")));
      const id = `${number}:${identity}`;
      const previous = unique.get(id);
      if (previous) previous.contexts = Array.from(new Set([...previous.contexts,...sourceContexts]));
      else unique.set(id,{id,number:row.number,identification,contexts:Array.from(new Set(sourceContexts)),conflict});
    }
    return Array.from(unique.values());
  });
}

export function assignedIdentifications(current: Identification[], selection: Identification | Identification[], replaceIndex?: number) {
  const selected = Array.isArray(selection) ? selection : [selection];
  if (!selected.length) throw new Error("Choose at least one vehicle.");
  const numbers = selected.map(row => normalizedNumber(row.number));
  if (new Set(numbers).size !== numbers.length)
    throw new Error("Choose only one reference for each race number.");
  if (replaceIndex !== undefined) {
    if (selected.length !== 1) throw new Error("Replacement requires exactly one vehicle.");
    if (replaceIndex < 0 || replaceIndex >= current.length) throw new Error("The vehicle to correct no longer exists.");
  }
  if (current.some((row,index) => index !== replaceIndex && row.number && numbers.includes(normalizedNumber(row.number))))
    throw new Error("This race number is already assigned. Choose that vehicle to replace it.");
  const result = replaceIndex === undefined ? [...current,...selected] :
    current.map((row,index) => index === replaceIndex ? selected[0] : row);
  if (result.length > vehicleLimit) throw new Error("At most 12 vehicles can be assigned. Remove a selection or choose a vehicle to replace.");
  return result;
}
