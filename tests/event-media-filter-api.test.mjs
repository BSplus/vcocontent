import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { pageMetadata } from "../shared/pagination.ts";

test("event type filters count and paginate the same accessible rows for guests, owners and admins", {
  skip: !process.env.VCO_TEST_PG_PROXY, timeout: 120000,
}, async () => {
  const { default: express } = await import("express");
  const { db, pool } = await import("../server/db.ts");
  const { storage } = await import("../server/storage.ts");
  const { registerRoutes } = await import("../server/routes.ts");
  const { users, events, mediaItems } = await import("../shared/schema.ts");
  const { inArray } = await import("drizzle-orm");
  const marker = randomUUID();
  let server;
  const eventIds = [], userIds = [];
  try {
    const actors = await db.insert(users).values(["owner", "admin", "stranger"].map(role => ({
      username: `${role}-${marker}`, email: `${role}-${marker}@example.invalid`, password: "synthetic",
      isAdmin: role === "admin", isCreator: true, creatorStatus: "approved", emailVerifiedAt: new Date(),
    }))).returning();
    userIds.push(...actors.map(actor => actor.id));
    const [owner] = actors;
    const galleries = await db.insert(events).values([
      {}, { creatorId: owner.id, visibility: "published", safetyStatus: "legacy" },
      { creatorId: owner.id, visibility: "draft" },
      { isPremium: true }, { adminHidden: true },
    ].map(extra => ({ title: `Filter ${marker}`, description: "Synthetic only", date: new Date(), ...extra }))).returning();
    eventIds.push(...galleries.map(event => event.id));
    const [official, creator, draft, premium, hidden] = galleries;
    const seeded = new Map();
    for (const event of galleries) {
      // Old photos are beyond the first mixed page; a browser-only filter would miss them.
      const rows = await db.insert(mediaItems).values([
        ...Array.from({ length: 50 }, () => ({ type: "image" })),
        ...Array.from({ length: 51 }, () => ({ type: "video" })),
        { type: "image", safetyStatus: "review" }, { type: "video", safetyStatus: "error" },
        { type: "image", archivedAt: new Date() }, { type: "video", archivedAt: new Date() },
        { type: "video", isPremium: true },
      ].map(extra => ({
        eventId: event.id, url: "/synthetic-original", thumbnail: "/synthetic-poster",
        caption: "Filter fixture", ...extra,
      }))).returning();
      seeded.set(event.id, rows);
    }
    const app = express();
    app.use((req, _res, next) => {
      req.user = actors.find(actor => actor.username.startsWith(`${req.headers["x-fixture-role"]}-`));
      req.isAuthenticated = () => !!req.user;
      next();
    });
    server = await registerRoutes(app, { workers: false });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (id, query, role) => fetch(`${base}/api/events/${id}/media${query}`, {
      headers: role ? { "x-fixture-role": role } : {},
    });
    for (const event of galleries) for (const role of [undefined, "owner", "admin", "stranger"]) {
      const manager = role === "admin" || (role === "owner" && event.creatorId === owner.id);
      const allowed = manager || (event.id !== draft.id && event.id !== hidden.id);
      for (const type of ["all", "image", "video", undefined]) {
        const expected = !allowed || event.isPremium ? [] : seeded.get(event.id)
          .filter(item => !item.archivedAt && (!type || type === "all" || item.type === type)
            && (manager || !event.creatorId || item.safetyStatus === "legacy"))
          .sort((a, b) => b.id - a.id);
        for (const page of [1, 2, 999]) {
          const query = `?pagination=true&page=${page}${type ? `&type=${type}` : ""}`;
          const response = await request(event.id, query, role);
          assert.equal(response.status, allowed ? 200 : 404);
          if (!allowed) continue;
          const body = await response.json();
          const meta = pageMetadata(expected.length, page, 48);
          for (const key of Object.keys(meta)) assert.equal(body[key], meta[key], `${event.id}/${role}/${type}/${key}`);
          assert.deepEqual(body.items.map(item => item.id), expected.slice((meta.page - 1) * 48, meta.page * 48).map(item => item.id));
          if (!manager) assert.ok(body.items.filter(item => item.isPremium).every(item => item.url === ""), "keep existing premium redaction");
        }
        if (allowed) {
          const response = await request(event.id, `?${type ? `type=${type}` : ""}`, role);
          const legacy = await response.json();
          assert.ok(Array.isArray(legacy), "existing consumers keep their array contract");
          assert.deepEqual(legacy.map(item => item.id), expected.slice(0, 48).map(item => item.id));
        }
      }
    }
    for (const role of [undefined, "admin"]) for (const query of [
      "?type=photo", "?type=", "?type=IMAGE", "?type=image&type=video", "?type[]=image", "?type[x]=video",
    ]) {
      const response = await request(official.id, query, role);
      assert.equal(response.status, 400, query);
      assert.equal((await response.json()).error, "Invalid media type");
    }
    // Empty results are confirmed empty pages, never a fallback to another media type.
    const [empty] = await db.insert(events).values({ title: "Empty filter", description: "Synthetic only", date: new Date() }).returning();
    eventIds.push(empty.id);
    const response = await request(empty.id, "?type=video&pagination=true&page=9");
    assert.deepEqual(await response.json(), { ...pageMetadata(0, 9, 48), items: [] });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    try {
      if (eventIds.length) {
        await db.delete(mediaItems).where(inArray(mediaItems.eventId, eventIds));
        await db.delete(events).where(inArray(events.id, eventIds));
      }
      if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    } finally {
      storage.sessionStore.close();
      await pool.end();
    }
  }
});
