import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { Client } from "@replit/object-storage";
import { Readable } from "node:stream";
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
const { registerRequestParsers } = await import("../server/request-parsers.ts");
const original = {};
const fixture = { id: 95001, title: "Empty event with chosen photo", description: "Fixture",
  date: new Date(), createdAt: new Date(), creatorId: null, seriesId: null, adminHidden: false,
  isPremium: false, visibility: "published", safetyStatus: "legacy", contentVersion: 0, safetyVersion: 0 };
let event, owner, media, server, base, writes = 0;
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
    createEvent: async data => { writes++; return { ...fixture, ...data }; },
    updateEvent: async (_id, data) => { writes++; event = { ...event, ...data }; return event; },
  })) { original[name] = storage[name]; storage[name] = fn; }
  const app = express();
  registerRequestParsers(app);
  app.use((req, _res, next) => {
    if (req.headers["x-fixture-admin"]) req.user = { id: 99999, isAdmin: true };
    req.isAuthenticated = () => !!req.user;
    next();
  });
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
      thumbnail: event.customThumbnail, safetyStatus: "legacy", contentVersion: 0, safetyVersion: 0 };
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).headers.get("location"), event.customThumbnail);
    media.eventId++;
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
    media.eventId = event.id; media.isPremium = true;
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
    media.isPremium = false; media.type = "video";
    assert.equal((await call(`/api/events/${event.id}/thumbnail`)).status, 404);
    media.type = "image";
    event.customThumbnail = "/api/media/legacy/42/thumbnail";
    media.thumbnail = "data:image/png;base64,YmFk";
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
      thumbnail: event.customThumbnail, safetyStatus: "approved", safetyPolicy: SAFETY_POLICY, contentVersion: 0, safetyVersion: 0 };
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

const save = async (method, data) => {
  const response = await call(method === "POST" ? "/api/events" : `/api/events/${event.id}`, {
    method, headers: { "Content-Type": "application/json", "x-fixture-admin": "1" },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
};

test("official creation and editing decode supported images in both fields before any write", async () => {
  const previous = event;
  try {
    for (const format of ["jpeg", "png", "webp", "gif"]) {
      const bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: "#aa3355" } })
        .toFormat(format).toBuffer();
      const image = `data:image/${format};base64,${bytes.toString("base64")}`;
      for (const method of ["POST", "PUT"]) for (const field of ["customThumbnail", "coverImage"]) {
        const before = writes;
        const result = await save(method, { title: "Validated fixture", description: "Fixture",
          date: new Date().toISOString(), [field]: image });
        assert.equal(result.status, method === "POST" ? 201 : 200, JSON.stringify(result));
        assert.equal(writes, before + 1);
        assert.equal(result.body[field], image);
      }
    }
    assert.equal((await save("POST", { title: "Preset", description: "Fixture", date: new Date(),
      coverImage: "/attached_assets/%2389_3.png" })).status, 201);
  } finally { event = previous; }
});

test("invalid new official images reject the entire create/edit, preserving old images and text", async () => {
  const good = Buffer.from(event.customThumbnail.split(",")[1], "base64");
  const oversizedPixels = await sharp({ create: { width: 6400, height: 6400, channels: 3, background: "#fff" } })
    .png().toBuffer();
  const cases = [
    ["data:image/svg+xml;base64,PHN2Zz4=", /JPEG, PNG, WebP or GIF/],
    ["data:image/jpeg;base64,YmFk", /damaged/],
    [`data:image/png;base64,${good.toString("base64")}`, /match/],
    [`data:image/jpeg;base64,${good.subarray(0, good.length - 100).toString("base64")}`, /damaged/],
    [`data:image/png;base64,${oversizedPixels.toString("base64")}`, /40 megapixels/],
    [`data:image/png;base64,${Buffer.alloc(1048577).toString("base64")}`, /1 MiB/],
    ["https://example.test/photo.jpg", /External URLs/],
    ["//example.test/photo.jpg", /External URLs/],
    ["/attached_assets/another.png", /External URLs/],
    ["/api/media/files/media-00000000-0000-0000-0000-000000000000.webp", /original files/],
    ["/api/media/files/thumb-00000000-0000-0000-0000-000000000000.webp", /other events/],
  ];
  media = { eventId: event.id + 1, type: "image", isPremium: false, safetyStatus: "legacy" };
  try {
    for (const method of ["POST", "PUT"]) for (const field of ["customThumbnail", "coverImage"])
      for (const [value, message] of cases) {
        const before = writes, previous = { ...event };
        const result = await save(method, { title: "Must not save", description: "Fixture",
          date: new Date(), [field]: value });
        assert.equal(result.status, 400, `${method} ${field}: ${value.slice(0, 70)}`);
        assert.match(result.body.error, message);
        assert.match(result.body.error, field === "coverImage" ? /Cover image/ : /Event thumbnail/);
        assert.equal(writes, before);
        assert.deepEqual(event, previous);
      }
  } finally { media = undefined; }
});

test("historical unchanged official images are not revalidated, while changed fields are", async () => {
  const previous = event;
  try {
    event = { ...event, customThumbnail: "historical-invalid-but-unchanged", coverImage: "https://old.invalid/image.png" };
    assert.equal((await save("PUT", { title: "Text-only edit" })).status, 200);
    assert.equal((await save("PUT", { customThumbnail: event.customThumbnail, coverImage: event.coverImage })).status, 200);
    const before = writes;
    assert.equal((await save("PUT", { coverImage: "https://new.invalid/image.png" })).status, 400);
    assert.equal(writes, before);
    assert.equal((await save("PUT", { customThumbnail: "", coverImage: "" })).status, 200);
  } finally { event = previous; }
});

test("requests exceeding the event JSON budget explain the image limit without any write", async () => {
  for (const method of ["POST", "PUT"]) {
    const before = writes;
    const result = await save(method, { customThumbnail: "A".repeat(3 * 1048576) });
    assert.equal(result.status, 413);
    assert.match(result.body.error, /Each thumbnail or cover image must not exceed 1 MiB/);
    assert.equal(writes, before);
  }
});

test("new official legacy thumbnail selections require same-event public real image content", async () => {
  const previous = event;
  try {
    media = { id: 42, eventId: event.id, type: "image", isPremium: false,
      safetyStatus: "legacy", thumbnail: event.customThumbnail };
    const url = "/api/media/legacy/42/thumbnail";
    assert.equal((await save("PUT", { customThumbnail: url })).status, 200);
    for (const change of [{ isPremium: true }, { type: "video" }, { eventId: event.id + 1 },
      { thumbnail: "data:image/jpeg;base64,YmFk" }]) {
      event = previous;
      const before = writes, saved = media; media = { ...media, ...change };
      assert.equal((await save("PUT", { customThumbnail: url })).status, 400);
      assert.equal(writes, before); media = saved;
    }
  } finally { event = previous; media = undefined; }
});

test("same-event stored thumbnails are decoded with bounded reads, and originals/foreign files never open", async () => {
  const previous = event, originalRead = Client.prototype.downloadAsStream;
  const key = "thumb-00000000-0000-0000-0000-000000000000.webp";
  const url = `/api/media/files/${key}`;
  let opens = 0;
  let source = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#aabbcc" } }).webp().toBuffer();
  Client.prototype.downloadAsStream = () => { opens++; return Readable.from([source]); };
  try {
    media = { id: 42, eventId: event.id, type: "image", isPremium: false, thumbnail: url,
      safetyStatus: "legacy", contentVersion: 0, safetyVersion: 0 };
    assert.equal((await save("PUT", { customThumbnail: url })).status, 200);
    assert.equal(opens, 1);
    for (const input of [Buffer.from("damaged"), Buffer.alloc(1048577)]) {
      event = previous; source = input;
      const before = writes;
      assert.equal((await save("PUT", { customThumbnail: url })).status, 400);
      assert.equal(writes, before);
    }
    event = previous; media.eventId++;
    const before = opens;
    assert.equal((await save("PUT", { customThumbnail: url })).status, 400);
    assert.equal((await save("PUT", { coverImage: url.replace("thumb-", "media-") })).status, 400);
    assert.equal(opens, before);
  } finally { Client.prototype.downloadAsStream = originalRead; event = previous; media = undefined; }
});

test("two images at the 1 MiB boundary can be saved together; animated frame pixel counts are bounded", async () => {
  const previous = event;
  try {
    const jpeg = Buffer.from(event.customThumbnail.split(",")[1], "base64");
    const image = `data:image/jpeg;base64,${Buffer.concat([jpeg, Buffer.alloc(1048576 - jpeg.length)]).toString("base64")}`;
    for (const method of ["POST", "PUT"]) {
      const result = await save(method, { title: "Boundary fixture", description: "Fixture", date: new Date(),
        customThumbnail: image, coverImage: image });
      assert.equal(result.status, method === "POST" ? 201 : 200, JSON.stringify(result.body));
    }
    // Duplicate frames may be optimized away; use two different colors.
    const input = Buffer.alloc(4500 * 9000 * 3);
    input.fill(255, 4500 * 4500 * 3);
    const twoFrames = await sharp(input, { raw: { width: 4500, height: 9000, channels: 3, pageHeight: 4500 } }).gif().toBuffer();
    assert.equal((await sharp(twoFrames, { animated: true }).metadata()).pages, 2);
    assert.ok(twoFrames.length < 1048576);
    for (const method of ["POST", "PUT"]) {
      const before = writes;
      const result = await save(method, { title: "Animated fixture", description: "Fixture", date: new Date(),
        coverImage: `data:image/gif;base64,${twoFrames.toString("base64")}` });
      assert.equal(result.status, 400);
      assert.match(result.body.error, /40 megapixels/);
      assert.equal(writes, before);
    }
  } finally { event = previous; }
});
