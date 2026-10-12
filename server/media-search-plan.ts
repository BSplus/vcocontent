import { pool } from "./db";

type SearchTerm = { term: string; jsonPrefilter: boolean };
const decisions = new Map<string, { expires: number; value: Promise<boolean> }>();
const ttlMs = 120_000;
const maxEntries = 256;

/** Cache only a planner decision, NEVER counts, IDs, permissions or search results. */
async function selectiveIdentificationIndex(term: string): Promise<boolean> {
  const now = Date.now();
  const cached = decisions.get(term);
  if (cached && cached.expires > now) return cached.value;
  decisions.delete(term);
  if (decisions.size >= maxEntries) decisions.delete(decisions.keys().next().value!);
  const value = pool.query(
    "EXPLAIN (FORMAT JSON) select id from media_items where identification::text ilike $1", [term],
  ).then(result => {
    const indexed = (plan: any): boolean => plan["Index Name"] === "media_identification_search_idx" ||
      (plan.Plans ?? []).some(indexed);
    return indexed(result.rows[0]["QUERY PLAN"][0].Plan);
  }).catch(error => {
    // Do not retain failed probes or silently hide a database failure.
    if (decisions.get(term)?.value === value) decisions.delete(term);
    throw error;
  });
  decisions.set(term, { expires: now + ttlMs, value });
  return value;
}

export async function planMediaSearchTerms(search: string, identification: boolean): Promise<SearchTerm[]> {
  return Promise.all(search.trim().split(/\s+/).filter(Boolean).slice(0,12).map(async word => {
    const term = `%${word.replace(/[\\%_]/g,"\\$&")}%`;
    // Plain words cannot cross concat_ws boundaries. Quotes, backslashes and
    // controls can be JSON-escaped, so their exact EXISTS must run on its own.
    const eligible = identification && word.length >= 3 && !/["\\\u0000-\u001f]/.test(word);
    return { term, jsonPrefilter: eligible && await selectiveIdentificationIndex(term) };
  }));
}

/** Used after index changes by the isolated measurement; no public API endpoint. */
export function clearMediaSearchPlanCache() { decisions.clear(); }
