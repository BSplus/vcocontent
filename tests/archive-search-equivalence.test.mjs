import test from "node:test";
import assert from "node:assert/strict";

test("indexed JSON prefilter preserves exact search fields, escaping and page order", {
  skip: !process.env.VCO_TEST_PG_PROXY, timeout: 120000,
}, async () => {
  const { pool, db } = await import("../server/db.ts");
  const { storage } = await import("../server/storage.ts");
  const { events, mediaItems } = await import("../shared/schema.ts");
  const { eq } = await import("drizzle-orm");
  const original = pool.query;
  let last;
  pool.query = function(config, params, ...rest) {
    last = { text: typeof config === "string" ? config : config.text, params };
    // Force the optimized branch even on this intentionally tiny stock. Real
    // planner/index selection is exercised by the large-archive benchmark.
    if (last.text.startsWith("EXPLAIN (FORMAT JSON) select id from media_items"))
      return Promise.resolve({ rows: [{ "QUERY PLAN": [{ Plan: {
        "Node Type": "Bitmap Index Scan", "Index Name": "media_identification_search_idx",
      } }] }] });
    return original.call(this, config, params, ...rest);
  };
  let event;
  try {
    [event] = await db.insert(events).values({
      title: "Synthetic equivalence", description: "Disposable", date: new Date(),
    }).returning();
    const rows = [
      { team: "North Racing", drivers: "A. One / B. Two", number: "007", vehicle: "Porsche 911" },
      { team: 'Quote"team', drivers: "Slash\\driver", vehicle: "100%_done" },
      { team: "Écurie Äpfel", drivers: "日本語", number: "0" },
      { team: "Control\u0001team", drivers: "Line\nbreak", vehicle: "Tab\tcar" },
      { team: "", drivers: "", number: "", vehicle: "" },
      { team: null, drivers: null, number: null, vehicle: null },
      // Legacy JSON may be unusual. The existing ->> semantics still apply.
      { team: { name: "Nested", note: 'Quote"inside' }, drivers: ["Array", "driver"] },
    ];
    await db.insert(mediaItems).values(Array.from({ length: 70 }, (_, i) => ({
      eventId: event.id, type: i % 2 ? "image" : "video",
      url: "/synthetic.webp", thumbnail: "/synthetic.webp",
      caption: i % 3 ? "Other caption" : "North caption 100%_done",
      photographer: i % 5 ? null : "North photographer",
      tags: i % 4 ? ["racing", 'Quote"tag', "Slash\\tag"] : null,
      identification: i % 11 ? [rows[i % rows.length], { team: "SecondEntry", source: "hidden-source",
        referenceConstraints: [{ team: "ForbiddenHint" }], unknown: "NotSearchable" }] : [],
      isPremium: i % 13 === 0,
    })));
    const fields = ["caption", "photographer", "tags", "identification"];
    const searches = ["North", "north racing", "007", "911", 'Quote"team', "Slash\\driver",
      "100%_done", "%", "_", "\\", "\u0001team", "Line break", "Tab car", "Écurie",
      "日本語", "Nested", "Array", "SecondEntry", "hidden-source", "ForbiddenHint", "NotSearchable", "none"];
    for (let mask = 0; mask < 16; mask++) for (const search of searches) {
      const selected = fields.filter((_, i) => mask & (1 << i));
      const type = mask % 3 === 0 ? "image" : mask % 3 === 1 ? "video" : undefined;
      const actual = await storage.countPublicMedia(search, type, selected);
      const query = last;
      const legacyText = query.text.replace(
        /"media_items"\."identification"::text ilike (\$\d+) and /g, "$1::text is not null and ");
      const legacy = await original.call(pool, legacyText, query.params);
      assert.equal(actual, Number(Object.values(legacy.rows[0])[0]), JSON.stringify({ search, selected, type }));
      const page = await storage.listPublicMedia(1, 48, search, type, selected);
      const listQuery = last;
      const legacyList = await original.call(pool, `select id from (${
        listQuery.text.replace(/"media_items"\."identification"::text ilike (\$\d+) and /g,
          "$1::text is not null and ")
      }) baseline`, listQuery.params);
      assert.deepEqual(page.map(row => row.id), legacyList.rows.map(row => row.id));
      assert.ok(page.length <= 48);
    }
    assert.equal(await storage.countPublicMedia("ForbiddenHint", undefined, ["identification"]), 0);
    assert.equal(await storage.countPublicMedia("hidden-source", undefined, ["identification"]), 0);
  } finally {
    pool.query = original;
    if (event) {
      await db.delete(mediaItems).where(eq(mediaItems.eventId, event.id));
      await db.delete(events).where(eq(events.id, event.id));
    }
    storage.sessionStore.close();
    await pool.end();
  }
});
