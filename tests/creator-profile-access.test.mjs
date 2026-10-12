import test from "node:test";
import assert from "node:assert/strict";
import { hasActivePublicCreatorProfile } from "../shared/creator-profile-access.ts";

test("public profile links match active-profile availability for all roles", () => {
  for (const account of [
    { isAdmin: true, isCreator: false, creatorStatus: "none" },
    { isAdmin: false, isCreator: false, creatorStatus: "approved" },
    { isCreator: true, creatorStatus: "none" },
  ]) {
    assert.equal(hasActivePublicCreatorProfile(account), true);
    assert.equal(hasActivePublicCreatorProfile({ ...account, suspended: true }), false);
    assert.equal(hasActivePublicCreatorProfile({ ...account, creatorStatus: "rejected" }), false);
  }
  for (const account of [null, undefined, {}, { creatorStatus: "none" }, { creatorStatus: "pending" }])
    assert.equal(hasActivePublicCreatorProfile(account), false);
});
