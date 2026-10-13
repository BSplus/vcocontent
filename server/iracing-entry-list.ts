import type { EditableEntryRow, EntryListParseResult } from "./entry-list";

export const IRACING_COLUMNS = [
  "Fin Pos", "Car ID", "Car", "Car Class ID", "Car Class", "Team ID", "Cust ID", "Name",
  "Start Pos", "Car #", "Out ID", "Out", "Interval", "Laps Led", "Qualify Time",
  "Average Lap Time", "Fastest Lap Time", "Fast Lap#", "Laps Comp", "Inc", "Pts",
  "Club Pts", "Div", "Club ID", "Club", "Old iRating", "New iRating", "Old License Level",
  "Old License Sub-Level", "New License Level", "New License Sub-Level", "Series Name",
  "Max Fuel Fill%", "Weight Penalty (KG)", "Agg Pts", "AI",
] as const;
const METADATA_COLUMNS = ["Start Time", "Track", "Series", "Season Year", "Season Quarter",
  "Rookie Season", "Race Week", "Strength of Field", "Special Event Type"];

export class EntryListFileError extends Error {}
type RecordRow = { values: string[]; line: number };
const same = (actual: string[], expected: readonly string[]) =>
  actual.length === expected.length && actual.every((value, i) => value === expected[i]);

/** Recognize only this known export, never infer teams from position or car number. */
export function parseIRacingEntries(records: RecordRow[]): EntryListParseResult | null {
  const signature = (values: string[]) => ["Team ID", "Cust ID", "Car #", "Fin Pos"]
    .filter(name => values.includes(name)).length >= 3;
  const headerIndex = records.findIndex(record => signature(record.values));
  const metadata = records[0]?.values.includes("Start Time") && records[0]?.values.includes("Strength of Field");
  if (headerIndex < 0 && !metadata) return null;
  if (headerIndex < 0 || !same(records[headerIndex].values, IRACING_COLUMNS))
    throw new EntryListFileError("Unsupported iRacing result columns. Use the original 36-column team export.");
  if (headerIndex !== 0 && (headerIndex !== 2 || !same(records[0].values, METADATA_COLUMNS) ||
      records[1].values.length !== METADATA_COLUMNS.length ||
      !/^\d{4}-\d\d-\d\dT/.test(records[1].values[0]) ||
      !Number.isFinite(Date.parse(records[1].values[0]))))
    throw new EntryListFileError("Invalid iRacing metadata preamble. Use the original result export.");

  const data = records.slice(headerIndex + 1);
  if (data.length > 2000) throw new EntryListFileError("iRacing exports must contain at most 2000 team and driver rows.");
  const groups = new Map<string, RecordRow[]>();
  for (const record of data) {
    if (record.values.length !== IRACING_COLUMNS.length)
      throw new EntryListFileError(`Line ${record.line}: expected all 36 iRacing columns.`);
    const id = record.values[5];
    // Invalid IDs remain visible as separate correction rows, never attached by proximity.
    const key = /^-[1-9]\d*$/.test(id) ? id : `invalid:${record.line}`;
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  if (groups.size > 500) throw new EntryListFileError("Entry lists must contain at most 500 vehicles.");
  const rows: EditableEntryRow[] = [];
  const issues: string[] = [];
  for (const [id, group] of Array.from(groups)) {
    const teams = group.filter(record => record.values[6] === id);
    const source = teams.length === 1 ? teams[0] : group[0];
    const row: EditableEntryRow = { number: source.values[9], team: teams.length === 1 ? source.values[7] : "",
      car: source.values[2], racingClass: source.values[4], drivers: "", issues: [] };
    if (id.startsWith("invalid:")) row.issues.push("Invalid or missing Team ID; no drivers assigned.");
    else if (!teams.length) row.issues.push(`Missing team row for Team ID ${id}; review the team name.`);
    else if (teams.length > 1) row.issues.push(`Multiple team rows for Team ID ${id}; no drivers assigned.`);
    const drivers = new Map<string, string>();
    const disputed = new Set<string>();
    for (const record of group) {
      const values = record.values, custId = values[6];
      if (custId === id) continue;
      if (!/^[1-9]\d*$/.test(custId) || !values[7]) {
        row.issues.push(`Line ${record.line}: invalid driver ID or missing name; not assigned.`);
        continue;
      }
      if ([1, 2, 3, 4, 9].some(index => values[index] !== source.values[index])) {
        row.issues.push(`Line ${record.line}: conflicting car, class or number for ${values[7]}; not assigned.`);
        continue;
      }
      if (drivers.has(custId) && drivers.get(custId) !== values[7]) {
        disputed.add(custId);
        row.issues.push(`Conflicting names for driver ID ${custId}; not assigned.`);
      } else drivers.set(custId, values[7]);
    }
    if (!id.startsWith("invalid:") && teams.length <= 1)
      row.drivers = Array.from(drivers).filter(([key]) => !disputed.has(key)).map(([, name]) => name).join("; ");
    for (const field of ["number", "team", "car", "drivers", "racingClass"] as const) {
      if (!row[field]) row.issues.push(`Missing ${field} value.`);
      const limit = field === "drivers" ? 500 : 160;
      if ((row[field]?.length || 0) > limit)
        throw new EntryListFileError(`Team ID ${id}: ${field} exceeds ${limit} characters; import was not shortened.`);
    }
    if (row.number && !/^\d{1,4}$/.test(row.number)) row.issues.push("Number should contain 1–4 digits.");
    if (row.issues.length) issues.push(`Team ID ${id}: ${row.issues.join(" ")}`);
    rows.push(row);
  }
  return { rows, issues };
}
