import test from "node:test";
import assert from "node:assert/strict";
import { pluralize } from "../client/src/lib/utils.ts";

test("explicit English forms use singular only for exactly one", () => {
  for (const [singular, plural] of [
    ["download", "downloads"], ["Download", "Downloads"], ["Photo", "Photos"],
    ["video", "videos"], ["follower", "followers"], ["item", "items"],
    ["file", "files"], ["image", "images"], ["warning", "warnings"],
    ["gallery", "galleries"], ["entry", "entries"], ["source", "sources"],
    ["object awaits", "objects await"],
  ]) {
    for (const count of [0, 1, 2, 1000]) {
      assert.equal(pluralize(count, singular, plural), count === 1 ? singular : plural);
      assert.equal(pluralize(String(count), singular, plural), count === 1 ? singular : plural);
    }
  }
});

test("unknown counts are not coerced into zero or singular", () => {
  for (const count of [null, undefined, "—", "", NaN]) {
    assert.equal(pluralize(count, "download", "downloads"), "downloads");
    assert.equal(`${count ?? "—"} ${pluralize(count, "download", "downloads")}`,
      `${count ?? "—"} downloads`);
  }
});
