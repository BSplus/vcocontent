import test from "node:test";
import assert from "node:assert/strict";

test("search planner uses selective indexes only and bounds/deduplicates decision caching", {
  skip: !process.env.VCO_TEST_PG_PROXY,
}, async () => {
  const { pool } = await import("../server/db.ts");
  const { planMediaSearchTerms, clearMediaSearchPlanCache } = await import("../server/media-search-plan.ts");
  const original = pool.query;
  const originalNow = Date.now;
  let time = originalNow(), calls = 0, fail = false;
  let plan = { "Node Type": "Seq Scan" };
  pool.query = async (sql, params) => {
    calls++;
    assert.equal(sql, "EXPLAIN (FORMAT JSON) select id from media_items where identification::text ilike $1");
    assert.equal(params.length, 1);
    if (fail) throw new Error("synthetic planning failure");
    await new Promise(resolve => setTimeout(resolve, 1));
    return { rows: [{ "QUERY PLAN": [{ Plan: plan }] }] };
  };
  Date.now = () => time;
  try {
    clearMediaSearchPlanCache();
    assert.deepEqual(await planMediaSearchTerms("", true), []);
    assert.ok((await planMediaSearchTerms('91 % _ "quoted Slash\\word \u0001control', true))
      .every(term => !term.jsonPrefilter));
    assert.equal(calls, 0, "short or JSON-escaped words never run a probe");
    assert.ok((await planMediaSearchTerms("CaptionOnly", false)).every(term => !term.jsonPrefilter));
    assert.equal(calls, 0);
    assert.equal((await planMediaSearchTerms("Porsche", true))[0].jsonPrefilter, false);
    assert.equal(calls, 1, "broad sequential plan keeps the exact legacy predicate");
    plan = { "Node Type": "Bitmap Heap Scan", Plans: [
      { "Node Type": "Bitmap Index Scan", "Index Name": "media_identification_search_idx" },
    ] };
    const count = calls;
    const requests = await Promise.all(Array.from({ length: 8 }, () => planMediaSearchTerms("SelectiveTeam", true)));
    assert.ok(requests.every(terms => terms[0].jsonPrefilter));
    assert.equal(calls, count + 1, "concurrent requests share one planning probe");
    assert.equal((await planMediaSearchTerms("Porsche", true))[0].jsonPrefilter, false);
    time += 120001;
    assert.equal((await planMediaSearchTerms("Porsche", true))[0].jsonPrefilter, true,
      "index/statistics changes are reconsidered after the bounded TTL");
    clearMediaSearchPlanCache();
    fail = true;
    await assert.rejects(planMediaSearchTerms("RetryTeam", true), /synthetic planning failure/);
    fail = false;
    assert.equal((await planMediaSearchTerms("RetryTeam", true))[0].jsonPrefilter, true,
      "failed probes are not silently retained");
    clearMediaSearchPlanCache();
    for (let i = 0; i < 257; i++) await planMediaSearchTerms(`UniqueTeam${i}`, true);
    const before = calls;
    await planMediaSearchTerms("UniqueTeam0", true);
    assert.equal(calls, before + 1, "old decisions are evicted instead of growing without bound");
    assert.equal((await planMediaSearchTerms("1 2 3 4 5 6 7 8 9 10 11 12 13", false)).length, 12);
  } finally {
    clearMediaSearchPlanCache();
    Date.now = originalNow;
    pool.query = original;
    await pool.end();
  }
});
