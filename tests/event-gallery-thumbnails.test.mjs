import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { once } from "node:events";
import { Readable } from "node:stream";
import { Client } from "@replit/object-storage";

process.env.RESEND_API_KEY = "synthetic-key";
process.env.RESEND_FROM = "verify@example.test";
process.env.PUBLIC_SITE_URL = "https://example.test";
const { storage } = await import("../server/storage.ts");
const { db, pool } = await import("../server/db.ts");
const { registerRoutes } = await import("../server/routes.ts");
const { registerRequestParsers } = await import("../server/request-parsers.ts");
const { SAFETY_POLICY } = await import("../server/beta-policy.ts");
const { galleryThumbnailReference } = await import("../server/gallery-thumbnail-policy.ts");
const fixture = { id: 95201, creatorId: 8310, title: "Gallery", description: "Fixture",
  date: new Date(), coverImage: null, customThumbnail: null, isPremium: false, visibility: "draft",
  safetyStatus: "approved", safetyPolicy: SAFETY_POLICY, contentVersion: 0, safetyVersion: 0 };
const key = "thumb-00000000-0000-0000-0000-000000000010.webp";
const reference = `/api/media/files/${key}`;
const approved = { id: 44, eventId: fixture.id, type: "image", thumbnail: reference, isPremium: false,
  safetyStatus: "approved", safetyPolicy: SAFETY_POLICY, contentVersion: 0, safetyVersion: 0 };
let event, photos, server, base, writes, imageBytes, optionsFail;
const originals = {};
const download = Client.prototype.downloadAsStream;
const call = (path, role = "owner", init = {}) => fetch(`${base}${path}`, {
  redirect: "manual", ...init, headers: { "content-type": "application/json", "x-role": role, ...init.headers },
});
const save = (body, role = "owner") => call(`/api/events/${fixture.id}`, role, {
  method: "PUT", body: JSON.stringify(body),
});
test.before(async () => {
  imageBytes = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#123456" } }).webp().toBuffer();
  Client.prototype.downloadAsStream = () => Readable.from([imageBytes]);
  for (const [name, fn] of Object.entries({
    getEvent: async id => id === fixture.id ? event : undefined,
    getEvents: async () => [event],
    getEventsWithCardFallbacks: async () => [event],
    getEventCardFallbacks: async () => new Map(),
    getEventsByCreator: async () => [event],
    getUser: async () => ({ id: 8310, emailVerifiedAt: new Date(), creatorStatus: "approved", suspended: false }),
    getMediaItem: async id => photos.find(p => p.id === id),
    findMediaByKey: async key => photos.find(p => p.thumbnail === `/api/media/files/${key}`),
    countEventThumbnailOptions: async ev => {
      if (optionsFail) throw new Error("synthetic");
      return ev.isPremium ? 0 : photos.filter(p => galleryThumbnailReference(p, ev)).length;
    },
    getEventThumbnailOptions: async (ev, page) => {
      if (optionsFail) throw new Error("synthetic");
      return photos.filter(p => galleryThumbnailReference(p, ev)).slice((page - 1) * 24, (page - 1) * 24 + 25);
    },
    updateEvent: async (_id, changes) => { writes++; event = { ...event, ...changes }; return event; },
  })) { originals[name] = storage[name]; storage[name] = fn; }
  const app = express();
  registerRequestParsers(app);
  app.use((req, _res, next) => {
    const role = req.headers["x-role"];
    if (role !== "anonymous") req.user = { id: role === "stranger" ? 8311 : 8310,
      isAdmin: role === "admin", creatorStatus: "approved", suspended: role === "suspended" };
    req.isAuthenticated = () => !!req.user;
    next();
  });
  server = await registerRoutes(app, { workers: false });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => { event = { ...fixture }; photos = [{ ...approved }]; writes = 0; optionsFail = false; });
test.after(async () => {
  Object.assign(storage, originals);
  Client.prototype.downloadAsStream = download;
  await new Promise(resolve => server.close(resolve));
  storage.sessionStore.close();
  await pool.end();
});

test("owner and admin can select approved draft photos; selection persists without changing the cover", async () => {
  for (const role of ["owner", "admin"]) {
    event.customThumbnail = null;
    const list = await call(`/api/events/${event.id}/thumbnail-options`, role);
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).photos, [{ id: 44, caption: undefined,
      reference, preview: reference }].map(({ caption, ...rest }) => rest));
    const response = await save({ customThumbnail: reference }, role);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).customThumbnail, reference);
    assert.equal((await (await call(`/api/events/${event.id}`, role)).json()).customThumbnail, reference);
    assert.equal(event.coverImage, null);
    assert.equal((await call(`/api/events/${event.id}/thumbnail`, role)).status, 302);
    assert.equal((await call(`/api/events/${event.id}/thumbnail`, "anonymous")).status, 404);
    event.visibility = "published";
    const [listed] = await (await call("/api/events", "anonymous")).json();
    assert.match(listed.customThumbnail, /\/api\/events\/95201\/thumbnail/);
    assert.equal((await call(listed.customThumbnail, "anonymous")).status, 200);
    const [profileGallery] = await (await call(`/api/events/creator/${event.creatorId}`, "anonymous")).json();
    assert.match(profileGallery.customThumbnail, /\/api\/events\/95201\/thumbnail/);
    event.visibility = "draft";
  }
});

test("anonymous, strangers, suspended users and owners of other galleries cannot read or save choices", async () => {
  for (const [role, status] of [["anonymous", 401], ["stranger", 403], ["suspended", 403]]) {
    assert.equal((await call(`/api/events/${event.id}/thumbnail-options`, role)).status, status);
    assert.equal((await save({ customThumbnail: reference }, role)).status, status);
  }
  event.creatorId = null;
  assert.equal((await call(`/api/events/${event.id}/thumbnail-options`)).status, 403);
  assert.equal((await save({ customThumbnail: reference })).status, 403);
  assert.equal((await save({ customThumbnail: reference }, "admin")).status, 200);
});

test("foreign photos, videos, premium images and pending, blocked, legacy or stale creator photos are rejected atomically", async () => {
  event.customThumbnail = "/historical/unchanged.png";
  for (const patch of [{ eventId: 2 }, { type: "video" }, { isPremium: true },
    { safetyStatus: "blocked" }, { safetyStatus: "review" }, { safetyStatus: "error" },
    { safetyStatus: "legacy" }, { safetyPolicy: "old" }, { safetyVersion: 1 }]) {
    photos = [{ ...approved, ...patch }];
    assert.deepEqual((await (await call(`/api/events/${event.id}/thumbnail-options`)).json()).photos, []);
    const response = await save({ customThumbnail: reference, title: "Do not save" });
    assert.equal(response.status, 400, JSON.stringify(patch));
    assert.equal(event.customThumbnail, "/historical/unchanged.png");
    assert.equal(event.title, "Gallery");
    assert.equal(writes, 0);
  }
  photos = [{ ...approved }];
  for (const customThumbnail of ["https://example.test/image.jpg", "data:image/png;base64,YmFk",
    "/api/media/files/media-00000000-0000-0000-0000-000000000010.webp",
    "/api/media/legacy/999/thumbnail"]) assert.equal((await save({ customThumbnail })).status, 400);
});

test("historical unchanged values are retained; safe legacy photo references can be newly selected", async () => {
  event.customThumbnail = "https://historical.invalid/old.jpg";
  assert.equal((await save({ customThumbnail: event.customThumbnail })).status, 200);
  photos = [{ ...approved, thumbnail: `data:image/webp;base64,${imageBytes.toString("base64")}` }];
  assert.equal((await save({ customThumbnail: "/api/media/legacy/44/thumbnail" })).status, 200);
  assert.equal(event.customThumbnail, "/api/media/legacy/44/thumbnail");
});

test("paginated gallery-only choices stay bounded; empty, invalid, premium and load failure states are explicit", async () => {
  photos = Array.from({ length: 59 }, (_, i) => ({ ...approved, id: 100 + i }));
  const first = await (await call(`/api/events/${event.id}/thumbnail-options`)).json();
  assert.equal(first.photos.length, 24); assert.equal(first.hasMore, true);
  const last = await (await call(`/api/events/${event.id}/thumbnail-options?page=3`)).json();
  assert.equal(last.photos.length, 11); assert.equal(last.hasMore, false);
  for (const page of ["0", "NaN", "1.5", "100001"]) {
    assert.equal((await call(`/api/events/${event.id}/thumbnail-options?page=${page}`)).status, 400);
  }
  photos = [];
  assert.deepEqual((await (await call(`/api/events/${event.id}/thumbnail-options`)).json()).photos, []);
  event.isPremium = true; photos = [{ ...approved }];
  assert.equal((await save({ customThumbnail: reference }, "admin")).status, 400);
  optionsFail = true;
  assert.equal((await call(`/api/events/${event.id}/thumbnail-options`)).status, 500);
});

test("deleted or newly blocked selected photos cannot be delivered even to managers", async () => {
  event.visibility = "published"; event.customThumbnail = reference;
  for (const role of ["owner", "admin", "anonymous"]) {
    assert.equal((await call(`/api/events/${event.id}/thumbnail`, role)).status, 302);
  }
  for (const replacement of [[], [{ ...approved, safetyStatus: "blocked" }], [{ ...approved, isPremium: true }]]) {
    photos = replacement;
    for (const role of ["owner", "admin", "anonymous"]) {
      assert.equal((await call(`/api/events/${event.id}/thumbnail`, role)).status, 404);
    }
  }
});

test("storage rechecks a concurrent loss of approval before writing, under media row lock", async () => {
  const transaction = db.transaction;
  let locked = false, updated = false;
  db.transaction = async callback => callback({
    select: () => ({ from: table => ({ where: () => ({
      for: async mode => {
        if (mode === "update") return [event];
        locked = mode === "share";
        return [{ ...approved, safetyStatus: "blocked" }];
      },
    }) }) }),
    update: () => { updated = true; throw new Error("must not write"); },
  });
  try {
    await assert.rejects(originals.updateEvent.call(storage, event.id, { customThumbnail: reference }), /no longer eligible/);
    assert.equal(locked, true); assert.equal(updated, false);
  } finally { db.transaction = transaction; }
});

test("database choice query filters before pagination and never loads original or inline image payloads", async () => {
  const select = db.select;
  let query;
  db.select = (...args) => {
    const builder = select.call(db, ...args);
    const from = builder.from;
    builder.from = (...args) => {
      query = from.apply(builder, args);
      query.then = resolve => Promise.resolve([]).then(resolve);
      return query;
    };
    return builder;
  };
  try {
    await originals.getEventThumbnailOptions.call(storage, event, 3);
    const { sql, params } = query.toSQL();
    assert.match(sql, /case when .*thumbnail.*like 'data:%'/s);
    assert.match(sql, /''.*from "media_items"/s);
    assert.match(sql, /"content_version" = "media_items"."safety_version"/);
    assert.ok(params.includes(event.id));
    assert.ok(params.includes("approved")); assert.ok(!params.includes("legacy"));
    assert.ok(params.includes(SAFETY_POLICY));
    assert.equal(params.at(-2), 25); assert.equal(params.at(-1), 48);
    event.creatorId = null;
    await originals.getEventThumbnailOptions.call(storage, event, 1);
    assert.ok(query.toSQL().params.includes("legacy"));
  } finally { db.select = select; }
});
