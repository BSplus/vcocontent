import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

// Run via scripts/test-image-downloads.mjs: never seed the connected database.
test("public caption search filters the complete stock before paging without changing captions", {
  skip: !process.env.VCO_TEST_PG_PROXY,
  timeout: 60000,
}, async () => {
  const { default: express } = await import("express");
  const { db, pool } = await import("../server/db.ts");
  const { storage } = await import("../server/storage.ts");
  const { users, events, mediaItems } = await import("../shared/schema.ts");
  const { registerRoutes } = await import("../server/routes.ts");
    const { matchReferences } = await import("../server/reference-matching.ts");
    const { PHOTO_NUMBER_POLICY } = await import("../server/utils/photo-number-evidence.ts");
    const { eq } = await import("drizzle-orm");
  const { stopImportWorker } = await import("../server/nextcloud.ts");
  const { stopAnalysisWorker } = await import("../server/analysis-jobs.ts");
  let server;
  try {
    const [owner] = await db.insert(users).values({
      username: "search-fixture", email: "search@example.invalid", password: "not-a-login", isCreator: true, creatorStatus: "approved",
    }).returning();
    const album = async extra => (await db.insert(events).values({
      title: "Synthetic IMSA caption regression", description: "Disposable test only",
      date: new Date("2026-10-01"), ...extra,
    }).returning())[0];
    const official = await album({});
    const photo = async (event, extra = {}) => (await db.insert(mediaItems).values({
      eventId: event.id, type: "image", caption: "MAHLE RACING TEAM", tags: [],
      url: "/fixture.webp", thumbnail: "/fixture.webp", ...extra,
    }).returning())[0];
    const target = await photo(official);
    const video = await photo(official, { type: "video" });
    const fieldOnly = await photo(official, { caption: "Other team", photographer: "MAHLE RACING TEAM" });
    await db.insert(mediaItems).values(Array.from({ length: 60 }, (_, index) => ({
      eventId: official.id, type: "image", caption: `Unrelated filler ${index}`,
      url: "/fixture.webp", thumbnail: "/fixture.webp",
    })));
    const excluded = [];
    for (const extra of [{ isPremium: true }, { adminHidden: true },
      { creatorId: owner.id, visibility: "draft" },
      { creatorId: owner.id, visibility: "published", safetyStatus: "review" }]) {
      excluded.push(await photo(await album(extra)));
    }
    excluded.push(await photo(official, { isPremium: true }));
    const creator = await album({ creatorId: owner.id, visibility: "published" });
    const legacy = await photo(creator);
    excluded.push(await photo(creator, { safetyStatus: "review" }));
    excluded.push(await photo(creator, { safetyStatus: "approved", safetyPolicy: "outdated" }));

    const app = express();
    app.use((req, _res, next) => {
      // Identity is injected only into this disposable test server.
      req.user = req.headers["x-fixture-role"] ? { ...owner, isAdmin: req.headers["x-fixture-role"] === "admin" } : undefined;
      req.isAuthenticated = () => !!req.user; next();
    });
    server = await registerRoutes(app);
    await stopImportWorker(); await stopAnalysisWorker();
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const search = async path => {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      return response.json();
    };
    const ids = rows => rows.map(row => row.id).sort((a, b) => a - b);
    const first = await search("/api/media");
    assert.equal(first.length, 48);
    assert.ok(!first.some(row => row.id === target.id));
    const expected = [target.id, video.id, legacy.id].sort((a, b) => a - b);
    for (const q of ["MAHLE", "mahle", "mahle racing", "TEAM MAHLE", "  mahle   racing  "]) {
      assert.deepEqual(ids(await search(`/api/media?q=${encodeURIComponent(q)}&fields=caption`)), expected);
    }
    assert.deepEqual(ids(await search("/api/media?q=MAHLE&fields=caption&type=image")), [target.id, legacy.id]);
    assert.deepEqual(ids(await search("/api/media?q=MAHLE&fields=caption&type=video")), [video.id]);
    assert.deepEqual(ids(await search("/api/media?q=MAHLE&fields=photographer")), [fieldOnly.id]);
    assert.deepEqual(await search("/api/media?q=MAHLE&fields="), []);
    assert.deepEqual(await search("/api/media?q=MAHLE&fields=tags,identification"), []);
    const defaults = await search("/api/media?q=MAHLE");
    assert.deepEqual(ids(defaults), [...expected, fieldOnly.id].sort((a, b) => a - b));
    const second = await search("/api/media?page=2");
    const paginated = await search("/api/media?page=999&pagination=true");
    assert.equal(paginated.total,first.length+second.length);
    assert.equal(paginated.totalPages,2);
    assert.equal(paginated.page,2);
    assert.equal(paginated.hasMore,false);
    assert.deepEqual(paginated.items,second);
    const filteredPage = await search("/api/media?q=MAHLE&fields=caption&type=image&pagination=true");
    assert.equal(filteredPage.total,2);
    assert.equal(filteredPage.totalPages,1);
    assert.ok(second.some(row => row.id === target.id));
    assert.ok(!second.some(row => first.some(item => item.id === row.id)));
    for (const row of [...first, ...second, ...defaults]) {
      assert.ok(!excluded.some(item => item.id === row.id), `Excluded item leaked: ${row.id}`);
    }
    for (const role of ["owner", "admin"]) {
      const response = await fetch(base + "/api/media?q=MAHLE", { headers: { "x-fixture-role": role } });
      assert.equal(response.status, 200);
      assert.deepEqual(ids(await response.json()), ids(defaults), "public search boundaries do not expand for logged-in users");
    }
    const gallery = await search(`/api/events/${official.id}/media?page=2`);
    assert.equal(gallery.find(row => row.id === target.id).caption, "MAHLE RACING TEAM");
    assert.equal((await storage.getMediaItem(target.id)).caption, "MAHLE RACING TEAM");
    for (const path of ["/api/media?page=0", "/api/media?fields=invalid", "/api/media?type=audio",
      `/api/media?q=${"x".repeat(101)}`]) {
      assert.equal((await fetch(base + path)).status, 400);
    }
    const seen={number:"01",team:"",drivers:"",vehicle:"Prototype",manufacturer:"",
      racingClass:"",discipline:"",source:"visual"};
    const refs=[{scope:"event",kind:"entry",session:null,updatedAt:new Date(),rows:[
      {number:"1",team:"BMW M Verstappen Sim Racing",car:"BMW M Hybrid V8",drivers:"Registered lineup"},
    ]}];
    // Demonstrate the historical chain (01 -> 1 -> team/lineup) only in the
    // disposable database. A saved reference result remains searchable.
    const wrong=await photo(official,{caption:"618.jpg",tags:["Prototype"],
      identification:matchReferences([seen],refs,null)});
    const legitimate=await photo(official,{caption:"Legitimate entry",identification:
       matchReferences([{...seen,vehicleRegion:[0,0,1000,1000],numberEvidence:PHOTO_NUMBER_POLICY}],refs,null,"",true,true)});
    const manual=await photo(official,{caption:"Protected caption",identificationManual:true,
      identification:[{...seen,number:"1",team:"Verstappen Sim Racing",drivers:"Manual lineup",source:"manual"}]});
    await photo(official,{caption:"Unverified veto hint, not an identity",identification:[
      {...seen,number:"",referenceConstraints:[{vehicle:"",manufacturer:"",team:"BMW M Verstappen Sim Racing"}]},
    ]});
    const before=[wrong.id,legitimate.id,manual.id].sort((a,b)=>a-b);
    for (const fields of ["identification","caption,photographer,tags,identification"]) {
      assert.deepEqual(ids(await search(`/api/media?q=verstap&fields=${fields}`)),before);
    }
    assert.deepEqual(await search("/api/media?q=verstap&fields=caption,photographer,tags"),[]);
    const corrected=matchReferences([seen],refs,null,"",true,true);
    await db.update(mediaItems).set({identification:corrected}).where(eq(mediaItems.id,wrong.id));
    for(const q of ["verstap","VERSTAPPEN","versta","stapp"]) {
      assert.deepEqual(ids(await search(`/api/media?q=${q}&fields=identification`)),[legitimate.id,manual.id]);
      assert.deepEqual(ids(await search(`/api/media?q=${q}`)),[legitimate.id,manual.id]);
    }
    const saved=await storage.getMediaItem(wrong.id);
    assert.equal(saved.caption,"618.jpg");assert.deepEqual(saved.tags,["Prototype"]);
    assert.equal(saved.identification[0].number,"");assert.equal(saved.identification[0].drivers,"");
    assert.equal((await storage.getMediaItem(legitimate.id)).identification[0].number,"01");
    assert.equal((await storage.getMediaItem(manual.id)).identificationManual,true);
  } finally {
    await stopImportWorker(); await stopAnalysisWorker();
    if (server?.listening) { server.close(); await once(server, "close"); }
    await pool.end();
  }
});
