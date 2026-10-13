import test from "node:test";
import assert from "node:assert/strict";
import { assertNewMediaUploadsEnabled } from "../server/media-object-routing.ts";

const cases = [
  ["replit", undefined, true],
  ["replit", "false", false],
  ["replit", "true", true],
  ["r2", undefined, false],
  ["r2", "false", false],
  ["r2", "true", true],
  [undefined, "false", false],
  ["r2", "invalid", false],
];

test("launch upload gate closes both providers without changing legacy unset behaviour", () => {
  const keys = ["MEDIA_STORAGE_PROVIDER", "MEDIA_STORAGE_NEW_UPLOADS_ENABLED"];
  const previous = keys.map(key => process.env[key]);
  try {
    for (const [provider, enabled, allowed] of cases) {
      for (const [key, value] of [[keys[0], provider], [keys[1], enabled]]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (allowed) assert.doesNotThrow(assertNewMediaUploadsEnabled);
      else assert.throws(assertNewMediaUploadsEnabled,
        error => error.code === "configuration");
    }
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
