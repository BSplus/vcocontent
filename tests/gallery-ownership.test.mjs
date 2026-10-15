import test from "node:test";
import assert from "node:assert/strict";
import { resolveGalleryOwnership, assertGalleryOwnership, GalleryOwnershipError } from "../shared/gallery-ownership.ts";

test("only an existing gallery with an explicit null owner is official", () => {
  const ownership = resolveGalleryOwnership({id: 3, creatorId: null});
  assert.deepEqual(ownership, {galleryId: 3, category: "OFFICIAL_VCO", ownerId: null});
  assert.ok(Object.isFrozen(ownership));
  for (const invalid of [undefined, null, {}, {id: 3}, {id: 0, creatorId: null},
    {id: 1.5, creatorId: null}, {id: 3, creatorId: 0}, {id: 3, creatorId: -1},
    {id: 3, creatorId: "7"}, {id: 3, creatorId: NaN}, {id: 3, creatorId: Infinity}])
    assert.throws(() => resolveGalleryOwnership(invalid), GalleryOwnershipError);
});

test("gallery owner is independent of uploader, admin flag and official association", () => {
  for (const extra of [
    {uploaderId: 99, isAdmin: true}, {uploaderId: 7, isAdmin: true},
    {officialEventId: 1, seriesCreatorId: null}, {photographer: "Someone else"},
  ]) {
    const ownership = resolveGalleryOwnership({id: 3, creatorId: 7, ...extra});
    assert.deepEqual(ownership, {galleryId: 3, category: "CREATOR", ownerId: 7});
    assert.ok(Object.isFrozen(ownership));
  }
});

test("commit fences official/Creator transfers, changed owners, wrong galleries and missing context", () => {
  for (const creatorId of [null, 7]) {
    const snapshot = resolveGalleryOwnership({id: 3, creatorId});
    assert.deepEqual(assertGalleryOwnership({id: 3, creatorId}, snapshot), snapshot);
    for (const changed of [undefined, {id: 4, creatorId}, {id: 3, creatorId: 8},
      {id: 3, creatorId: creatorId === null ? 7 : null}])
      assert.throws(() => assertGalleryOwnership(changed, snapshot), GalleryOwnershipError);
  }
});
