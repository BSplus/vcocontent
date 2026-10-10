import test, { after } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseEntryFile } from "../server/entry-list.ts";
import { parseRecognition } from "../server/utils/motorsport-recognition.ts";
import { matchReferences } from "../server/reference-matching.ts";
import { pool } from "../server/db.ts";
after(()=>pool.end());
const visible = (number="89") => ({number,team:"",drivers:"",vehicle:"Race Car",manufacturer:"",racingClass:"",discipline:"",source:"visual"});
const row = (fields={}) => ({number:"89",team:"Season Team",car:"Stock Car",drivers:"Listed A, Listed B",...fields});
const doc = (rows, extras={}) => ({scope:"season",kind:"entry",session:null,updatedAt:new Date(),rows,...extras});
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
