// Opt-in only; the runner supplies a disposable PostgreSQL database, never live data.
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("large archive: exact counts, plans and concurrent requests", {
  skip: !process.env.VCO_TEST_PG_PROXY || process.env.VCO_ARCHIVE_BENCHMARK !== "1",
  timeout: 600000,
}, async () => {
  process.env.RESEND_API_KEY = "synthetic-mail-key";
  process.env.RESEND_FROM = "verify@example.test";
  process.env.PUBLIC_SITE_URL = "https://example.test";
  const { db, pool } = await import("../server/db.ts");
  const { storage } = await import("../server/storage.ts");
  const { clearMediaSearchPlanCache } = await import("../server/media-search-plan.ts");
  const { registerRoutes } = await import("../server/routes.ts");
  const { default: express } = await import("express");
  const { SAFETY_POLICY } = await import("../shared/safety-policy.ts");
  const size = Number(process.env.VCO_ARCHIVE_ROWS ?? 500000);
  assert.ok(Number.isSafeInteger(size) && size >= 100000 && size <= 2000000);
  let server;
  const originalQuery = pool.query;
  let captured = [];
  let phase = "before";
  pool.query = function(config, values, ...rest) {
    let text = typeof config === "string" ? config : config.text;
    // Reproduce the previous exact search on the same data, pool and API.
    // This removes ONLY the redundant JSON prefilter, not the whitelist EXISTS.
    if (phase === "before")
      text = text.replace(/"media_items"\."identification"::text ilike (\$\d+) and /g, "$1::text is not null and ");
    config = typeof config === "string" ? text : { ...config, text };
    if (/^select .*count\(\*\)/is.test(text) && !text.includes("EXPLAIN"))
      captured.push({ text, values: values ?? config.values ?? [] });
    return originalQuery.call(this, config, values, ...rest);
  };
  const execute = (text, values = []) => originalQuery.call(pool, text, values);
  const report = { size, concurrency: 8, rounds: 3, phases: {} };
  try {
    for (const name of ["media_caption_search_idx", "media_photographer_search_idx",
      "media_identification_search_idx", "media_event_count_idx", "media_thumbnail_options_idx"])
      await execute(`DROP INDEX IF EXISTS ${name}`);
    await execute(`INSERT INTO users (id,username,email,password,is_admin,is_creator,creator_status,email_verified_at,suspended)
      SELECT n,'fixture-'||n,'fixture-'||n||'@example.invalid','synthetic',n=1,true,
        CASE WHEN n%29=0 THEN 'rejected' ELSE 'approved' END,now(),n%31=0
      FROM generate_series(1,10000) n`);
    await execute(`INSERT INTO events (id,title,description,date,creator_id,visibility,admin_hidden,safety_status)
      SELECT n,'Archive event '||n,'Synthetic only',now(),CASE WHEN n%2=0 THEN 2 ELSE NULL END,
        CASE WHEN n%17=0 THEN 'draft' ELSE 'published' END,n%19=0,'legacy'
      FROM generate_series(1,2000) n`);
    // 5% of the archive belongs to a large gallery. Include selective, broad,
    // short, escaped, multi-term, typed and identification-only search cases.
    await execute(`INSERT INTO media_items
      (id,event_id,type,url,thumbnail,caption,photographer,tags,identification,is_premium,
       safety_status,safety_policy,content_version,safety_version)
      SELECT n,CASE WHEN n%20=0 THEN 1 WHEN n%20=1 THEN 2 ELSE 1+n%2000 END,
        CASE WHEN n%11=0 THEN 'video' ELSE 'image' END,
        '/synthetic-original-'||n||'.webp',
        CASE WHEN n%23=0 THEN 'https://untrusted.invalid/image.png'
          ELSE '/api/media/files/thumb-'||md5(n::text)::uuid||'.webp' END,
        CASE WHEN n%997=0 THEN 'NeedleQuartz finish 100%_done' ELSE 'Race session lap '||n END,
        CASE WHEN n%991=0 THEN 'LensQuartz' ELSE 'Archive photographer' END,
        ARRAY[CASE WHEN n%983=0 THEN 'TagQuartz' ELSE 'racing' END,'track'],
        jsonb_build_array(jsonb_build_object('number',(n%999)::text,'team',
          CASE WHEN n%977=0 THEN 'TeamQuartz' ELSE 'North Racing' END,'vehicle','Porsche 911','drivers','A. One / B. Two')),
        n%13=0,CASE WHEN (n/20)%7=0 THEN 'review' WHEN (n/20)%5=0 THEN 'approved' ELSE 'legacy' END,
        $2,1,CASE WHEN n%37=0 THEN 0 ELSE 1 END
      FROM generate_series(1,$1::int) n`, [size, SAFETY_POLICY]);
    await execute(`INSERT INTO community_favorites(user_id,media_id)
      SELECT CASE WHEN n%20 IN (0,1) THEN 1 ELSE 2+n%9998 END,n FROM generate_series(1,$1::int) n`, [size]);
    await execute(`INSERT INTO download_history(user_id,media_id,quality,operation_id)
      SELECT CASE WHEN n%20 IN (0,1) THEN 1 ELSE 2+n%9998 END,n,'low','synthetic-'||n FROM generate_series(1,$1::int) n`, [size]);
    await execute(`INSERT INTO creator_follows(user_id,creator_id)
      SELECT u,2+(u*37+n)%9998 FROM generate_series(1,1000) u CROSS JOIN generate_series(1,200) n
      WHERE u <> 2+(u*37+n)%9998`);
    await execute("VACUUM ANALYZE");
    const actor = await storage.getUser(1);
    const app = express();
    app.use((req, _res, next) => {
      req.user = req.headers["x-fixture-user"] ? actor : undefined;
      req.isAuthenticated = () => !!req.user; next();
    });
    server = await registerRoutes(app, { workers: false });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const scenarios = {
      search_all: "/api/media?pagination=true",
      search_selective: "/api/media?pagination=true&q=NeedleQuartz",
      search_caption: "/api/media?pagination=true&q=NeedleQuartz&fields=caption",
      search_photographer: "/api/media?pagination=true&q=LensQuartz&fields=photographer",
      search_tags: "/api/media?pagination=true&q=TagQuartz&fields=tags",
      search_identification: "/api/media?pagination=true&q=TeamQuartz&fields=identification",
      search_broad: "/api/media?pagination=true&q=racing",
      search_identification_broad: "/api/media?pagination=true&q=Porsche&fields=identification",
      search_short: "/api/media?pagination=true&q=91",
      search_multi: "/api/media?pagination=true&q=NeedleQuartz%20finish&type=image",
      search_escaped: "/api/media?pagination=true&q=100%25_done&fields=caption",
      event_public: "/api/events/1/media?pagination=true",
      event_creator_public: "/api/events/2/media?pagination=true&fixture=public",
      event_manager: "/api/events/2/media?pagination=true",
      event_deep: "/api/events/2/media?pagination=true&page=50",
      thumbnails: "/api/events/1/thumbnail-options",
      thumbnails_deep: "/api/events/1/thumbnail-options?page=50",
      thumbnails_creator: "/api/events/2/thumbnail-options?page=50",
      photo_matching: "/api/events/1/photo-matching",
      favorites: "/api/account/favorites",
      favorites_deep: "/api/account/favorites?page=50",
      downloads: "/api/account/downloads",
      following: "/api/account/following",
    };
    const get = async path => {
      const response = await fetch(base + path, {
        headers: path.startsWith("/api/media?") || path.startsWith("/api/events/1/media?") || path.includes("fixture=public")
          ? {} : { "x-fixture-user": "yes" },
      });
      assert.equal(response.status, 200, path);
      return response.json();
    };
    const totals = {};
    const pages = {};
    async function measure() {
      const results = {};
      for (const [name, path] of Object.entries(scenarios)) {
        captured = [];
        const first = await get(path);
        assert.ok(Number.isSafeInteger(first.total), name);
        assert.ok((first.items ?? first.photos).length <= first.pageSize, name);
        const page = { page: first.page, pageSize: first.pageSize, totalPages: first.totalPages,
          ids: (first.items ?? first.photos).map(item => item.id) };
        if (phase === "before") { totals[name] = first.total; pages[name] = page; }
        else {
          assert.equal(first.total, totals[name], `${name}: counts unchanged`);
          assert.deepEqual(page, pages[name], `${name}: page sizes and ordered IDs unchanged`);
        }
        const queries = [...new Map(captured.map(q => [q.text, q])).values()];
        assert.ok(queries.length, `${name}: captured real count query`);
        const plans = [];
        for (const query of queries) {
          const explained = await execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query.text, query.values);
          plans.push({ query, explain: explained.rows[0]["QUERY PLAN"][0] });
        }
        const samples = [];
        await get(path); // Warm before measuring; setup/DDL and EXPLAIN are excluded.
        const batchStart = performance.now();
        for (let round = 0; round < report.rounds; round++) await Promise.all(
          Array.from({ length: report.concurrency }, async () => {
            const start = performance.now();
            const body = await get(path);
            samples.push(performance.now() - start);
            assert.equal(body.total, totals[name], name);
          }));
        const elapsed = performance.now() - batchStart;
        samples.sort((a,b) => a-b);
        results[name] = { total: first.total, countMs: plans.map(p => p.explain["Execution Time"]),
          p50Ms: samples[Math.floor(samples.length * .5)], p95Ms: samples[Math.floor(samples.length * .95)],
          requestsPerSecond: samples.length * 1000 / elapsed, plans };
        console.log(phase, name, JSON.stringify({ ...results[name], plans: undefined }));
        report.phases[phase] = results;
        await mkdir("generated-artifacts", { recursive: true });
        await writeFile("generated-artifacts/archive-counts-benchmark.json", JSON.stringify(report, null, 2));
      }
      report.phases[phase] = results;
    }
    await measure();
    // CONCURRENTLY must run as individual statements, outside a transaction.
    const ddlStart = performance.now();
    // psql parses SQL literals correctly (the thumbnail pattern contains ';').
    assert.match(process.env.VCO_TEST_PG_PORT ?? "", /^\d+$/);
    await promisify(execFile)("psql", ["-h", "127.0.0.1", "-p", process.env.VCO_TEST_PG_PORT,
      "-U", "vco_test", "-d", "photo_test", "-v", "ON_ERROR_STOP=1",
      "-f", "migrations/0006-media-search-indexes.sql"]);
    report.indexBuildMs = performance.now() - ddlStart;
    await execute("VACUUM ANALYZE");
    report.indexSizes = (await execute(`SELECT indexrelname,pg_relation_size(indexrelid)::int AS bytes
      FROM pg_stat_user_indexes WHERE indexrelname IN
      ('media_caption_search_idx','media_photographer_search_idx','media_identification_search_idx',
       'media_event_count_idx','media_thumbnail_options_idx')`)).rows;
    phase = "after";
    clearMediaSearchPlanCache();
    await measure();
  } finally {
    await mkdir("generated-artifacts", { recursive: true });
    await writeFile("generated-artifacts/archive-counts-benchmark.json", JSON.stringify(report, null, 2));
    pool.query = originalQuery;
    if (server) await new Promise(resolve => server.close(resolve));
    storage.sessionStore.close();
    await pool.end();
  }
});
