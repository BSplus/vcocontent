import test from "node:test";
import assert from "node:assert/strict";
import { formatDate } from "../client/src/lib/utils.ts";

test("dates use day, full English month, and four-digit year", () => {
  assert.equal(formatDate(new Date(2026, 9, 28)), "28 October 2026");
  assert.equal(formatDate(new Date(2026, 0, 5)), "5 January 2026");
});
