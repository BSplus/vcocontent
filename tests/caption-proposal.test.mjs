import test from "node:test";
import assert from "node:assert/strict";
import { proposeCaption, entryConflicts, matchedPhotoCaption, communityCaption } from "../server/caption-proposal.ts";

const event = { title: "GT Masters", round: "Round 4", track: "Nürburgring", date: new Date("2026-09-28T12:00:00Z") };
const entries = [
  { number: "007", team: "North Racing", car: "Porsche 911", drivers: "A. One / B. Two" },
  { number: "12", team: "South Racing", car: "Ferrari 296", drivers: "C. Three" },
];

test("one confirmed entry is named, leading zeros match without losing the original entry number", () => {
  const result = proposeCaption(event, entries, ["7"], null);
  assert.equal(result.ambiguous, false);
  assert.deepEqual(result.matches, [entries[0]]);
  assert.match(result.suggestion, /#007 North Racing — Porsche 911 — A\. One \/ B\. Two$/);
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

const photoEvent = { ...event, platform: "iRacing" };
const identities = entries.map(({car, ...row}) => ({
  ...row, vehicle: car, manufacturer: "", racingClass: "", discipline: "", source: "reference",
}));
const context = matchedPhotoCaption(photoEvent, "Series", []).caption;

test("automatic and manual photo captions keep every vehicle and complete lineup without labels", () => {
  const vehicles = "#007 North Racing — Porsche 911 — A. One / B. Two | #12 South Racing — Ferrari 296 — C. Three";
  for (const manual of [false, true]) {
    const rows = identities.map(row => ({ ...row, source: manual ? "manual" : "reference" }));
    const result = matchedPhotoCaption(photoEvent, "Series", rows, manual);
    assert.equal(result.matchStatus, "matched");
    assert.equal(result.caption, `${context} | ${vehicles}`);
  }
  for (const text of ["iRacing", "Series", "GT Masters", "Round 4", "Nürburgring", "28 September 2026"])
    assert.ok(context.includes(text));
});

test("absent drivers and optional car/team fields leave no empty separators or invented names", () => {
  const row = { ...identities[0], drivers: "" };
  assert.equal(matchedPhotoCaption(photoEvent, "Series", [row]).caption,
    `${context} | #007 North Racing — Porsche 911`);
  assert.equal(proposeCaption(event, [{ ...entries[0], drivers: "" }], ["7"], null).suggestion,
    `${communityCaption(event)} — #007 North Racing — Porsche 911`);
  assert.equal(matchedPhotoCaption(photoEvent, "Series", [{ ...row, team: "", vehicle: "", source: "manual" }], true).caption,
    `${context} | #007`);
});

test("unmatched, mixed visual and unconfirmed manual rows still produce context-only captions", () => {
  for (const rows of [[], [{ ...identities[0], source: "visual" }],
    [identities[0], { ...identities[1], source: "visual" }], [{ ...identities[0], source: "manual" }]]) {
    assert.deepEqual(matchedPhotoCaption(photoEvent, "Series", rows),
      { caption: context, matchStatus: "no_unique_match" });
  }
  assert.equal(proposeCaption(event, [], [], null).suggestion, communityCaption(event));
});

test("1000-character boundary retains whole lineups, overflow omits all vehicles rather than cutting names", () => {
  for (const manual of [false, true]) {
    const row = { ...identities[0], source: manual ? "manual" : "reference", drivers: "A".repeat(500) };
    const base = matchedPhotoCaption(photoEvent, null, [row, identities[1]], manual).caption;
    const exactEvent = { ...photoEvent, title: photoEvent.title + "x".repeat(1000 - base.length) };
    const exact = matchedPhotoCaption(exactEvent, null, [row, identities[1]], manual).caption;
    assert.equal(exact.length, 1000);
    assert.ok(exact.includes(row.drivers));
    assert.ok(exact.endsWith(identities[1].drivers));
    const overflowEvent = { ...exactEvent, title: exactEvent.title + "x" };
    assert.equal(matchedPhotoCaption(overflowEvent, null, [row, identities[1]], manual).caption,
      matchedPhotoCaption(overflowEvent, null, []).caption);
  }
  const row = { ...entries[0], drivers: "A".repeat(500) };
  const base = proposeCaption(event, [row], ["7"], null).suggestion;
  const exactEvent = { ...event, title: event.title + "x".repeat(1000 - base.length) };
  assert.equal(proposeCaption(exactEvent, [row], ["7"], null).suggestion.length, 1000);
  const overflowEvent = { ...exactEvent, title: exactEvent.title + "x" };
  assert.equal(proposeCaption(overflowEvent, [row], ["7"], null).suggestion, communityCaption(overflowEvent));
  const hugeEvent = { ...photoEvent, title: "x".repeat(1100) };
  assert.equal(matchedPhotoCaption(hugeEvent, null, identities).caption,
    `${photoEvent.platform} · ${hugeEvent.title}`.slice(0, 1000));
});