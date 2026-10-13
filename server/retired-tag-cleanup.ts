import { createHash } from "node:crypto";

type Query = (text: string, values?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
const targets = [
  { table: "media_items", id: "id", columns: ["tags", "manual_tags", "suppressed_ai_tags"] },
  { table: "media_analysis_jobs", id: "media_id", columns: ["generated_tags"] },
] as const;
// Same whole-tag, case/whitespace-insensitive match as the shared input policy.
const retired = (value: string) => `lower(regexp_replace(btrim(${value}, E' \\t\\n\\r\\f\\v'), '[[:space:]]+', ' ', 'g')) = 'real motorsport'`;
const contains = (column: string) => `exists(select 1 from unnest(${column}) tag where ${retired("tag")})`;
const cleaned = (column: string) => `case when ${column} is null then null else array(select tag from unnest(${column}) with ordinality as t(tag,position) where not coalesce(${retired("tag")},false) order by position) end`;

/** Read-only, count-only audit output; hash pins the exact affected tag arrays. */
export async function retiredTagCleanupPlan(query: Query) {
  const summary: Record<string, number> = {};
  const fingerprint = createHash("sha256");
  for (const target of targets) {
    const { rows } = await query(`select ${target.id}, ${target.columns.join(", ")}
      from ${target.table} where ${target.columns.map(contains).join(" or ")} order by ${target.id}`);
    summary[target.table] = rows.length;
    for (const column of target.columns) {
      summary[`${target.table}.${column}`] = rows.reduce((n, row) =>
        n + (row[column] || []).filter((tag: string | null) => tag !== null &&
          tag.trim().replace(/\s+/g, " ").toLowerCase() === "real motorsport").length, 0);
    }
    fingerprint.update(JSON.stringify([target.table, rows]));
  }
  return { affected: summary, fingerprint: fingerprint.digest("hex") };
}

/** Caller owns the transaction. Fail closed on plan drift or unintended changes. */
export async function applyRetiredTagCleanup(query: Query, expectedFingerprint: string) {
  await query("set local lock_timeout = '5s'");
  await query("lock table media_analysis_jobs, media_items in access exclusive mode");
  const before = await retiredTagCleanupPlan(query);
  if (before.fingerprint !== expectedFingerprint) throw new Error("Tag cleanup plan changed. Run the read-only plan again.");
  for (const target of targets) {
    const backup = `retired_tag_before_${target.table}`;
    await query(`create temporary table ${backup} on commit drop as select * from ${target.table}
      where ${target.columns.map(contains).join(" or ")}`);
    await query(`update ${target.table} set ${target.columns.map(column => `${column}=${cleaned(column)}`).join(", ")}
      where ${target.columns.map(contains).join(" or ")}`);
    const { rows } = await query(`select count(*)::int as unexpected from ${backup} b
      left join ${target.table} a on a.${target.id}=b.${target.id}
      where a.${target.id} is null or
      (to_jsonb(a) - array[${target.columns.map(c => `'${c}'`).join(",")}]) is distinct from
      (to_jsonb(b) - array[${target.columns.map(c => `'${c}'`).join(",")}])
      or ${target.columns.map(c => `a.${c} is distinct from (${cleaned(`b.${c}`)})`).join(" or ")}`);
    if (rows[0].unexpected !== 0) throw new Error("Tag cleanup changed unrelated data; transaction must roll back.");
  }
  const after = await retiredTagCleanupPlan(query);
  if (Object.values(after.affected).some(count => count !== 0)) throw new Error("Retired tags remain; transaction must roll back.");
  return { before, after };
}
