import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Never write to a connected Development or Production database.
test("persisted ownership, permissions and upload commit boundaries", {
  skip: !process.env.VCO_TEST_PG_PROXY || !process.env.VCO_TEST_OBJECTS,
}, async t => {
  const {db, pool} = await import("../server/db.ts");
  const {storage} = await import("../server/storage.ts");
  const {canManage} = await import("../server/beta-access.ts");
  const {users, events, mediaItems, mediaReservations, creatorEventAssociations} =
    await import("../shared/schema.ts");
  const {eq, inArray} = await import("drizzle-orm");
  const {GalleryOwnershipError} = await import("../shared/gallery-ownership.ts");
  const suffix = randomUUID();
  const owners = await db.insert(users).values([false, true].map((isAdmin, index) => ({
    username: `ownership_${index}_${suffix}`, email: `ownership_${index}_${suffix}@example.invalid`,
    password: "fixture-not-a-login", isAdmin, isCreator: true, creatorStatus: "approved",
  }))).returning();
  const galleries = await db.insert(events).values([null, owners[0].id, owners[1].id].map(creatorId => ({
    title: "Isolated ownership fixture", description: "Temporary", date: new Date(), creatorId,
  }))).returning();
  const [official, creator, adminOwned] = galleries;
  const reservations = [];
  const reserve = async (gallery, expectedOwner = gallery.creatorId, admin = false, bytes = 100) => {
    const id = randomUUID();
    reservations.push(id);
    await storage.reserveMedia(id, gallery.id, expectedOwner, bytes,
      `media-${id}.jpg`, `thumb-${id}.webp`, admin);
    return id;
  };
  const finish = id => {
    const gallery = reservations.includes(id) ? id : null;
    assert.ok(gallery);
    return db.select().from(mediaReservations).where(eq(mediaReservations.id, id)).then(([row]) =>
      storage.finishMedia(id, {
        eventId: row.eventId, type: "image", url: `/api/media/files/${row.storageKey}`,
        thumbnail: `/api/media/files/${row.thumbnailKey}`, caption: "Authored caption",
        tags: ["Manual fixture"], storedBytes: 100, highBytes: 90, lowBytes: 10,
      }));
  };
  try {
    await t.test("existing permission matrix keeps official admin-only and Creator owner/admin management", () => {
      const approved = {id: owners[0].id, isCreator: false, creatorStatus: "approved"};
      const admin = {id: owners[1].id, isAdmin: true};
      for (const gallery of galleries) {
        assert.equal(canManage(undefined, gallery), false);
        assert.equal(canManage({id: 999, creatorStatus: "none"}, gallery), false);
        assert.equal(canManage({...admin, suspended: true}, gallery), false);
        assert.equal(canManage({...approved, creatorStatus: "rejected"}, gallery), false);
        assert.equal(canManage(admin, gallery), true);
        assert.equal(canManage(approved, gallery), gallery.id === creator.id);
        assert.equal(canManage({...approved, suspended: true}, gallery), false);
        assert.equal(canManage({id: owners[1].id, creatorStatus: "approved"}, gallery),
          gallery.id === adminOwned.id);
      }
    });
    await t.test("official reservations have no Creator quota dependency", async () => {
      // Above the current external beta allowance; below existing technical limits.
      const id = await reserve(official, null, true, 500_000_001);
      const [row] = await db.select().from(mediaReservations).where(eq(mediaReservations.id, id));
      assert.equal(row.creatorId, null);
      await db.delete(mediaReservations).where(eq(mediaReservations.id, id));
    });
    await t.test("admin upload and official-event association retain Creator accounting", async () => {
      await db.insert(creatorEventAssociations).values({galleryId: creator.id, officialEventId: official.id});
      for (const gallery of [creator, adminOwned]) {
        const id = await reserve(gallery, gallery.creatorId, true);
        const [row] = await db.select().from(mediaReservations).where(eq(mediaReservations.id, id));
        assert.equal(row.creatorId, gallery.creatorId);
        const item = await finish(id);
        assert.equal(item.eventId, gallery.id);
        assert.equal(item.caption, "Authored caption");
        assert.deepEqual(item.manualTags, ["Manual fixture"]);
        assert.equal(item.safetyStatus, "error");
      }
    });
    await t.test("stale uploader snapshots cannot reserve another owner's gallery", async () => {
      await assert.rejects(reserve(creator, null, true), GalleryOwnershipError);
      await assert.rejects(reserve(official, owners[0].id, true), GalleryOwnershipError);
      await assert.rejects(reserve(creator, owners[1].id, true), GalleryOwnershipError);
      await assert.rejects(reserve({id: 2_147_483_647, creatorId: null}), GalleryOwnershipError);
    });
    await t.test("an admin cannot bypass the target Creator's existing beta allowance", async () => {
      await assert.rejects(reserve(creator, creator.creatorId, true, 500_000_001),
        /storage|capacity|limit|budget/i);
      const rows = await db.select().from(mediaReservations)
        .where(eq(mediaReservations.id, reservations.at(-1)));
      assert.equal(rows.length, 0, "Rejected capacity must not create a reservation");
    });
    await t.test("a valid reservation cannot be redirected to another gallery", async () => {
      const id = await reserve(creator);
      const [row] = await db.select().from(mediaReservations).where(eq(mediaReservations.id, id));
      await assert.rejects(storage.finishMedia(id, {
        eventId: official.id, type: "image", url: `/api/media/files/${row.storageKey}`,
        caption: "Must not be committed", tags: [], storedBytes: 100,
      }), /event does not match/);
      const [retained] = await db.select().from(mediaReservations).where(eq(mediaReservations.id, id));
      assert.ok(retained, "Failed redirection must preserve the original reservation");
      const items = await db.select().from(mediaItems)
        .where(eq(mediaItems.url, `/api/media/files/${row.storageKey}`));
      assert.equal(items.length, 0);
      await db.delete(mediaReservations).where(eq(mediaReservations.id, id));
    });
    await t.test("a consumed reservation cannot create duplicate assets", async () => {
      const id = await reserve(official);
      const item = await finish(id);
      await assert.rejects(storage.finishMedia(id, {
        eventId: official.id, type: "image", url: item.url, caption: "Replay",
        tags: [], storedBytes: 100,
      }), /reservation has expired/);
      const items = await db.select().from(mediaItems).where(eq(mediaItems.url, item.url));
      assert.equal(items.length, 1);
      assert.equal(items[0].caption, "Authored caption");
    });
    await t.test("ownership changes fail commit without consuming the reservation", async () => {
      for (const [gallery, newOwner] of [
        [official, owners[0].id], [creator, null], [creator, owners[1].id],
      ]) {
        const id = await reserve(gallery);
        await db.update(events).set({creatorId: newOwner}).where(eq(events.id, gallery.id));
        try {
          await assert.rejects(finish(id), GalleryOwnershipError);
          const [row] = await db.select().from(mediaReservations).where(eq(mediaReservations.id, id));
          assert.ok(row, "Failed commit must retain capacity/cleanup evidence");
          const items = await db.select().from(mediaItems).where(eq(mediaItems.url, `/api/media/files/${row.storageKey}`));
          assert.equal(items.length, 0);
        } finally {
          await db.update(events).set({creatorId: gallery.creatorId}).where(eq(events.id, gallery.id));
          await db.delete(mediaReservations).where(eq(mediaReservations.id, id));
        }
      }
    });
    await t.test("deleted gallery cannot commit as an official orphan", async () => {
      const [temporary] = await db.insert(events).values({
        title: "Deleted fixture", description: "Temporary", date: new Date(),
      }).returning();
      const id = await reserve(temporary);
      await db.delete(events).where(eq(events.id, temporary.id));
      await assert.rejects(finish(id), GalleryOwnershipError);
    });
    await t.test("unchanged official reservation still commits with existing free semantics", async () => {
      const id = await reserve(official);
      const item = await finish(id);
      assert.equal(item.eventId, official.id);
      assert.equal(item.isPremium, false);
      assert.equal(item.safetyStatus, "legacy");
      assert.equal(item.caption, "Authored caption");
    });
  } finally {
    await db.delete(mediaReservations).where(inArray(mediaReservations.id, reservations));
    await db.delete(mediaItems).where(inArray(mediaItems.eventId, galleries.map(g => g.id)));
    await db.delete(events).where(inArray(events.id, galleries.map(g => g.id)));
    await db.delete(users).where(inArray(users.id, owners.map(u => u.id)));
    await pool.end();
  }
});
