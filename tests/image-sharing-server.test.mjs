import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { storage } from "../server/storage.ts";
import { pool } from "../server/db.ts";
import { searchData } from "../server/public-search-data.ts";
import { registerSharingRoutes } from "../server/sharing.ts";
import { eventSharingImage } from "../server/sharing-selection.ts";
import { registerEventThumbnailRoute } from "../server/event-thumbnails.ts";
import { seoHtml } from "../server/seo.ts";
import { SOCIAL_IMAGE } from "../shared/site-metadata.ts";
import { Client } from "@replit/object-storage";
import { Readable } from "node:stream";

let event, item, previews, root, server;
const original = { getEvent: storage.getEvent, getMediaItem: storage.getMediaItem, findMediaByKey: storage.findMediaByKey,
  getUser: storage.getUser, images: searchData.images };
const source = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#0044ff" } }).png().toBuffer();
test.before(async () => {
  storage.getEvent = async id => id === event.id ? event : undefined;
  storage.getMediaItem = async id => id === item.id ? item : undefined;
  storage.findMediaByKey = async () => item;
  storage.getUser = async () => ({ id: 4, isCreator: true, creatorStatus: "approved" });
  searchData.images = async () => previews;
  const app = express();
  app.use((req, _res, next) => { if (req.headers["x-admin"]) req.user = { id: 1, isAdmin: true }; next(); });
  registerSharingRoutes(app); registerEventThumbnailRoute(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  root = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => {
  event = { id: 8, title: "Gallery", isPremium: false, creatorId: null, date: "2020-01-01" };
  item = { id: 300, eventId: 8, type: "image", caption: "Chosen photo", photographer: "Photo Crew",
    thumbnail: `data:image/png;base64,${source.toString("base64")}`, isPremium: false, safetyStatus: "legacy" };
  previews = [];
});
test.after(async () => {
  Object.assign(storage, { getEvent: original.getEvent, getMediaItem: original.getMediaItem,
    findMediaByKey: original.findMediaByKey, getUser: original.getUser });
  searchData.images = original.images;
  await new Promise(resolve => server.close(resolve));
  storage.sessionStore.close(); await pool.end();
});
const get = (path, options) => fetch(root + path, options);
const descriptor = async (kind = "event", id = 8) => (await get(`/api/sharing/${kind}/${id}`)).json();

test("chosen historical thumbnail outside the first page wins; native and SEO use the identical public image", async () => {
  event.customThumbnail = "/api/media/legacy/300/thumbnail";
  previews = [{ ...item, id: 10 }];
  const selected = await descriptor();
  assert.match(selected.image, /^\/api\/events\/8\/thumbnail\?.*&direct=1&public=1$/);
  assert.equal(selected.credit, "Photo by Photo Crew");
  assert.equal(selected.mime, "image/webp");
  const response = await get(selected.image);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^image\/webp/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal((await sharp(bytes).metadata()).format, "webp");
  const before = process.env.PUBLIC_SITE_URL;
  try {
    process.env.PUBLIC_SITE_URL = "https://public.example.test";
    const { html } = await seoHtml({ originalUrl: "/events/8" }, "<head></head>");
    assert.ok(html.includes(`content="https://public.example.test${selected.image.replaceAll("&", "&amp;")}"`));
    assert.match(html, /og:image:type" content="image\/webp"/);
  } finally {
    if (before === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = before;
  }
});

test("cover, public media and branded fallbacks; external and original sources never selected", async () => {
  event.customThumbnail = "https://external.invalid/private.jpg";
  event.coverImage = "/api/media/legacy/300/thumbnail";
  assert.match((await descriptor()).image, /field=coverImage/);
  event.coverImage = "/original.jpg"; previews = [item];
  assert.equal((await descriptor()).image, "/api/sharing/media/300/image");
  item.isPremium = true;
  assert.equal((await descriptor()).image, SOCIAL_IMAGE);
  assert.equal((await get("/api/sharing/media/300")).status, 404);
  previews = [];
  assert.equal((await eventSharingImage(event)).image, SOCIAL_IMAGE);
});

test("public inline official image and video poster use bounded WebP, with existing credits only", async () => {
  event.customThumbnail = item.thumbnail;
  let selected = await descriptor();
  assert.equal((await get(selected.image)).status, 200);
  assert.equal(selected.credit, undefined);
  item.type = "video"; item.photographer = "Video Crew";
  selected = await descriptor("media", 300);
  assert.equal(selected.credit, "Video by Video Crew");
  const response = await get(selected.image);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^image\/webp/);
  item.photographer = null;
  assert.equal((await descriptor("media", 300)).credit, undefined);
});

test("prepared photo and video posters are byte-identical; no original file is opened", async () => {
  const originalRead = Client.prototype.downloadAsStream;
  const source = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#ff0000" } }).webp().toBuffer();
  const opened = [];
  Client.prototype.downloadAsStream = key => { opened.push(key); return Readable.from([source]); };
  try {
    item.thumbnail = "/api/media/files/thumb-12345678-1234-1234-1234-123456789abc.webp";
    for (const type of ["image", "video"]) {
      item.type = type;
      const selected = await descriptor("media", 300);
      const response = await get(selected.image);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/webp");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), source);
    }
    assert.equal(opened.length, 2);
    assert.ok(opened.every(key => key.endsWith("thumb-12345678-1234-1234-1234-123456789abc.webp")));
    item.type = "image"; event.customThumbnail = item.thumbnail;
    const selected = await descriptor();
    assert.match(selected.image, /field=customThumbnail/);
    assert.deepEqual(Buffer.from(await (await get(selected.image)).arrayBuffer()), source);
  } finally { Client.prototype.downloadAsStream = originalRead; }
});

test("cached images recheck withdrawal, premium, archive and safety even for an admin session", async () => {
  event.customThumbnail = "/api/media/legacy/300/thumbnail";
  const selected = await descriptor();
  assert.equal((await get(selected.image)).status, 200);
  for (const changes of [{ isPremium: true }, { safetyStatus: "review" }, { archivedAt: new Date() },
    { safetyStatus: "approved", contentVersion: 2, safetyVersion: 1 }]) {
    const saved = { ...item }; Object.assign(item, changes);
    assert.equal((await get(selected.image, { headers: { "x-admin": "1" } })).status, 404);
    assert.equal((await get("/api/sharing/media/300/image", { headers: { "x-admin": "1" } })).status, 404);
    assert.equal((await descriptor()).image, SOCIAL_IMAGE);
    item = saved;
  }
  for (const changes of [{ adminHidden: true }, { isPremium: true },
    { creatorId: 4, visibility: "draft", safetyStatus: "legacy" }]) {
    const saved = { ...event }; Object.assign(event, changes);
    assert.equal((await get(selected.image, { headers: { "x-admin": "1" } })).status, 404);
    assert.equal((await get("/api/sharing/event/8", { headers: { "x-admin": "1" } })).status, 404);
    event = saved;
  }
});

test("invalid IDs and nonpublic media fail without exposing descriptor data", async () => {
  for (const route of ["/api/sharing/event/0", "/api/sharing/event/2147483648", "/api/sharing/profile/8", "/api/sharing/media/999"]) {
    assert.equal((await get(route)).status, 404);
  }
});
