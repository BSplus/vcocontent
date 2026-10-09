import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import { users, events, mediaItems } from "../shared/schema.ts";
import { eq } from "drizzle-orm";

test("historical Base64 media is lazy-loaded and private originals remain protected", async () => {
  const id = randomUUID();
  const [user] = await db.insert(users).values({
    username: `legacy_${id}`, email: `legacy_${id}@example.invalid`, password: "test-not-a-login",
  }).returning();
  const [event] = await db.insert(events).values({
    title: "Temporary legacy test", description: "No migration", date: new Date(), creatorId: user.id,
  }).returning();
  const [publicEvent] = await db.insert(events).values({
    title: "Temporary public featured test", description: "No migration", date: new Date(), creatorId: null,
  }).returning();
  let item;
  let publicItem;
  try {
    const jpeg = await sharp({ create: { width: 900, height: 600, channels: 3, background: "blue" } })
      .jpeg().toBuffer();
    const data = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    [item] = await db.insert(mediaItems).values({
      type: "image", eventId: event.id, url: data, thumbnail: data, downloadCount: 2147483646,
    }).returning();
    [publicItem] = await db.insert(mediaItems).values({
      type: "image", eventId: publicEvent.id, url: data, thumbnail: data, downloadCount: 2147483646,
    }).returning();
    const listed = await storage.getMediaItems(event.id);
    assert.equal(listed[0].url, `/api/media/legacy/${item.id}/file`);
    assert.equal(listed[0].thumbnail, `/api/media/legacy/${item.id}/thumbnail`);
    const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5000";
    const preview = await fetch(`${base}${listed[0].thumbnail}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("content-type"), "image/webp");
    assert.ok((await preview.arrayBuffer()).byteLength < 100 * 1024);
    const original = await fetch(`${base}${listed[0].url}`);
    assert.equal(original.status, 401);
    const creatorDetail = await fetch(`${base}/api/media/${item.id}`);
    assert.equal(creatorDetail.status, 200);
    const creatorJson = await creatorDetail.text();
    assert.ok(!creatorJson.includes("data:image/"), "Single media API exposed legacy bytes");
    assert.equal(JSON.parse(creatorJson).url, `/api/media/legacy/${item.id}/file`);
    const officialDetail = await fetch(`${base}/api/media/${publicItem.id}`);
    assert.equal(officialDetail.status, 200);
    const officialJson = await officialDetail.text();
    assert.ok(!officialJson.includes("data:image/"), "Official media API exposed legacy bytes");
    assert.equal(JSON.parse(officialJson).thumbnail, `/api/media/legacy/${publicItem.id}/thumbnail`);
    assert.equal((await fetch(`${base}/api/media/${publicItem.id}/download?quality=high`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${base}/api/media/${item.id}/download?quality=low`, { method: "POST" })).status, 401);
    const lowResponse = await fetch(`${base}/api/media/${publicItem.id}/download?quality=low`, { method: "POST" });
    assert.equal(lowResponse.status, 200);
    assert.equal((await lowResponse.json()).url, `/api/media/${publicItem.id}/download?quality=low`);
    for (const [endpoint, expectedId] of [
      ["/api/media/top-shots", publicItem.id],
      ["/api/media/creator-top", item.id],
      [`/api/media/top/creator/${user.id}`, item.id],
    ]) {
      const response = await fetch(`${base}${endpoint}`);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.ok(!body.includes("data:image/"), `${endpoint} exposed inline original or preview`);
      const featured = JSON.parse(body).find(row => row.id === expectedId);
      assert.ok(featured, `${endpoint} omitted featured fixture`);
      assert.equal(featured.url, `/api/media/legacy/${expectedId}/file`);
      assert.equal(featured.thumbnail, `/api/media/legacy/${expectedId}/thumbnail`);
      assert.equal((await fetch(`${base}${featured.url}`)).status, 401);
      assert.equal((await fetch(`${base}${featured.thumbnail}`)).status, 200);
    }
  } finally {
    if (item) await db.delete(mediaItems).where(eq(mediaItems.id, item.id));
    if (publicItem) await db.delete(mediaItems).where(eq(mediaItems.id, publicItem.id));
    await db.delete(events).where(eq(events.id, publicEvent.id));
    await db.delete(events).where(eq(events.id, event.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
});