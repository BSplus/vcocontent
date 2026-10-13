import { sql, type AnyColumn } from "drizzle-orm";

/** Hide retired legacy tags while the operator reviews/applies the cleanup. */
export function activeMediaTagsSql(column: AnyColumn) {
  return sql<string[]>`case when ${column} is null then null else array(
    select tag from unnest(${column}) with ordinality as t(tag,position)
    where not coalesce(lower(regexp_replace(btrim(tag, E' \\t\\n\\r\\f\\v'), '[[:space:]]+', ' ', 'g')) = 'real motorsport', false)
    order by position) end`;
}
