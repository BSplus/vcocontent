import test from "node:test";
import assert from "node:assert/strict";
import { proposeCaption, entryConflicts, matchedPhotoCaption, communityCaption } from "../server/caption-proposal.ts";

const event = { title: "GT Masters", round: "Round 4", track: "Nürburgring", date: new Date("2026-09-28T12:00:00Z"), platform: "iRacing" };
const entries = [
  { number: "007", team: "North Racing", car: "Porsche 911", drivers: "A. One / B. Two" },
  { number: "12", team: "South Racing", car: "Ferrari 296", drivers: "C. Three" },
];

test("all caption paths use title, round, track, platform and date without a series", () => {
  const context = "GT Masters · Round 4 · Nürburgring · iRacing · 28 September 2026";
  assert.equal(communityCaption(event), context);
  assert.equal(proposeCaption(event, entries, ["7"], null).suggestion,
    `${context} — #007 North Racing — Porsche 911 — A. One / B. Two`);
  for (const numbers of [[], ["55"], ["7", "12"]]) {
    assert.equal(proposeCaption(event, entries, numbers, "Finish").suggestion, `${context} — Finish`);
  }
  assert.equal(matchedPhotoCaption(event, null, []).caption, context);
});

test("missing platforms are neither inferred nor represented by empty separators", () => {
  const context = "GT Masters · Round 4 · Nürburgring · 28 September 2026";
  for (const platform of [null, undefined, ""]) {
    const withoutPlatform = { ...event, platform };
    assert.equal(communityCaption(withoutPlatform), context);
    assert.equal(proposeCaption(withoutPlatform, entries, ["55"], null).suggestion, context);
    assert.equal(proposeCaption(withoutPlatform, entries, ["7"], null).suggestion,
      `${context} — #007 North Racing — Porsche 911 — A. One / B. Two`);
    assert.equal(matchedPhotoCaption(withoutPlatform, null, []).caption, context);
  }
});

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
  assert.equal(context, "Series · Round 4 · Nürburgring · iRacing · 28 September 2026");
  assert.ok(!context.includes("GT Masters"));
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

test("unmatched and unconfirmed manual rows still produce context-only captions", () => {
  for (const rows of [[], [{ ...identities[0], source: "visual" }],
    [{ ...identities[0], source: "manual" }]]) {
    assert.deepEqual(matchedPhotoCaption(photoEvent, "Series", rows),
      { caption: context, matchStatus: "no_unique_match" });
  }
  assert.equal(proposeCaption(event, [], [], null).suggestion, communityCaption(event));
});

test("mixed photos name only number-backed reference vehicles, never unknown or unconfirmed rows", () => {
  const result = matchedPhotoCaption(photoEvent, "Series", [
    identities[0], { ...identities[1], source: "visual" },
    { ...identities[1], source: "manual" },
    { ...identities[1], number: "" }, { ...identities[1], team: "" },
  ]);
  assert.equal(result.matchStatus, "matched");
  assert.equal(result.caption, `${context} | #007 North Racing — Porsche 911 — A. One / B. Two`);
  assert.doesNotMatch(result.caption, /South Racing|C\. Three|#12/);
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
  const exact = proposeCaption(exactEvent, [row], ["7"], null).suggestion;
  assert.equal(exact.length, 1000);
  assert.ok(exact.startsWith("GT Masters"));
  assert.ok(exact.endsWith(row.drivers));
  const overflowEvent = { ...exactEvent, title: exactEvent.title + "x" };
  assert.equal(proposeCaption(overflowEvent, [row], ["7"], null).suggestion, communityCaption(overflowEvent));
  const hugeEvent = { ...photoEvent, title: "x".repeat(1100) };
  assert.equal(matchedPhotoCaption(hugeEvent, null, identities).caption,
    hugeEvent.title.slice(0, 1000));
  assert.equal(proposeCaption(hugeEvent, [row], ["7"], null).suggestion,
    hugeEvent.title.slice(0, 1000));
  assert.equal(communityCaption(hugeEvent), hugeEvent.title.slice(0, 1000));
});

test("community context and scene-only proposals respect the exact text limit", () => {
  const base = communityCaption(event);
  const exactEvent = { ...event, title: event.title + "x".repeat(1000 - base.length) };
  assert.equal(communityCaption(exactEvent).length, 1000);
  assert.ok(communityCaption(exactEvent).startsWith("GT Masters"));
  assert.equal(proposeCaption(exactEvent, [], [], "Start").suggestion, communityCaption(exactEvent));
  assert.equal(communityCaption({ ...exactEvent, title: exactEvent.title + "x" }).length, 1000);
});

test("series replaces title in every path, and unusable series names fall back to title", () => {
  for (const seriesName of ["Saved series", null, undefined, "", "   "]) {
    const context = `${seriesName === "Saved series" ? seriesName : event.title} · Round 4 · Nürburgring · iRacing · 28 September 2026`;
    assert.equal(communityCaption(event, seriesName), context);
    assert.equal(proposeCaption(event, entries, ["7"], null, seriesName).suggestion,
      `${context} — #007 North Racing — Porsche 911 — A. One / B. Two`);
    assert.equal(proposeCaption(event, entries, ["7", "12"], "Start", seriesName).suggestion, `${context} — Start`);
    assert.equal(matchedPhotoCaption(event, seriesName, []).caption, context);
    for (const manual of [false, true]) {
      assert.equal(matchedPhotoCaption(event, seriesName, identities, manual).caption,
        `${context} | #007 North Racing — Porsche 911 — A. One / B. Two | #12 South Racing — Ferrari 296 — C. Three`);
    }
  }
});

test("round normalization, absent metadata and invalid dates are consistent across generators", () => {
  for (const round of ["4", "Round 4", "round 4", " Round 4 "]) {
    const e = {...event, round};
    const context = `Saved series · ${round.trim() === "4" ? "Round 4" : round.trim()} · Nürburgring · iRacing · 28 September 2026`;
    assert.equal(communityCaption(e, "Saved series"), context);
    assert.equal(proposeCaption(e, [], [], null, "Saved series").suggestion, context);
    assert.equal(matchedPhotoCaption(e, "Saved series", []).caption, context);
  }
  for (const missing of [null, undefined, "", "   "]) {
    const e = {...event, round:missing, track:missing, platform:missing, date:new Date("invalid")};
    assert.equal(communityCaption(e), "GT Masters");
    assert.equal(proposeCaption(e, [], [], null, "Saved series").suggestion, "Saved series");
    assert.equal(matchedPhotoCaption(e, "Saved series", []).caption, "Saved series");
  }
});

test("a long series also falls back to context without partial lineups", () => {
  const seriesName = "S".repeat(940);
  const context = communityCaption(event, seriesName);
  assert.ok(context.length <= 1000);
  assert.equal(proposeCaption(event, entries, ["7"], null, seriesName).suggestion, context);
  for (const manual of [false, true])
    assert.equal(matchedPhotoCaption(event, seriesName, identities, manual).caption, context);
});