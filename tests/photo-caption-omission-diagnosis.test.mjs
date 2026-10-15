// Pure, synthetic reproductions of the read-only Sebring diagnosis.
// No queue, routes, database queries, or real provider calls are permitted.
import test from "node:test";
import assert from "node:assert/strict";
import { matchReferences } from "../server/reference-matching.ts";
import { matchedPhotoCaption } from "../server/caption-proposal.ts";
import { supportedPhotoObservations } from "../server/utils/photo-number-evidence.ts";
import { pool } from "../server/db.ts";

const realFetch = globalThis.fetch;
const realQuery = pool.query;
test.before(() => {
  globalThis.fetch = async () => { throw new Error("Network forbidden in diagnosis"); };
  pool.query = () => { throw new Error("Database queries forbidden in diagnosis"); };
});
test.after(async () => {
  globalThis.fetch = realFetch;
  pool.query = realQuery;
  await pool.end();
});

const event = { title: "Synthetic Sebring event", date: new Date("2026-10-11"),
  round: "2", track: "Sebring", platform: null };
const row = (number, team, car) => ({ number, team, car,
  drivers: "Synthetic registered lineup", manufacturer: "", racingClass: "", discipline: "" });
const entries = [
  row("91", "Porsche Coanda Esports Racing Team", "Porsche 963 GTP"),
  row("132", "Bleu Mercure Esport", "Porsche 911 GT3 R (992)"),
  row("7", "Grid-and-Go.com eSports", "Aston Martin Valkyrie"),
];
const document = { scope: "event", kind: "entry", session: null,
  updatedAt: new Date(0), rows: entries };
const observed = (number, extra = {}) => ({ number, team: "", drivers: "",
  vehicle: "Race Car", manufacturer: "", racingClass: "", discipline: "",
  source: "visual", vehicleRegion: [100, 100, 600, 500],
  numberEvidence: "vehicle-crop-v2", ...extra });
const identify = observations => matchReferences(observations, [document], null, event.title, true, true);

test("complete supported 91 receives reference information despite compatible manufacturer branding", () => {
  const hint = { team: "Porsche", vehicle: "Porsche 963", manufacturer: "Porsche" };
  const input = observed("91", { referenceConstraints: [hint] });
  const matched = identify([input]);
  assert.equal(matched[0].number, "91");
  assert.equal(matched[0].numberEvidence, "vehicle-crop-v2");
  assert.equal(matched[0].source, "reference");
  assert.equal(matched[0].team, entries[0].team);
  assert.equal(matched[0].vehicle, entries[0].car);
  assert.equal(matched[0].drivers, entries[0].drivers);
  assert.match(matchedPhotoCaption(event, null, matched).caption, /#91 Porsche Coanda/);
  const control = identify([observed("91", { referenceConstraints: [{ ...hint, team: "" }] })]);
  assert.equal(control[0].source, "reference");
  assert.match(matchedPhotoCaption(event, null, control).caption, /#91 Porsche Coanda/);
});

test("complete unique team core permits a terminal Esport suffix without guessing identities", () => {
  const hint = { team: "bleu mercure", vehicle: "Porsche", manufacturer: "Porsche" };
  for (const team of ["bleu mercure", "", "Bleu Mercure Esport", "BLEU-MERCURE ESPORTS"]) {
    const identified = identify([observed("132", { referenceConstraints: [{ ...hint, team }] })]);
    assert.equal(identified[0].source, "reference");
    assert.match(matchedPhotoCaption(event, null, identified).caption, /#132 Bleu Mercure Esport/);
  }
});

test("a valid reference beside unknown cars retains only its own automatic caption content", () => {
  for (const number of ["7", "91"]) {
    const known = identify([observed(number)])[0];
    assert.equal(known.source, "reference");
    const alone = matchedPhotoCaption(event, null, [known]);
    assert.equal(alone.matchStatus, "matched");
    for (const others of [1, 2]) {
      const unknown = Array.from({ length: others }, () => observed("", { numberEvidence: undefined }));
      const mixed = matchedPhotoCaption(event, null, [known, ...unknown]);
      assert.equal(mixed.matchStatus, "matched");
      assert.equal(mixed.caption, alone.caption);
      assert.match(mixed.caption, new RegExp(`#${number} `));
      assert.match(mixed.caption, /Sebring/);
    }
  }
});

test("different teams, unrecognized sponsors, short fragments and ambiguous short names still veto", () => {
  for (const team of ["BMW", "Mobil 1", "Coanda", "Porsche Coanda Junior", "Different team"]) {
    assert.equal(identify([observed("91", { referenceConstraints: [
      { team, vehicle: "", manufacturer: "" },
    ] })])[0].source, "visual", team);
  }
  const other = { ...document, rows: [...entries, row("133", "Bleu Mercure Racing", "Porsche 911 GT3 R (992)")] };
  const result = matchReferences([observed("132", { referenceConstraints: [
    { team: "bleu mercure", vehicle: "", manufacturer: "" },
  ] })], [other], null, event.title, true, true);
  assert.equal(result[0].source, "visual", "two registered spellings cannot certify a short-name alias");
});

test("unmatched-only photos remain context-only and manual identities remain untouched", () => {
  const unknown = identify([observed("999"), observed("", { numberEvidence: undefined })]);
  assert.deepEqual(matchedPhotoCaption(event, null, unknown), {
    caption: matchedPhotoCaption(event, null, []).caption, matchStatus: "no_unique_match",
  });
  const manual = observed("91", { source: "manual", team: "Protected manual team", drivers: "Protected lineup" });
  assert.deepEqual(identify([manual])[0], manual);
  assert.equal(matchedPhotoCaption(event, null, [manual]).matchStatus, "no_unique_match");
});

test("missing number evidence and conflicting entries veto; registered cars override weak appearance", () => {
  const unsupported = observed("132", { numberEvidence: undefined });
  assert.equal(supportedPhotoObservations([unsupported])[0].number, "");
  assert.equal(identify([unsupported])[0].source, "visual");
  const authoritative=identify([observed("91", {
    referenceConstraints: [{ team: "", vehicle: "BMW M Hybrid V8", manufacturer: "BMW" }],
  })])[0];
  assert.equal(authoritative.source, "reference");
  assert.equal(authoritative.vehicle,"Porsche 963 GTP");
  assert.equal(identify([observed("91", {
    referenceConstraints: [{ team: "Porsche", vehicle: "", manufacturer: "BMW" }],
  })])[0].source, "reference", "number-backed entry vehicle remains authoritative over weak make guesses");
  const conflict = { ...document, rows: [...entries, row("91", "Different team", "Porsche 963 GTP")] };
  assert.equal(matchReferences([observed("91")], [conflict], null, event.title, true, true)[0].source, "visual");
});

test("session filtering can block matching without discarding the supported number", () => {
  const scoped = { ...document, session: "Race" };
  const result = matchReferences([observed("91")], [scoped], null, event.title, true, true);
  assert.equal(result[0].number, "91");
  assert.equal(result[0].source, "visual");
});

test("checked MAHLE and EMM numbers accept exact unique one-word team cores", () => {
  const docs = [{ ...document, rows: [
    row("110", "MAHLE RACING TEAM", "BMW M4 GT3"),
    row("115", "EMM Esports", "Chevrolet Corvette Z06 GT3.R"),
  ] }];
  for (const [number, team, manufacturer] of [["110", "MAHLE", "BMW"], ["115", "EMM", ""]]) {
    const input = observed(number, { referenceConstraints: [{ team, manufacturer, vehicle: "Race Car" }] });
    const identified = matchReferences([input], docs, null, event.title, true, true);
    assert.equal(identified[0].source, "reference");
    assert.match(matchedPhotoCaption(event, null, identified).caption, new RegExp(`#${number} `));
    assert.equal(identified[0].drivers, "Synthetic registered lineup");
  }
});

test("one-word cores do not allow fragments, sponsors, conflicting spellings or unchecked numbers", () => {
  const docs = [{ ...document, rows: [row("110", "MAHLE RACING TEAM", "BMW M4 GT3")] }];
  const match = (team, extra = {}, documents = docs) => matchReferences([observed("110", {
    referenceConstraints: [{ team, manufacturer: "BMW", vehicle: "" }], ...extra,
  })], documents, null, event.title, true, true)[0];
  for (const hint of ["MAH", "MA", "M", "Mobil 1", "MAHLE Junior", "Different Team"])
    assert.equal(match(hint).source, "visual", hint);
  assert.equal(match("MAHLE", { numberEvidence: undefined }).number, "");
  assert.equal(match("MAHLE", { referenceConstraints: [{ team: "MAHLE", manufacturer: "Ferrari", vehicle: "" }] }).vehicle, "BMW M4 GT3");
  assert.equal(match("MAHLE", {}, [{ ...docs[0], rows: [...docs[0].rows, row("111", "MAHLE Esports", "BMW M4 GT3")] }]).source, "visual");
  assert.equal(match("MAHLE", {}, [{ ...docs[0], session: "Race" }]).source, "visual");
});

test("manufacturer badge AMG is not a competing team on a registered Mercedes-AMG", () => {
  const docs = [{ ...document, rows: [row("121", "Registered Team", "Mercedes-AMG GT3 2020")] }];
  const input = observed("121", { referenceConstraints: [{ team: "AMG", manufacturer: "Mercedes", vehicle: "GT race car" }] });
  assert.equal(matchReferences([input], docs, null, event.title, true, true)[0].source, "reference");
  const differentCar = [{ ...docs[0], rows: [row("121", "Registered Team", "BMW M4 GT3")] }];
  assert.equal(matchReferences([input], differentCar, null, event.title, true, true)[0].source, "visual");
});
