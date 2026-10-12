import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import sharp from "sharp";
import {detectNumberPanels} from "../server/utils/photo-number-panels.ts";

test("real OCR retains the unchanged 007 control's leading zeros and source geometry",async()=>{
  const b=await readFile(new URL("./fixtures/motorsport/controls/dual-007.webp",import.meta.url));
  const panels=await detectNumberPanels(b);
  assert.ok(panels.some(p=>p.number==="007"&&p.confidence>=65));
  assert.ok(panels.every(p=>p.number!=="7"&&p.region[0]>=0&&p.region[1]>=0&&p.region[0]+p.region[2]<=1000&&p.region[1]+p.region[3]<=1000));
});
test("detector is not tied to a fixture, position or number and never trims a longer word",async()=>{
  for(const [number,x,y] of [["001",100,430],["1007",600,220]]){
    const svg=`<svg width="1000" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="1000" fill="#18212b"/><rect x="${x-15}" y="${y-50}" width="180" height="75" fill="white"/><text x="${x}" y="${y}" font-family="DejaVu Sans" font-size="48" font-weight="bold" fill="black">${number}</text></svg>`;
    const panels=await detectNumberPanels(await sharp(Buffer.from(svg)).png().toBuffer());
    assert.ok(panels.some(p=>p.number===number),JSON.stringify(panels));
    if(number==="1007")assert.ok(panels.every(p=>p.number!=="007"));
  }
});
test("reviewed logo, masked prefix and gear display do not become printed-number proposals",async()=>{
  for(const name of ["live-618","partial-number","formula-cockpit"]){
    const panels=await detectNumberPanels(await readFile(new URL(`./fixtures/motorsport/${name}.webp`,import.meta.url)));
    assert.deepEqual(panels,[],name);
  }
});
