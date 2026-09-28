import test from "node:test";
import assert from "node:assert/strict";
import { proposeCaption, entryConflicts } from "../server/caption-proposal.ts";

const event = { title: "GT Masters", round: "Round 4", track: "Nürburgring", date: new Date("2026-09-28T12:00:00Z") };
const entries = [
  { number: "007", team: "North Racing", car: "Porsche 911", drivers: "A. One / B. Two" },
  { number: "12", team: "South Racing", car: "Ferrari 296", drivers: "C. Three" },
];

test("one confirmed entry is named, leading zeros match without losing the original entry number", () => {
  const result = proposeCaption(event, entries, ["7"], null);
  assert.equal(result.ambiguous, false);
  assert.deepEqual(result.matches, [entries[0]]);
  assert.match(result.suggestion, /#007 North Racing, Porsche 911, A\. One/);
  assert.match(result.suggestion, /Round 4 · Nürburgring/);
});

test("multiple, absent, and conflicting numbers never identify a team or driver", () => {
  for (const [rows, numbers] of [[entries, ["007", "12"]], [entries, ["55"]], [[...entries, { ...entries[0], number: "7" }], ["007"]]]) {
    const result = proposeCaption(event, rows, numbers, "Start");
    assert.equal(result.ambiguous, true);
    assert.match(result.suggestion, /Start$/);
    assert.doesNotMatch(result.suggestion, /North Racing|South Racing|A\. One/);
  }
  assert.deepEqual(entryConflicts([{ ...entries[0] }, { ...entries[0], number: "7" }]), ["007", "7"]);
});