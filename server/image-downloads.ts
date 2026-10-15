import sharp from "sharp";
import { readFile, stat } from "fs/promises";
import { mediaPolicy, MediaLimitError } from "./media-policy";

export type ImageStrategy = "official" | "creator-original";
export const DOWNLOAD_BYTES = 5_000_000;
export const PREVIEW_BYTES = 100_000;
export const HIGH_QUALITIES = [100, 98, 95, 90, 85, 80] as const;
export async function fitOfficialDownload(encode: (scale: number, quality: number) => Promise<Buffer>) {
  for (const scale of [1, 0.85, 0.70]) {
    for (const quality of scale === 1 ? HIGH_QUALITIES : [90, 85, 80]) {
      const candidate = await encode(scale, quality);
      if (candidate.length && candidate.length <= DOWNLOAD_BYTES) return candidate;
    }
  }
  throw new MediaLimitError("Photo cannot fit 5 MB at quality 80 while retaining at least 70% of its dimensions. Provide an approved smaller source; no severely compressed download was saved.");
}
export class InvalidPhotoError extends Error {}
const inputOptions = () => ({ limitInputPixels: mediaPolicy.maxPixels, failOn: "error" as const });

/** Shared validation decodes the entire photo, not just a readable header. */
export async function validatePhoto(filename: string, mime: string, strategy: ImageStrategy) {
  const metadata = await sharp(filename, { ...inputOptions(), animated: true }).metadata();
  const expected = mime === "image/jpeg" ? "jpeg" : mime.split("/")[1];
  if (!["jpeg", "png", "gif", "webp"].includes(metadata.format || "") || metadata.format !== expected)
    throw new Error("Image content does not match its file type");
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > mediaPolicy.maxPixels)
    throw new MediaLimitError(`Image exceeds ${mediaPolicy.maxPixels / 1_000_000} megapixels`);
  if (strategy === "creator-original") {
    const bytes = await readFile(filename);
    if ((metadata.pages || 1) > 1 ||
      (metadata.format === "png" && bytes.includes(Buffer.from("acTL"))) ||
      (metadata.format === "webp" && bytes.includes(Buffer.from("ANIM"))))
      throw new MediaLimitError("Animated or multi-frame images are not available for Community Creators.");
  }
  await sharp(filename, { ...inputOptions(), failOn:"warning" }).timeout({ seconds: 20 }).stats();
  return metadata;
}

export async function preparePhoto(filename: string, mime: string, size: number, strategy: ImageStrategy) {
  if ((await stat(filename)).size !== size) throw new Error("Image size does not match its upload");
  const limit = strategy === "creator-original" ? DOWNLOAD_BYTES : mediaPolicy.imageBytes;
  if (!Number.isSafeInteger(size) || size < 1 || size > limit)
    throw new MediaLimitError(`Images must be between 1 and ${limit.toLocaleString("en-US")} bytes.`);
  let metadata: Awaited<ReturnType<typeof validatePhoto>>;
  try {
    metadata = await validatePhoto(filename, mime, strategy);
  } catch (error) {
    if (error instanceof MediaLimitError) throw error;
    throw new InvalidPhotoError("Choose a valid, readable photo matching its declared file type.");
  }
  const source = await readFile(filename);
  let download = source;
  let outputMime = mime;
  // Suitable JPEG/WebP files already within budget need no second lossy encode.
  // JPEG originals in both operating models are immutable. Official standard
  // downloads are separate, temporary exports; previews never replace sources.
  const staticPhoto = (metadata.pages || 1) === 1 && !source.includes(Buffer.from("acTL")) &&
    !(metadata.format === "webp" && source.includes(Buffer.from("ANIM")));
  if (strategy === "official" && metadata.format !== "jpeg" && !(staticPhoto && size <= DOWNLOAD_BYTES && ["webp"].includes(metadata.format!))) {
    const started = Date.now();
    const candidate = await fitOfficialDownload(async (scale, quality) => {
      const remaining = 60_000 - (Date.now() - started);
      if (remaining < 1000)
        throw new MediaLimitError("Photo optimization exceeded its work budget. Provide a smaller source.");
      let image = sharp(source, inputOptions()).rotate().timeout({
        seconds: Math.min(20, Math.floor(remaining / 1000)),
      });
      if (scale < 1) image = image.resize({
        width: Math.max(1, Math.floor((metadata.autoOrient?.width ?? metadata.width!) * scale)),
        height: Math.max(1, Math.floor((metadata.autoOrient?.height ?? metadata.height!) * scale)),
        fit: "inside", withoutEnlargement: true,
        });
      return image.webp({quality, effort:4}).toBuffer();
    });
    // Do not inflate a small static PNG/GIF merely to change its format.
    if (!(staticPhoto && source.length <= DOWNLOAD_BYTES && source.length <= candidate.length)) {
      download = candidate;
      outputMime = "image/webp";
    }
  }
  let preview = Buffer.alloc(0);
  const edge = Math.min(mediaPolicy.thumbnailEdge, 640);
  // Derive the preview from the validated input, not a repeatedly encoded download.
  for (const scale of [1, 0.8, 0.6]) {
    for (const quality of [76, 62, 48, 36, 24]) {
      preview = await sharp(source, inputOptions()).rotate().timeout({seconds:20})
        .resize({width:Math.floor(edge*scale),height:Math.floor(edge*scale),fit:"inside",withoutEnlargement:true})
        .webp({quality,effort:5}).toBuffer();
      if (preview.length <= PREVIEW_BYTES) break;
    }
    if (preview.length <= PREVIEW_BYTES) break;
  }
  if (!preview.length || preview.length > PREVIEW_BYTES)
    throw new MediaLimitError("Thumbnail cannot fit the 100,000-byte preview budget.");
  return {download,preview,mimeType:outputMime};
}
