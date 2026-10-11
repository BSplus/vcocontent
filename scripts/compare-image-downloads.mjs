// Small offline before/after comparison, not a camera benchmark or reimport.
// Run: node --import tsx scripts/compare-image-downloads.mjs
import sharp from "sharp";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { preparePhoto } from "../server/image-downloads.ts";
import { prepareLowResolution } from "../server/low-resolution-download.ts";
const out = "generated-artifacts/image-quality";
await mkdir(out, { recursive: true });
const rows = [];
const describe = async data => {
  const m = await sharp(data).metadata();
  return { width: m.width, height: m.height, bytes: data.length };
};
for (const [id, filename] of [["stock-89", "attached_assets/#89_3.png"], ["wide-field", "attached_assets/IMG_7464.png"]]) {
  const input = await readFile(filename);
  const source = await sharp(input).metadata();
  const previousHigh = await sharp(input).rotate().webp({ quality: 90, effort: 4 }).toBuffer();
  const prepared = await preparePhoto(filename, "image/png", input.length, "official");
  const currentLow = await prepareLowResolution(prepared.download, AbortSignal.timeout(45_000));
  let selectedQuality;
  for (const quality of [100, 98, 95, 90, 85, 80]) {
    const candidate = await sharp(input).rotate().webp({ quality, effort: 4 }).toBuffer();
    if (candidate.equals(prepared.download)) { selectedQuality = quality; break; }
  }
  rows.push({ id, source: { width: source.width, height: source.height, bytes: input.length },
    previousHigh: await describe(previousHigh), currentHigh: await describe(prepared.download), selectedQuality,
    previousLow: await describe(prepared.preview), currentLow: await describe(currentLow),
    previousStoredBytes: previousHigh.length + prepared.preview.length,
    currentStoredBytes: prepared.download.length + prepared.preview.length });
  const region = id === "stock-89" ? { left: 800, top: 1150, width: 700, height: 500 } : { left: 900, top: 400, width: 700, height: 500 };
  const highPanels = [];
  for (const data of [input, previousHigh, prepared.download])
    highPanels.push(await sharp(data).rotate().extract(region).png().toBuffer());
  await sharp({ create: { width: 2100, height: 500, channels: 3, background: "white" } })
    .composite(highPanels.map((input, i) => ({ input, left: i * 700, top: 0 })))
    .png().toFile(`${out}/${id}-high-crops.png`);
  // Same detail coordinates at the new Low-Res dimensions. Enlargement of the
  // old 640px image is exclusively an inspection aid, never a download operation.
  const m = await sharp(currentLow).metadata();
  const ratio = m.width / source.width;
  const lowRegion = { left: Math.floor(region.left * ratio), top: Math.floor(region.top * ratio),
    width: Math.floor(region.width * ratio), height: Math.floor(region.height * ratio) };
  const lowPanels = [];
  for (const data of [input, prepared.preview, currentLow])
    lowPanels.push(await sharp(data).resize(m.width, m.height).extract(lowRegion).png().toBuffer());
  await sharp({ create: { width: lowRegion.width * 3, height: lowRegion.height, channels: 3, background: "white" } })
    .composite(lowPanels.map((input, i) => ({ input, left: i * lowRegion.width, top: 0 })))
    .png().toFile(`${out}/${id}-low-crops.png`);
}
await writeFile(`${out}/measurements.json`, JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows, null, 2));
