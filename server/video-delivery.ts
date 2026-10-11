import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MediaLimitError } from "./media-policy";

export type ByteRange = { start: number; end: number };
export type VideoSource = { size: number; open: (range: ByteRange) => Readable };

/** One byte range only; multipart and malformed ranges are explicitly rejected. */
export function byteRange(header: string | undefined, size: number): ByteRange | null {
  if (!header) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  const a = Number(match[1]), b = Number(match[2]);
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return null;
  if (!match[1]) return b > 0 ? { start: Math.max(0, size - b), end: size - 1 } : null;
  if (a >= size || (match[2] && b < a)) return null;
  return { start: a, end: match[2] ? Math.min(b, size - 1) : size - 1 };
}

/** Decode only the requested legacy span in aligned, bounded Base64 chunks. */
export function legacyVideoSource(base64: string): VideoSource {
  const encoded = base64.replace(/[\r\n]/g, "");
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const size = encoded.length / 4 * 3 - padding;
  if (size > 100 * 1024 * 1024) throw new MediaLimitError("Video is too large to preview.");
  if (!Number.isSafeInteger(size) || size <= 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("Invalid legacy video");
  return { size, open: ({ start, end }) => Readable.from((function* () {
    const first = Math.floor(start / 3) * 4;
    const last = Math.ceil((end + 1) / 3) * 4;
    for (let offset = first; offset < last; offset += 65536) {
      const bytes = Buffer.from(encoded.slice(offset, Math.min(last, offset + 65536)), "base64");
      const position = offset / 4 * 3;
      yield bytes.subarray(Math.max(0, start - position), Math.min(bytes.length, end + 1 - position));
    }
  })()) };
}

/** Called only after the original route's visibility/auth/premium checks. */
export async function sendVideo(req: Request, res: Response, source: VideoSource) {
  res.setHeader("Accept-Ranges", "bytes");
  // No validator is advertised for these private responses: If-Range falls
  // back to a full response rather than claiming a matching representation.
  const header = req.headers["if-range"] ? undefined : req.headers.range;
  const range = byteRange(header, source.size);
  if (!range) {
    res.setHeader("Content-Range", `bytes */${source.size}`);
    res.status(416).end();
    return;
  }
  if (header) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${source.size}`);
  }
  res.setHeader("Content-Length", range.end - range.start + 1);
  if (req.method === "HEAD") { res.end(); return; }
  const controller = new AbortController();
  const close = () => { if (!res.writableFinished) controller.abort(); };
  res.once("close", close);
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    if (res.destroyed) return;
    await pipeline(source.open(range), res, { signal: controller.signal });
  } catch {
    if (!res.destroyed) {
      if (res.headersSent) res.destroy();
      else {
        res.removeHeader("Content-Length");
        res.removeHeader("Content-Range");
        res.status(502).end();
      }
    }
  } finally {
    clearTimeout(timer);
    res.off("close", close);
  }
}
