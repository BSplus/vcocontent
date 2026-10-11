// Small, offline comparison. No database, storage writes, provider calls or reimport.
import sharp from "sharp";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const out = "generated-artifacts/image-quality";
await mkdir(out, { recursive: true });
const rows = [];
for (const [id, filename] of [["stock-89", "attached_assets/#89_3.png"], ["wide-field", "attached_assets/IMG_7464.png"]]) {
  const input = await readFile(filename);
  const source = await sharp(input).metadata();
  const old = await sharp(input).rotate().resize({width:2560,height:2560,fit:"inside",withoutEnlargement:true}).webp({quality:86,effort:4}).toBuffer();
  let candidate;
  let quality;
  for (quality of [90, 85, 80]) {
    candidate = await sharp(input).rotate().webp({quality,effort:4}).toBuffer();
    if (candidate.length <= 5_000_000) break;
  }
  const preview = await sharp(input).rotate().resize({width:640,height:640,fit:"inside",withoutEnlargement:true}).webp({quality:76,effort:5}).toBuffer();
  const oldPreview = await sharp(old).resize({width:640,height:640,fit:"inside",withoutEnlargement:true}).webp({quality:76,effort:5}).toBuffer();
  const describe = async data => {const m=await sharp(data).metadata();return {width:m.width,height:m.height,bytes:data.length};};
  rows.push({id,source:{width:source.width,height:source.height,bytes:input.length},old:await describe(old),candidate:await describe(candidate),
    quality,previewBytes:preview.length,oldPreviewBytes:oldPreview.length,oldStoredBytes:old.length+oldPreview.length,newStoredBytes:candidate.length+preview.length});
  // Review original and new at the same 100% crop; old is enlarged only in this
  // comparison view, never in processing/storage.
  const upright = await sharp(input).rotate().toBuffer();
  const m = await sharp(upright).metadata();
  const region = id === "stock-89" ? {left:800,top:1150,width:700,height:500} : {left:900,top:400,width:700,height:500};
  const panels = [];
  for (const data of [upright, old, candidate]) panels.push(await sharp(data).resize(m.width,m.height).extract(region).png().toBuffer());
  await sharp({create:{width:2100,height:500,channels:3,background:"white"}})
    .composite(panels.map((input,i)=>({input,left:i*700,top:0}))).jpeg({quality:95}).toFile(`${out}/${id}-crops.jpg`);
  await writeFile(`${out}/${id}-candidate.webp`,candidate);
}
await writeFile(`${out}/measurements.json`,JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows,null,2));
