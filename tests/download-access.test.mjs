import test from "node:test";
import assert from "node:assert/strict";
import { downloadAccess } from "../server/download-access.ts";
import { downloadOptionLabel } from "../client/src/lib/media-download.ts";

const photo = { type: "image", isPremium: false };
const official = { creatorId: null, isPremium: false };
const creator = { creatorId: 5, isPremium: false };

test("only VCO low-res photos are anonymous downloads", () => {
  assert.equal(downloadAccess(photo, official, "low", false), 200);
  assert.equal(downloadAccess(photo, official, "high", false), 401);
  assert.equal(downloadAccess(photo, official, "high", true), 200);
  assert.equal(downloadAccess(photo, creator, "low", false), 401);
  assert.equal(downloadAccess(photo, creator, "low", true), 200);
  assert.equal(downloadAccess(photo, creator, "high", true), 200);
  assert.equal(downloadAccess({ type: "video", isPremium: false }, official, "low", true), 400);
  assert.equal(downloadAccess({ type: "video", isPremium: false }, official, "high", false), 401);
  assert.equal(downloadAccess({ ...photo, isPremium: true }, official, "low", false), 403);
  assert.equal(downloadAccess(photo, { ...official, isPremium: true }, "low", false), 403);
});

test("download options display measured per-variant megabytes", () => {
  assert.equal(downloadOptionLabel({ highBytes: 2_560_000, lowBytes: 87_000, url:"/api/media/files/media-00000000-0000-4000-8000-000000000000.webp" }, "high"), "High-Res Download · optimized (2.56 MB)");
  assert.equal(downloadOptionLabel({type:"image",highBytes:32*1048576,
    url:"/api/media/files/media-01999999-0000-7000-8000-000000000000.jpg"},"high"),
    "High-Res · JPEG · up to 5.00 MB","Original size must not be advertised as standard export size");
  assert.equal(downloadOptionLabel({ highBytes: 2_560_000, url:"/api/media/files/media-00000000-0000-8000-8000-000000000000.jpg" }, "high"), "Original Download · uploaded file (2.56 MB)");
  assert.equal(downloadOptionLabel({ highBytes: 2_560_000, lowBytes: 87_000 }, "low"), "Low-Res · JPEG · up to 0.50 MB");
  assert.equal(downloadOptionLabel({ highBytes: null, lowBytes: null }, "low"), "Low-Res · JPEG · up to 0.50 MB");
});