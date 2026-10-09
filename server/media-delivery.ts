import type { MediaItem } from "@shared/schema";
import { Readable } from "stream";
import sharp from "sharp";
import { getMediaContentType, readMediaStream } from "./media-storage";
import { topShotDownloadName } from "../client/src/lib/top-shot-download";

function legacyImage(value: string) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif)|video\/(?:mp4|quicktime|webm));base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match || match[2].length > 140 * 1048576) throw new Error("Invalid legacy media");
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > 100 * 1048576) throw new Error("Invalid legacy media");
  return { data, contentType: match[1] };
}

export async function downloadStream(item: MediaItem, quality: "high" | "low") {
  const source = quality === "low" ? item.thumbnail : item.url;
  const key = /^\/api\/media\/files\/((?:media|thumb)-[0-9a-f-]{36}\.(?:jpg|png|webp|gif|mp4|mov|webm))$/.exec(source)?.[1];
  let contentType: string;
  let stream: Readable;
  if (key) {
    contentType = getMediaContentType(key);
    stream = await readMediaStream(key);
  } else {
    // Historical database base64 needs server-side decoding; modern uploads
    // stream from object storage and never allocate a full-file buffer.
    let legacy = legacyImage(source?.startsWith("data:") ? source : item.url);
    if (quality === "low") legacy = { data: await sharp(legacy.data, { limitInputPixels: 40000000 })
      .rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 76 }).toBuffer(), contentType: "image/webp" };
    contentType = legacy.contentType;
    stream = Readable.from(legacy.data);
  }
  return { stream, contentType, filename: topShotDownloadName(item, quality, source, contentType) };
}
