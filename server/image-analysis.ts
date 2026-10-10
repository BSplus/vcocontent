import { readMediaStream } from "./media-storage";
import sharp from "sharp";
import { mediaPolicy } from "./media-policy";

/** Number recognition needs more than the gallery's 640px thumbnail. */
export async function recognitionImageInput(item: { url: string; thumbnail: string }): Promise<string> {
  const key = /^\/api\/media\/files\/(media-[0-9a-f-]{36}\.(?:jpg|png|webp|gif))$/.exec(item.url)?.[1];
  let bytes: Buffer;
  if (key) {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of readMediaStream(key)) {
      size += chunk.length;
      if (size > mediaPolicy.imageBytes) throw new Error("Image exceeds recognition limit");
      chunks.push(Buffer.from(chunk));
    }
    bytes = Buffer.concat(chunks);
  } else if (/^data:image\/(?:jpeg|png|webp);base64,/.test(item.url)) {
    bytes = Buffer.from(item.url.split(",")[1], "base64");
    if (bytes.length > mediaPolicy.imageBytes) throw new Error("Image exceeds recognition limit");
  } else return analysisImageInput(item.thumbnail);
  const thumbnail = await sharp(bytes, { limitInputPixels: mediaPolicy.maxPixels }).rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  return `data:image/webp;base64,${thumbnail.toString("base64")}`;
}

export async function analysisImageInput(url: string): Promise<string> {
  const key = /^\/api\/media\/files\/(thumb-[0-9a-f-]{36}\.webp)$/.exec(url)?.[1];
  if (!key) {
    if (/^https:\/\//.test(url) || /^data:image\/(jpeg|png|webp);base64,/.test(url)) return url;
    throw new Error("No analyzable image thumbnail");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of readMediaStream(key)) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 5 * 1024 * 1024) throw new Error("Thumbnail exceeds analysis limit");
    chunks.push(bytes);
  }
  return `data:image/webp;base64,${Buffer.concat(chunks).toString("base64")}`;
}