import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db.ts";
import { users, events, creatorEventAssociations, mediaItems } from "../shared/schema.ts";
import { storage } from "../server/storage.ts";
import { registerRoutes } from "../server/routes.ts";
import { creatorUsage, SAFETY_POLICY } from "../server/beta-policy.ts";

const token = randomUUID(), accounts = [], galleries = [];
let server, base, a, b, admin, official, other, ga, gb, photo;
async function request(path, method = "GET", user = a, body) {
  return fetch(base + path, { method, headers: {
    ...(user ? { "x-test-user": String(user.id) } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
  }, body: body ? JSON.stringify(body) : undefined });
}
const link = (id, target, user = a) =>
  request(`/api/creator/events/${id}/official-event`, "PUT", user, { officialEventId: target });
const publicList = async (target = official.id, user = null) =>
  (await request(`/api/events/${target}/community-galleries`, "GET", user)).json();
async function album(owner, title) {
  const row = await storage.createEvent({ title: `${title}-${token}`, description: "Synthetic association test",
    date: new Date("2026-10-10"), ...(owner ? { creatorId: owner.id } : {}) });
  galleries.push(row.id);
  return row;
}
test.before(async () => {
  for (let i = 0; i < 3; i++) {
    const [user] = await db.insert(users).values({ username: `assoc-${token}-${i}`,
      email: `${token}-${i}@example.test`, password: "synthetic-unused",
      isCreator: true, creatorStatus: "approved", isAdmin: i === 2 }).returning();
    accounts.push(user);
  }
  [a, b, admin] = accounts;
  official = await album(null, "Official"); other = await album(null, "Other official");
  ga = await album(a, "First creator"); gb = await album(b, "Second creator");
  for (const gallery of [ga, gb]) await db.update(events).set({ visibility: "published", safetyStatus: "legacy" })
    .where(eq(events.id, gallery.id));
  photo = await storage.createMediaItem({ eventId: ga.id, type: "image",
    url: "data:image/png;base64,aGVsbG8=", thumbnail: "data:image/png;base64,aGVsbG8=",
    tags: [], caption: "Synthetic" });
  await db.update(mediaItems).set({ safetyStatus: "legacy" }).where(eq(mediaItems.id, photo.id));
  const app = express(); app.use(express.json());
  app.use(async (req, _res, next) => {
    req.user = accounts.some(u => u.id === Number(req.headers["x-test-user"]))
      ? await storage.getUser(Number(req.headers["x-test-user"])) : undefined;
    req.isAuthenticated = () => !!req.user; next();
  });
  server = await registerRoutes(app, { workers: false });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) { server.close(); await once(server, "close"); }
  for (const id of galleries) await storage.deleteEvent(id);
  for (const user of accounts) await db.delete(users).where(eq(users.id, user.id));
  await pool.end();
});

test("existing IDs remain unlinked; multiple creators link, change and remove independently", async () => {
  assert.deepEqual(await publicList(), []);
  const before = await storage.getEvent(ga.id), usage = await creatorUsage(db, a.id);
  assert.equal((await link(ga.id, official.id)).status, 200);
  assert.equal((await link(gb.id, official.id, b)).status, 200);
  const list = await publicList();
  assert.deepEqual(new Set(list.map(row => row.id)), new Set([ga.id, gb.id]));
  assert.ok(list.every(row => Object.keys(row).sort().join(",") === "creatorId,creatorName,date,id,title"));
  assert.deepEqual(await storage.getEvent(ga.id), before, "linking must not change gallery/safety/publication");
  assert.deepEqual(await creatorUsage(db, a.id), usage);
  assert.equal((await link(ga.id, other.id)).status, 200);
  assert.deepEqual((await publicList()).map(g => g.id), [gb.id]);
  assert.deepEqual((await publicList(other.id)).map(g => g.id), [ga.id]);
  assert.equal((await link(ga.id, null)).status, 200);
  assert.deepEqual(await publicList(other.id), []);
  assert.equal((await storage.getMediaItem(photo.id)).eventId, ga.id);
});

test("authentication, ownership including admins, invalid targets and payloads fail closed", async () => {
  assert.equal((await link(ga.id, official.id, null)).status, 401);
  for (const user of [b, admin]) {
    assert.equal((await link(ga.id, official.id, user)).status, 404);
    assert.equal((await link(ga.id, null, user)).status, 404);
  }
  assert.equal((await link(official.id, other.id)).status, 404);
  for (const target of [ga.id, gb.id, 2147483647]) assert.equal((await link(ga.id, target)).status, 404);
  for (const body of [{}, { officialEventId: "1" }, { officialEventId: -1 }, { officialEventId: 1.2 },
    { officialEventId: official.id, creatorId: b.id }]) {
    assert.equal((await request(`/api/creator/events/${ga.id}/official-event`, "PUT", a, body)).status, 400);
  }
  assert.equal((await request("/api/creator/official-events", "GET", null)).status, 401);
  assert.equal((await request("/api/creator/event-associations", "GET", null)).status, 401);
  assert.equal((await request("/api/events/not-an-id/community-galleries")).status, 404);
  await db.update(users).set({ suspended: true }).where(eq(users.id, a.id));
  assert.equal((await link(ga.id, official.id)).status, 403);
  await db.update(users).set({ suspended: false }).where(eq(users.id, a.id));
});

test("target visibility/safety changes redact private link IDs and suppress public listings", async () => {
  await link(ga.id, official.id);
  for (const patch of [{ adminHidden: true }, { visibility: "draft" }, { visibility: "private" },
    { isPremium: true }, { safetyStatus: "blocked" }, { safetyStatus: "review" },
    { safetyStatus: "error" }, { safetyStatus: "approved", safetyPolicy: SAFETY_POLICY, contentVersion: 2, safetyVersion: 1 }]) {
    await db.update(events).set(patch).where(eq(events.id, official.id));
    assert.equal((await link(gb.id, official.id, b)).status, 404);
    assert.equal((await request(`/api/events/${official.id}/community-galleries`, "GET", admin)).status, 404);
    const targets = await (await request("/api/creator/official-events", "GET", admin)).json();
    assert.ok(!targets.some(row => row.id === official.id));
    const associations = await (await request("/api/creator/event-associations")).json();
    assert.deepEqual(associations, [{ galleryId: ga.id, officialEventId: null, unavailable: true }]);
    await db.update(events).set({ adminHidden: false, visibility: "published", isPremium: false,
      safetyStatus: "legacy", safetyPolicy: null, contentVersion: 0, safetyVersion: 0 }).where(eq(events.id, official.id));
  }
  assert.deepEqual(await (await request("/api/creator/event-associations", "GET", b)).json(),
    [{ galleryId: gb.id, officialEventId: official.id, unavailable: false }]);
  await db.update(events).set({ adminHidden: true }).where(eq(events.id, official.id));
  assert.equal((await link(ga.id, null)).status, 200, "unavailable links can still be removed");
  await db.update(events).set({ adminHidden: false }).where(eq(events.id, official.id));
});

test("private, hidden, premium, unsafe and suspended/rejected creator galleries never appear, even to managers", async () => {
  await link(ga.id, official.id);
  for (const patch of [{ visibility: "draft" }, { visibility: "private" }, { adminHidden: true },
    { isPremium: true }, { safetyStatus: "blocked" }, { safetyStatus: "review" }, { safetyStatus: "error" },
    { safetyStatus: "approved", safetyPolicy: SAFETY_POLICY, contentVersion: 2, safetyVersion: 1 }]) {
    await db.update(events).set(patch).where(eq(events.id, ga.id));
    for (const user of [null, a, admin]) assert.ok(!(await publicList(official.id, user)).some(row => row.id === ga.id));
    await db.update(events).set({ visibility: "published", adminHidden: false, isPremium: false,
      safetyStatus: "legacy", safetyPolicy: null, contentVersion: 0, safetyVersion: 0 }).where(eq(events.id, ga.id));
  }
  for (const patch of [{ suspended: true }, { creatorStatus: "rejected" }]) {
    await db.update(users).set(patch).where(eq(users.id, a.id));
    assert.ok(!(await publicList()).some(row => row.id === ga.id));
    await db.update(users).set({ suspended: false, creatorStatus: "approved" }).where(eq(users.id, a.id));
  }
  assert.ok((await publicList()).some(row => row.id === ga.id));
});

test("current approved safety requires verified owner and configured verification; stale policy remains private", async () => {
  // Entirely synthetic configuration: no mail/provider calls, existing secrets
  // are neither read nor replaced. Only nonsecret configuration is temporary.
  const from = process.env.RESEND_FROM, site = process.env.PUBLIC_SITE_URL;
  const { verificationConfigured } = await import("../server/beta-config.ts");
  try {
    process.env.RESEND_FROM = "fixture@example.test";
    process.env.PUBLIC_SITE_URL = "https://fixture.example.test";
    await db.update(events).set({ safetyStatus: "approved", safetyPolicy: SAFETY_POLICY,
      contentVersion: 1, safetyVersion: 1 }).where(eq(events.id, ga.id));
    assert.ok(!(await publicList()).some(row => row.id === ga.id), "unverified owners are private");
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, a.id));
    assert.equal((await publicList()).some(row => row.id === ga.id), verificationConfigured());
    process.env.RESEND_FROM = "";
    assert.ok(!(await publicList()).some(row => row.id === ga.id), "unconfigured verification fails closed");
    process.env.RESEND_FROM = "fixture@example.test";
    await db.update(events).set({ safetyPolicy: "old-policy" }).where(eq(events.id, ga.id));
    assert.ok(!(await publicList()).some(row => row.id === ga.id));
  } finally {
    if (from === undefined) delete process.env.RESEND_FROM; else process.env.RESEND_FROM = from;
    if (site === undefined) delete process.env.PUBLIC_SITE_URL; else process.env.PUBLIC_SITE_URL = site;
    await db.update(events).set({ safetyStatus: "legacy", safetyPolicy: null,
      contentVersion: 0, safetyVersion: 0 }).where(eq(events.id, ga.id));
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, a.id));
  }
});

test("gallery and photo likes/favorites retain their IDs and never aggregate onto official targets", async () => {
  for (const path of [`/api/community/event/${ga.id}`, `/api/community/media/${photo.id}`]) {
    assert.equal((await request(path + "/like", "PUT")).status, 200);
    assert.equal((await request(path + "/favorite", "PUT")).status, 200);
    assert.deepEqual(await (await request(path)).json(), { count: 1, liked: true, saved: true });
  }
  await link(ga.id, other.id);
  for (const target of [official, other]) assert.deepEqual(
    await (await request(`/api/community/event/${target.id}`)).json(), { count: 0, liked: false, saved: false });
  const favorites = await (await request("/api/account/favorites")).json();
  assert.equal(favorites.items.length, 2);
  assert.deepEqual(await (await request(`/api/community/event/${ga.id}`)).json(), { count: 1, liked: true, saved: true });
  assert.equal((await storage.getMediaItem(photo.id)).eventId, ga.id);
});

test("linked galleries still consume their owner's quota; deleting target only removes links", async () => {
  for (let i = 0; i < 4; i++) {
    const g = await album(a, `Quota gallery ${i}`);
    assert.equal((await link(g.id, other.id)).status, 200);
  }
  assert.equal((await creatorUsage(db, a.id)).galleries, 5);
  await assert.rejects(album(a, "Over quota"), /maximum of 5 galleries/);
  assert.equal((await creatorUsage(db, b.id)).galleries, 1);
  const before = await storage.getEvent(ga.id);
  assert.equal((await storage.deleteEvent(other.id)).success, true);
  assert.deepEqual(await storage.getEvent(ga.id), before);
  assert.ok(await storage.getMediaItem(photo.id));
  assert.deepEqual(await db.select().from(creatorEventAssociations).where(eq(creatorEventAssociations.officialEventId, other.id)), []);
  assert.deepEqual(await (await request(`/api/community/event/${ga.id}`)).json(), { count: 1, liked: true, saved: true });
  assert.equal((await (await request("/api/account/favorites")).json()).items.length, 2);
});
