import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import { mediaPolicy, MediaLimitError } from "../server/media-policy.ts";
import { users, events, mediaItems, mediaReservations, mediaCleanup } from "../shared/schema.ts";
import { eq } from "drizzle-orm";

test("parallel event reservations enforce byte limits and pages remain bounded", async () => {
  const suffix = randomUUID();
  const [user] = await db.insert(users).values({
    username: `budget_${suffix}`, email: `budget_${suffix}@example.invalid`,
    password: "test-not-a-login", isCreator: true,isAdmin:true,
  }).returning();
  const [event] = await db.insert(events).values({
    title: "Budget test", description: "Temporary test event", date: new Date(), creatorId: user.id,
  }).returning();
  try {
    const size = Math.floor(mediaPolicy.eventBytes * 0.6);
    const ids = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled(ids.map(id =>
      storage.reserveMedia(id, event.id, user.id, size, `media-${id}.webp`, `thumb-${id}.webp`,true)));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.ok(results.some(result => result.status === "rejected" && result.reason instanceof MediaLimitError));
    for (let i = 0; i < 5; i++) {
      const id = randomUUID();
      await db.insert(mediaItems).values({
        eventId: event.id, type: "image", url: `/api/media/files/media-${id}.webp`,
        thumbnail: `/api/media/files/thumb-${id}.webp`, storedBytes: 2000, objectCount: 2,
      });
    }
    const first = await storage.getMediaItems(event.id, 1, 2);
    const second = await storage.getMediaItems(event.id, 2, 2);
    assert.equal(first.length, 2);
    assert.equal(second.length, 2);
    assert.ok(first[0].id > first[1].id && first[1].id > second[0].id);
    const key = first[0].url.split("/").at(-1);
    assert.equal((await storage.findMediaByKey(key))?.id, first[0].id);
    assert.equal(await storage.findMediaByKey(`media-${randomUUID()}.webp`), undefined);
    await storage.deleteMediaItem(first[0].id);
    await storage.cleanupObjects();
    assert.equal(await storage.findMediaByKey(key), undefined);
    const [remaining] = await db.select().from(mediaCleanup).where(eq(mediaCleanup.key, key));
    assert.equal(remaining, undefined);
    await db.delete(mediaReservations).where(eq(mediaReservations.eventId, event.id));
    assert.equal((await storage.deleteEvent(event.id)).success, true);
    await storage.cleanupObjects();
    assert.equal(await storage.getEvent(event.id), undefined);
    assert.equal((await storage.getMediaItems(event.id)).length, 0);
  } finally {
    await db.delete(mediaReservations).where(eq(mediaReservations.eventId, event.id));
    await db.delete(mediaItems).where(eq(mediaItems.eventId, event.id));
    await db.delete(events).where(eq(events.id, event.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
});

test("limits have conservative defaults", () => {
  assert.equal(mediaPolicy.imageBytes, 32 * 1048576);
  assert.equal(mediaPolicy.videoBytes, 50 * 1048576);
  assert.equal(mediaPolicy.maxPixels, 40_000_000);
});

test("failed object deletions stay visible for retry", async () => {
  const key = `invalid-${randomUUID()}`;
  try {
    await db.insert(mediaCleanup).values({ key });
    await storage.cleanupObjects();
    const [item] = await db.select().from(mediaCleanup).where(eq(mediaCleanup.key, key));
    assert.ok(item?.lastError?.includes("Invalid media storage key"));
  } finally {
    await db.delete(mediaCleanup).where(eq(mediaCleanup.key, key));
  }
});