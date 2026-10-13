import sharp from "sharp";
import { mediaPolicy } from "./media-policy";
import { withMediaWorkBudget } from "./media-work-budget";
import { thumbnailCache, thumbnailDigest } from "./thumbnail-cache";

/** Hash source, not record ID: replacements and shared historical sources are safe. */
export async function legacyThumbnail(value: string) {
  if (value.length > Math.ceil(mediaPolicy.imageBytes * 4 / 3) + 100)
    throw new Error("Thumbnail exceeds image budget");
  const match = /^data:image\/(?:jpeg|png|gif|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value);
  if (!match) throw new Error("Unsupported thumbnail");
  return thumbnailCache.get(`legacy-72-${mediaPolicy.thumbnailEdge}-${thumbnailDigest(value)}`,
    () => withMediaWorkBudget(async () => {
      const input = Buffer.from(match[1], "base64");
      if (!input.length || input.length > mediaPolicy.imageBytes) throw new Error("Invalid image size");
      return sharp(input, { limitInputPixels: mediaPolicy.maxPixels })
        .rotate().resize({ width: mediaPolicy.thumbnailEdge, height: mediaPolicy.thumbnailEdge,
          fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    }));
}
