import type { Event, MediaItem } from "@shared/schema";
import { Readable } from "stream";
import { getMediaContentType, readMediaStream } from "./media-storage";
import { downloadFilename } from "./download-filename";
import { needsPreparedDownload, preparedDownload } from "./prepared-download";

function legacyImage(value: string) {
  if (!value || value.length > 140 * 1048576 + 100) throw new Error("Invalid legacy media");
  const match = /^data:(image\/(?:jpeg|png|webp|gif)|video\/(?:mp4|quicktime|webm));base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match || match[2].length > 140 * 1048576) throw new Error("Invalid legacy media");
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > 100 * 1048576) throw new Error("Invalid legacy media");
  return { data, contentType: match[1] };
}

export async function downloadStream(item: MediaItem, event: Pick<Event, "id" | "title" | "date"> & Partial<Pick<Event,"creatorId">>, quality: "high" | "low", signal?: AbortSignal) {
  const source = item.url;
  const key = /^\/api\/media\/files\/((?:media|thumb)-[0-9a-f-]{36}\.(?:jpg|png|webp|gif|mp4|mov|webm))$/.exec(source)?.[1];
  let contentType: string;
  let stream: Readable;
  if (quality === "low") {
    if (item.type !== "image") throw new Error("Low resolution is available for images only");
    const bytes = await preparedDownload(item, event, quality, () => {
      if (key) return readMediaStream(key);
      const legacy = legacyImage(source);
      if (!legacy.contentType.startsWith("image/")) throw new Error("Invalid photo source");
      return Readable.from(legacy.data);
    });
    signal?.throwIfAborted();
    contentType = "image/jpeg";
    stream = Readable.from(bytes);
    return { stream, contentType, filename: downloadFilename(item, event, quality, contentType) };
  }
  if (key) {
    contentType = getMediaContentType(key);
    stream = needsPreparedDownload(item,event,quality)
      ? Readable.from(await preparedDownload(item,event,quality,() => readMediaStream(key)))
      : readMediaStream(key);
  } else {
    // Historical database base64 needs server-side decoding; modern uploads
    // stream from object storage and never allocate a full-file buffer.
    let legacy = legacyImage(source?.startsWith("data:") ? source : item.url);
    contentType = legacy.contentType;
    stream = Readable.from(legacy.data);
  }
  return { stream, contentType, filename: downloadFilename(item, event, quality, contentType) };
}

/** Size inspection never authorizes a download or updates its statistics. */
export async function downloadInformation(item: MediaItem, event: Event, quality: "high" | "low") {
  if (needsPreparedDownload(item,event,quality)) {
    const key = /^\/api\/media\/files\/((?:media|thumb)-[0-9a-f-]{36}\.(?:jpg|png|webp|gif))$/.exec(item.url)?.[1];
    const bytes = await preparedDownload(item,event,quality,() =>
      key ? readMediaStream(key) : Readable.from(legacyImage(item.url).data));
    return { bytes: bytes.length };
  }
  if (item.url.startsWith("data:")) return { bytes: legacyImage(item.url).data.length };
  // These are measured upload sizes of immutable, byte-identical sources,
  // not the thumbnail size or an estimate of an encoded export.
  return { bytes: Number.isSafeInteger(item.highBytes) && item.highBytes! > 0 ? item.highBytes : null };
}
