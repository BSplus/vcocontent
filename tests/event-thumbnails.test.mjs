import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { once } from "node:events";

// Synthetic configuration only; no provider, database or storage writes.
process.env.RESEND_API_KEY = "synthetic-mail-key";
process.env.RESEND_FROM = "verify@example.test";
process.env.PUBLIC_SITE_URL = "https://example.test";
const { storage } = await import("../server/storage.ts");
const { pool } = await import("../server/db.ts");
const { SAFETY_POLICY } = await import("../server/beta-policy.ts");
const { registerRoutes } = await import("../server/routes.ts");
const { inlineEventThumbnail, publicEventThumbnails } = await import("../server/event-thumbnails.ts");
const original = {};
const fixture = { id: 95001, title: "Empty event with chosen photo", description: "Fixture",
  date: new Date(), createdAt: new Date(), creatorId: null, seriesId: null, adminHidden: false,
  isPremium: false, visibility: "published", safetyStatus: "legacy", contentVersion: 0, safetyVersion: 0 };
let event, owner, media, server, base;
const call = (url, options = {}) => fetch(`${base}${url}`, { redirect: "manual", ...options });
test.before(async () => {
  const image = await sharp({ create: { width: 1800, height: 1200, channels: 3,
    background: "#fe315b" } }).jpeg().toBuffer();
  event = { ...fixture, customThumbnail: `data:image/jpeg;base64,${image.toString("base64")}`,
    coverImage: "/attached_assets/%2389_3.png" };
  for (const [name, fn] of Object.entries({
    getEvents: async () => [event],
    getEvent: async id => id === event.id ? event : undefined,
    getUser: async () => owner,
    findMediaByKey: async () => media,
    getMediaItem: async () => media,
    getPublicEventMediaItems: async () => [],
  })) { original[name] = storage[name]; storage[name] = fn; }
  const app = express();
  server = await registerRoutes(app, { workers: false });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  Object.assign(storage, original);
  await new Promise(resolve => server.close(resolve));
  storage.sessionStore.close();
  await pool.end();
});

test("real event list keeps a small, lazy chosen-image reference for an empty gallery", async () => {
  const response = await call("/api/events");
  const text = await response.text();
  assert.ok(text.length < 1500);
  assert.ok(!text.includes("base64"));
  const [listed] = JSON.parse(text);
  assert.match(listed.customThumbnail, /^\/api\/events\/95001\/thumbnail\?field=customThumbnail&v=/);
  assert.equal(listed.coverImage, event.coverImage);
  assert.deepEqual(await (await call(`/api/events/${event.id}/media`)).json(), []);
  const preview = await call(listed.customThumbnail);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("cache-control"), "private, no-store");
  assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
  assert.match(preview.headers.get("content-type"), /^image\/webp/);
  const bytes = Buffer.from(await preview.arrayBuffer());
  assert.ok(bytes.length < 100 * 1024);
  const info = await sharp(bytes).metadata();
  assert.ok(info.width <= 640 && info.height <= 640);
  const oldReference = listed.customThumbnail;
  const oldSource = event.customThumbnail;
  const changed = await sharp({ create: { width: 100, height: 100, channels: 3,
    background: "#0044ff" } }).png().toBuffer();
  event.customThumbnail = `data:image/png;base64,${changed.toString("base64")}`;
  assert.notEqual(publicEventThumbnails(event).customThumbnail, oldReference);
  // An old URL still re-authorizes and returns current content, never cached old source.
  const current = Buffer.from(await (await call(oldReference)).arrayBuffer());
  assert.notDeepEqual(current, bytes);
  event.customThumbnail = oldSource;
});

test("cover images also use thin references; unsafe URLs and payloads cannot escape into lists", async () => {
  for (const value of ["https://remote.invalid/photo.jpg", "//remote.invalid/x.png",
    "/api/media/files/media-00000000-0000-0000-0000-000000000000.webp",
    "/attached_assets/%2f..%2fprivate.png", "data:image/svg+xml;base64,PHN2Zz4="]) {
    assert.equal(publicEventThumbnails({ ...event, customThumbnail: value, coverImage: value }).customThumbnail, null);
    assert.equal(publicEventThumbnails({ ...event, customThumbnail: value, coverImage: value }).coverImage, null);
  }
  assert.match(publicEventThumbnails({ ...event, coverImage: event.customThumbnail }).coverImage, /field=coverImage/);
  const previous = event;
  try {
    event = { ...event, customThumbnail: "data:image/jpeg;base64,YmFk" };
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
    event = { ...event, customThumbnail: `data:image/png;base64,${previous.customThumbnail.split(",")[1]}` };
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
  } finally { event = previous; }
  await assert.rejects(() => inlineEventThumbnail("data:image/jpeg;base64," + "A".repeat(30 * 1048576)));
});

test("hidden and premium events stay protected even after successful cached delivery", async () => {
  for (const field of ["adminHidden", "isPremium"]) {
    event[field] = true;
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
    if (field === "adminHidden") assert.deepEqual(await (await call("/api/events")).json(), []);
    else assert.equal(publicEventThumbnails(event).customThumbnail, null);
    event[field] = false;
  }
  for (const path of ["/api/events/0/thumbnail", "/api/events/no/thumbnail",
    "/api/events/95002/thumbnail", `/api/events/${event.id}/thumbnail?field=url`,
    `/api/events/${event.id}/thumbnail?field=customThumbnail&field=coverImage`])
    assert.equal((await call(path)).status, 404);
});

test("managed and historical photo URLs resolve only to public, non-premium photos in the same event", async () => {
  const previous = event;
  const key = "thumb-00000000-0000-0000-0000-000000000000.webp";
  try {
    event = { ...event, customThumbnail: `/api/media/files/${key}`, coverImage: null };
    media = { id: 42, eventId: event.id, type: "image", isPremium: false,
      safetyStatus: "legacy", contentVersion: 0, safetyVersion: 0 };
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).headers.get("location"), event.customThumbnail);
    media.eventId++;
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
    media.eventId = event.id; media.isPremium = true;
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
    media.isPremium = false; media.type = "video";
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
    media.type = "image";
    event.customThumbnail = "/api/media/legacy/42/thumbnail";
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).headers.get("location"), event.customThumbnail);
    media = undefined;
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
  } finally { event = previous; }
});

test("creator covers require independent public media approval and current owner/event safety", async () => {
  const previous = event;
  try {
    owner = { id: 95, suspended: false, creatorStatus: "approved", emailVerifiedAt: new Date() };
    event = { ...event, creatorId: owner.id, safetyStatus: "approved", safetyPolicy: SAFETY_POLICY };
    // Historical inline images are not an independent approval for a creator cover.
    assert.equal(publicEventThumbnails(event).customThumbnail, null);
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
    event.customThumbnail = "/api/media/files/thumb-00000000-0000-0000-0000-000000000000.webp";
    media = { id: 42, eventId: event.id, type: "image", isPremium: false,
      safetyStatus: "approved", safetyPolicy: SAFETY_POLICY, contentVersion: 0, safetyVersion: 0 };
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 302);
    for (const change of [{ safetyStatus: "error" }, { safetyStatus: "review" },
      { contentVersion: 1 }, { safetyPolicy: "outdated" }]) {
      const saved = media; media = { ...media, ...change };
      assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404); media = saved;
    }
    owner.suspended = true;
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
    owner.suspended = false; owner.creatorStatus = "rejected";
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
    owner.creatorStatus = "approved"; event.visibility = "draft";
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
    event.visibility = "published"; event.contentVersion = 1;
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
  } finally { event = previous; media = undefined; owner = undefined; }
});
