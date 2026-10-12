import test, { after } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseEntryFile } from "../server/entry-list.ts";
import { parseRecognition } from "../server/utils/motorsport-recognition.ts";
import { matchReferences } from "../server/reference-matching.ts";
import { pool } from "../server/db.ts";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fixtures, review } from "./fixtures/motorsport/reviewed.mjs";
import { evaluateRecognition, compareReviewedRuns } from "./helpers/recognition-evaluation.mjs";
import { recognizeMotorsportImage } from "../server/utils/motorsport-recognition.ts";
import { TAG_MODEL } from "../server/utils/ai-tagger.ts";
import { fixtures as controls } from "./fixtures/motorsport/controls.mjs";
after(()=>pool.end());
const visible = (number="89") => ({number,team:"",drivers:"",vehicle:"Race Car",manufacturer:"",racingClass:"",discipline:"",source:"visual"});
const row = (fields={}) => ({number:"89",team:"Season Team",car:"Stock Car",drivers:"Listed A, Listed B",...fields});
const doc = (rows, extras={}) => ({scope:"season",kind:"entry",session:null,updatedAt:new Date(),rows,...extras});
test("authorized reviewed photo inputs are complete, immutable and cover the requested scenes", async () => {
  assert.match(review.authorization, /authorized EVERYTHING/);
  assert.match(review.reviewer, /visual inspection/);
  assert.equal(fixtures.length, 17);
  assert.equal(new Set(fixtures.map(f => f.id)).size, fixtures.length);
  const coverage = new Set(fixtures.flatMap(f => f.coverage));
  for (const required of ["cockpit", "standalone-helmet", "standalone-paddock", "gt3-body", "gt4-body",
    "prototype-body", "stock-body", "multiple-readable", "partial-number", "obscured-numbers"])
    assert.ok(coverage.has(required), `Missing coverage: ${required}`);
  const files = (await readdir(new URL("./fixtures/motorsport/", import.meta.url))).filter(f => f.endsWith(".webp"));
  assert.deepEqual(files.sort(), fixtures.map(f => f.file).sort());
  for (const f of fixtures) {
    const bytes = await readFile(new URL(`./fixtures/motorsport/${f.file}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256, `${f.id} needs a fresh visual review`);
    assert.ok(bytes.length < 512 * 1024, `${f.id} must remain a small recognition input`);
    assert.ok(f.evidence && f.source);
    assert.ok(f.expected.unknownFields.includes("drivers"));
  }
});
test("reviewed expectations exercise parser/reference contracts, NOT live recognition accuracy", () => {
  for (const f of fixtures) {
    // Hand-authored responses constructed from reviewed expectations are test
    // transports, never passed off as actual model output.
    const count = f.expected.vehicleCount?.min ?? Math.max(1, f.expected.numbers.length);
    const observations = Array.from({ length: count }, (_, i) => ({
      number: f.expected.numbers[i] || "", numberReadable: !!f.expected.numbers[i],
      vehicle: "Race Car", drivers: "Forbidden physical-driver guess",
      racingClass: "GT3", classReadable: false,
    }));
    const result = parseRecognition(JSON.stringify({
      tags: f.expected.requiredTagGroups.map(group => group[0]), vehicles: observations,
    }));
    assert.deepEqual(evaluateRecognition(f, result), [], f.id);
    const matched = matchReferences(result.vehicles, [doc([row({ number: "107", drivers: "Registered One; Registered Two" }),
      row({ number: "5", drivers: "Registered Three" }), row()])], null);
    assert.ok(matched.every(v => v.number || !v.drivers), `${f.id}: no lineup from helmet/team alone`);
    assert.ok(matched.every(v => v.source === "reference" || v.drivers === ""));
    if (f.id === "multiple-readable") {
      assert.equal(matched[0].drivers, "Registered One; Registered Two");
      assert.equal(matched[1].drivers, "Registered Three");
    }
    if (f.id === "gt4-front") assert.equal(matched[0].drivers, "", "unmatched entry stays unknown");
  }
});
test("leading-zero pixel control is separate from the unchanged natural-photo comparison",async()=>{
  assert.equal(controls.length,1);
  const f=controls[0];
  const bytes=await readFile(new URL(`./fixtures/motorsport/${f.file}`,import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),f.sha256);
  assert.deepEqual(f.expected.numbers,["007"]);
  assert.match(f.source,/Synthetic/);
  assert.deepEqual(evaluateRecognition(f,{tags:[],vehicles:[visible("007")]}),[]);
});
test("the evaluator catches visible omissions, unsupported classes and physical identity claims", () => {
  const f = fixtures.find(f => f.id === "partial-number");
  const result = { tags: ["GT3"], vehicles: [{ ...visible("10"), drivers: "Identified Person", racingClass: "GT3", source: "reference" }] };
  const issues = evaluateRecognition(f, result).join("; ");
  for (const required of ["Missing visible tag", "Unsupported tag", "Numbers differ", "number must remain unknown",
    "drivers must remain unknown", "racingClass must remain unknown", "source must be visual"])
    assert.ok(issues.includes(required), required);
  assert.ok(evaluateRecognition(fixtures.find(f => f.id === "helmet-detail"),
    { tags: ["Helmet"], vehicles: [visible()] }).some(issue => issue.includes("Vehicle count")));
});
test("prompt/model comparisons cannot change reviewed targets, pixels or fixture membership", () => {
  const previous = { model: TAG_MODEL, reviewedManifestSha256: "reviewed",
    samples: [{ id: "one", imageSha256: "pixels", passed: false, issues: ["Missing visible tag: Helmet"] }] };
  const current = { ...previous, samples: [{ ...previous.samples[0], passed: true, issues: [] }] };
  assert.deepEqual(compareReviewedRuns(previous, current).changes[0].resolvedIssues, ["Missing visible tag: Helmet"]);
  assert.throws(() => compareReviewedRuns(previous, { ...current, reviewedManifestSha256: "changed" }), /different reviewed/);
  assert.throws(() => compareReviewedRuns(previous, { ...current, samples: [] }), /incomplete/);
  assert.throws(() => compareReviewedRuns(previous, { ...current, samples: [{ ...current.samples[0], imageSha256: "changed" }] }), /changed images/);
  assert.throws(() => compareReviewedRuns(previous, { ...current, samples: [{ ...current.samples[0], id: "changed" }] }), /changed images/);
  const duplicate = { ...previous, samples: [previous.samples[0], previous.samples[0]] };
  assert.throws(() => compareReviewedRuns(duplicate, duplicate), /duplicate/);
});
test("number and class evidence gates retain unknowns and strip identity claims per vehicle", () => {
  const result = parseRecognition(JSON.stringify({
    tags: ["GT3", "GT4", "Helmet"], vehicles: [
      { number: "10", numberReadable: true, numberObscured: true, racingClass: "GT3", classReadable: false, vehicle: "GT Car", drivers: "Physical Person" },
      { number: "007", numberReadable: true, racingClass: "GT4", classReadable: true, vehicle: "GT Car", person: { name: "Helmet Person" } },
      { number: "9?", numberReadable: true, vehicle: "Race Car" },
      { number: "23", vehicle: "Race Car", racingClass: "GT3" },
    ],
  }));
  assert.deepEqual(result.vehicles.map(v => v.number), ["", "007", "", ""]);
  assert.deepEqual(result.vehicles.map(v => v.racingClass), ["", "GT4", "", ""]);
  assert.deepEqual(result.tags, ["GT4", "Helmet"]);
  for (const v of result.vehicles) {
    assert.equal(v.drivers, ""); assert.equal(v.source, "visual"); assert.ok(!("person" in v));
    assert.ok(!("numberReadable" in v)); assert.ok(!("numberObscured" in v));
  }
  assert.deepEqual(parseRecognition('{"tags":["Helmet"],"vehicles":[{}]}').vehicles, []);
  assert.throws(() => parseRecognition('{"tags":[],"vehicles":[{"numberReadable":"true"}]}'));
  assert.throws(() => parseRecognition(JSON.stringify({ tags: [], vehicles: Array(13).fill({}) })));
});
test("managed recognition request keeps evidence instructions, limits and identity boundaries", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  // No credential reads or replacement provider: the test intercepts only the
  // already-configured client's transport before any network activity.
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"tags":["Helmet"],"vehicles":[{"vehicle":"Race Car","drivers":"Guessed Identity"}]}' } }],
    }), { headers: { "content-type": "application/json" } });
  };
  try {
    const result = await recognizeMotorsportImage("data:image/webp;base64,AAAA");
    assert.equal(result.vehicles[0].drivers, "");
    assert.equal(request.model, TAG_MODEL);
    assert.equal(request.max_tokens, 1000);
    assert.deepEqual(request.response_format, { type: "json_object" });
    assert.equal(request.messages[1].content[0].image_url.detail, "high");
    for (const rule of ["ONLY if clearly readable", "never complete an obscured number", "No drivers, faces, helmet identity",
      "specific racing-class marking is readable", "Multiple cars can have different entries"])
      assert.ok(request.messages[0].content.includes(rule), rule);
    globalThis.fetch = async () => { throw new Error("Sensitive provider detail"); };
    await assert.rejects(recognizeMotorsportImage("data:image/webp;base64,AAAA"),
      { message: "AI recognition could not be completed" });
  } finally { globalThis.fetch = originalFetch; }
});
test("recognition rejects guessed numbers, driver identities and uncontrolled synonyms",()=>{
  const result=parseRecognition(JSON.stringify({tags:["Stock Car","Wet Track","Dry Track","Night","Day","Driver A"],
    vehicles:[{number:"89",numberReadable:true,vehicle:"Stock Car",drivers:"Guessed Person"},
      {number:"09",numberReadable:false,team:"Visible Branding"}]}));
  assert.deepEqual(result.tags,["Stock Car","Wet Track","Night"]);
  assert.equal(result.vehicles[0].drivers,""); assert.equal(result.vehicles[1].number,"");
  assert.throws(()=>parseRecognition("Stock Car, Day"));
});
test("event overrides season; matching result session supplements absent fields",()=>{
  const refs=[doc([row()]),doc([row({team:"Event Team",drivers:"Event Lineup"})],{scope:"event"}),
    doc([row({team:"Event Team",drivers:"",car:"Corrected Vehicle"})],{scope:"event",kind:"result",session:"Race 2"})];
  const result=matchReferences([visible("089")],refs,"Race 2")[0];
  assert.equal(result.team,"Event Team"); assert.equal(result.drivers,"Event Lineup");assert.equal(result.vehicle,"Corrected Vehicle");
  assert.equal(matchReferences([visible()],refs,null)[0].vehicle,"Stock Car");
});
test("changed team cannot inherit a different entry's drivers; conflicting fields stay unknown",()=>{
  const result=matchReferences([visible()],[doc([row()]),doc([row({team:"Changed Team",drivers:"",car:""})],{scope:"event",kind:"result"})],null)[0];
  assert.equal(result.drivers,""); assert.equal(result.team,"Changed Team");
  const ambiguous=matchReferences([visible()],[doc([row({drivers:"One"}),row({drivers:"Two"})])],null)[0];
  assert.equal(ambiguous.drivers,"");assert.equal(ambiguous.team,"Season Team");
  const unknown=matchReferences([visible()],[doc([row({team:"One",drivers:"Listed A"}),row({team:"Two",drivers:""})])],null)[0];
  assert.equal(unknown.drivers,"");
});
test("season rows naming an event/session override the event's broader entry roster",()=>{
  const refs=[doc([row({drivers:"General roster"})],{scope:"event"}),
    doc([row({drivers:"Specific roster",eventName:"Round 1",session:"Race 2"})],{kind:"result"})];
  assert.equal(matchReferences([visible()],refs,"Race 2","Round 1")[0].drivers,"Specific roster");
});
test("unreadable class markings never produce a specific visual racing class",()=>{
  const result=parseRecognition(JSON.stringify({tags:["GT3","RaceCar"],vehicles:[{number:"89",numberReadable:true,
    vehicle:"GT Car",racingClass:"GT3",classReadable:false}]}));
  assert.equal(result.vehicles[0].racingClass,"");assert.ok(!result.tags.includes("GT3"));
});
test("multiple cars, unknown numbers and team-only branding never invent driver identities",()=>{
  const result=matchReferences([visible("89"),visible("90"),visible("91"),{...visible(""),team:"Season Team"}],
    [doc([row(),row({number:"90",team:"Other Team",drivers:"Other Lineup"})])],null);
  assert.equal(result[0].drivers,"Listed A, Listed B");assert.equal(result[1].drivers,"Other Lineup");
  assert.equal(result[2].drivers,"");assert.equal(result[3].drivers,"");
});
test("per-row result sessions and season event names cannot leak to another race",()=>{
  const refs=[doc([row({session:"Race 1",drivers:"Race 1 Lineup"}),row({session:"Race 2",drivers:"Race 2 Lineup"})],{kind:"result"})];
  assert.equal(matchReferences([visible()],refs,null)[0].drivers,"");
  assert.equal(matchReferences([visible()],refs,"Race 2")[0].drivers,"Race 2 Lineup");
  assert.equal(matchReferences([visible()],[doc([row({eventName:"Other Event"})])],null,"This Event")[0].drivers,"");
});
test("partial CSVs retain available class, manufacturer, event and session; number column beats position",async()=>{
  const parsed=await parseEntryFile(Buffer.from("No,Car Number,Team,Manufacturer,Class,Event,Session\n1,89,Team,Chevrolet,Stock Car,Test Event,Race 1\n"),"text/csv","results.csv");
  assert.equal(parsed.rows[0].number,"89");assert.equal(parsed.rows[0].car,""); assert.equal(parsed.rows[0].drivers,"");
  assert.equal(parsed.rows[0].manufacturer,"Chevrolet");assert.equal(parsed.rows[0].session,"Race 1");
  const single=await parseEntryFile(Buffer.from("Driver\nListed Person\n"),"text/csv","drivers.csv");
  assert.equal(single.rows[0].drivers,"Listed Person");assert.equal(single.rows[0].number,"");
});
test("XLSX sparse cells and shared strings preserve partially supplied references",async()=>{
  const zip=new JSZip();
  zip.file("xl/sharedStrings.xml",'<sst><si><t>Car Number</t></si><si><t>Team</t></si><si><t>Alpha</t></si></sst>');
  zip.file("xl/worksheets/sheet1.xml",'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>89</v></c><c r="C2" t="s"><v>2</v></c></row></sheetData></worksheet>');
  const parsed=await parseEntryFile(await zip.generateAsync({type:"nodebuffer"}),"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","list.xlsx");
  assert.equal(parsed.rows[0].number,"89");assert.equal(parsed.rows[0].team,"Alpha");assert.equal(parsed.rows[0].drivers,"");
});
test("CSV combines separately listed drivers without requiring other fields",async()=>{
  const parsed=await parseEntryFile(Buffer.from("Driver 1,Driver_2\nListed A,Listed B"),"text/csv","drivers.csv");
  assert.equal(parsed.rows[0].drivers,"Listed A; Listed B");assert.equal(parsed.rows[0].number,"");
});
test("XLSX archive size limits reject decompression bombs",async()=>{
  const zip=new JSZip();zip.file("xl/worksheets/sheet1.xml"," ".repeat(17*1024*1024));
  await assert.rejects(parseEntryFile(await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"}),"application/zip","huge.xlsx"),/too large/);
});
