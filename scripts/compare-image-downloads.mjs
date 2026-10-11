// Run with node --import tsx scripts/compare-image-downloads.mjs [--supplied-hires].
// Offline only: no database, storage service, provider calls or reimport.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { preparePhoto, DOWNLOAD_BYTES, PREVIEW_BYTES } from "../server/image-downloads.ts";
import { prepareLowResolution } from "../server/low-resolution-download.ts";

const args = process.argv.slice(2);
if (args.some(arg => arg !== "--supplied-hires") || args.length > 1)
  throw new Error("Usage: node --import tsx scripts/compare-image-downloads.mjs [--supplied-hires]");
const supplied = args.includes("--supplied-hires");
const out = `generated-artifacts/image-quality${supplied ? "/supplied-hires" : ""}`;
const samples = supplied ? [
  ["sebring-finish", "attached_assets/1_VCO_31035_HiRes_1791756944089.jpg", [
    { name:"car-lettering", left:1550, top:790, width:512, height:512 },
    { name:"flag-colour-fence", left:850, top:440, width:512, height:512 },
  ]],
  ["field-grandstand", "attached_assets/0_VCO_30912_HiRes_1791756944089.jpg", [
    { name:"car-livery-wheel", left:2240, top:1320, width:512, height:512 },
    { name:"crowd-grass-fence", left:2040, top:690, width:512, height:512 },
  ]],
] : [
  ["stock-89", "attached_assets/#89_3.png", [{name:"detail",left:800,top:1150,width:700,height:500}]],
  ["wide-field", "attached_assets/IMG_7464.png", [{name:"detail",left:900,top:400,width:700,height:500}]],
];
const hash = data => createHash("sha256").update(data).digest("hex");
const describe = async data => {
  const m = await sharp(data).metadata();
  return {width:m.width,height:m.height,bytes:data.length,sha256:hash(data)};
};
await mkdir(out, { recursive: true });
const rows = [];
for (const [id, filename, regions] of samples) {
  const input = await readFile(filename);
  const source = await sharp(input).metadata();
  const mime = `image/${source.format === "jpeg" ? "jpeg" : source.format}`;
  const {download:candidate,preview,mimeType} = await preparePhoto(filename,mime,input.length,"official");
  assert.ok(candidate.length <= DOWNLOAD_BYTES && preview.length <= PREVIEW_BYTES);
  const unchanged = input.equals(candidate);
  if (supplied) assert.ok(unchanged, `${id}: suitable supplied JPEG must remain unchanged`);
  // Immediately preceding policy comparator (distinct from the older 2560px
  // legacy path). Suitable supplied JPEGs passed through in that policy too.
  const previousHigh = supplied ? input : await sharp(input).rotate().webp({quality:90,effort:4}).toBuffer();
  const currentLow = await prepareLowResolution(candidate, AbortSignal.timeout(45_000));
  assert.ok(currentLow.length <= 500_000);
  let selectedQuality = null;
  if (!unchanged && source.format === "png") {
    for (const quality of [100,98,95,90,85,80]) {
      const encoded = await sharp(input).rotate().webp({quality,effort:4}).toBuffer();
      if (encoded.equals(candidate)) { selectedQuality = quality; break; }
    }
  }
  // Historical download comparator, not an alternative current policy.
  let old;
  let oldQuality;
  for (oldQuality of [86,76,64,52,40]) {
    old = await sharp(input).rotate()
      .resize({width:2560,height:2560,fit:"inside",withoutEnlargement:true})
      .webp({quality:oldQuality,effort:4}).toBuffer();
    if (old.length <= 4 * 1024 * 1024) break;
  }
  assert.ok(old.length <= 4 * 1024 * 1024, "Historical comparator exceeds its budget");
  const oldPreview = await sharp(old).resize({width:640,height:640,fit:"inside",withoutEnlargement:true}).webp({quality:76,effort:5}).toBuffer();
  rows.push({id,filename,source:await describe(input),old:await describe(old),candidate:await describe(candidate),
    mimeType,unchanged,oldQuality,hasProfile:source.hasProfile,colourSpace:source.space,
    preview:await describe(preview),oldPreviewBytes:oldPreview.length,
    oldStoredBytes:old.length+oldPreview.length,newStoredBytes:candidate.length+preview.length,
    previousHigh:await describe(previousHigh),currentHigh:await describe(candidate),selectedQuality,
    previousLow:await describe(preview),currentLow:await describe(currentLow),
    previousStoredBytes:previousHigh.length+preview.length,currentStoredBytes:candidate.length+preview.length,
    cropPanelOrder:["original","historical (enlarged for comparison only)","current"],
    regions,sourceUnmodified:hash(await readFile(filename)) === hash(input)});
  assert.ok(rows.at(-1).sourceUnmodified);
  // Lossless display panels in original oriented coordinates. Enlarging a
  // smaller download here is for inspection only, never application storage.
  const upright = await sharp(input).rotate().toBuffer();
  const m = await sharp(upright).metadata();
  for (const {name,...region} of regions) {
    const panels = [];
    for (const data of [input,old,candidate]) {
      panels.push(await sharp(data).rotate().resize(m.width,m.height).extract(region).png().toBuffer());
    }
    await sharp({create:{width:region.width*3,height:region.height,channels:3,background:"white"}})
      .composite(panels.map((input,i)=>({input,left:i*region.width,top:0})))
      .png().toFile(`${out}/${id}-${name}-crops.png`);
    const highPanels = [];
    for (const data of [input,previousHigh,candidate])
      highPanels.push(await sharp(data).rotate().resize(m.width,m.height).extract(region).png().toBuffer());
    const prefix = supplied ? `${id}-${name}` : id;
    await sharp({create:{width:region.width*3,height:region.height,channels:3,background:"white"}})
      .composite(highPanels.map((input,i)=>({input,left:i*region.width,top:0})))
      .png().toFile(`${out}/${prefix}-high-crops.png`);
    // Source, former thumbnail download, current dynamic Low-Res at identical
    // oriented coordinates. Thumbnail enlargement is only an inspection aid.
    const low = await sharp(currentLow).metadata();
    const ratio = low.width / m.width;
    const lowRegion = {left:Math.floor(region.left*ratio),top:Math.floor(region.top*ratio),
      width:Math.floor(region.width*ratio),height:Math.floor(region.height*ratio)};
    const lowPanels = [];
    for (const data of [input,preview,currentLow])
      lowPanels.push(await sharp(data).rotate().resize(low.width,low.height).extract(lowRegion).png().toBuffer());
    await sharp({create:{width:lowRegion.width*3,height:lowRegion.height,channels:3,background:"white"}})
      .composite(lowPanels.map((input,i)=>({input,left:i*lowRegion.width,top:0})))
      .png().toFile(`${out}/${prefix}-low-crops.png`);
  }
  await writeFile(`${out}/${id}-candidate.${mimeType === "image/jpeg" ? "jpg" : source.format === "png" && unchanged ? "png" : source.format === "gif" && unchanged ? "gif" : "webp"}`,candidate);
  await writeFile(`${out}/${id}-preview.webp`,preview);
  await writeFile(`${out}/${id}-low.webp`,currentLow);
}
await writeFile(`${out}/measurements.json`, JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows, null, 2));
