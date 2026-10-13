import sharp from "sharp";
import { createWriteStream } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { mediaPolicy, MediaLimitError } from "./media-policy";
import { withMediaWorkBudget } from "./media-work-budget";
import { HIGH_QUALITIES } from "./image-downloads";

export const LOW_DOWNLOAD_BYTES = 500_000;
export const LOW_DOWNLOAD_EDGE = 1600;
export const LOW_SOURCE_BYTES = 100 * 1048576; // Existing historical input ceiling.
export class LowResolutionError extends Error {}

/** Shared deterministic ladder: highest fitting quality wins, then bounded resize. */
export async function fitLowResolution(encode: (edge: number, quality: number) => Promise<Buffer>) {
  for (const edge of [LOW_DOWNLOAD_EDGE, 1280, 960]) {
    for (const quality of HIGH_QUALITIES) {
      const bytes = await encode(edge, quality);
      if (bytes.length && bytes.length <= LOW_DOWNLOAD_BYTES) return bytes;
    }
  }
  throw new LowResolutionError("This photo cannot fit the Low-Res download limit. Please use High-Res.");
}

export async function prepareLowResolution(source: string | Buffer, signal: AbortSignal) {
  const started = Date.now();
  const options = { limitInputPixels: mediaPolicy.maxPixels, failOn: "warning" as const };
  signal.throwIfAborted();
  const probe = sharp(source, options).timeout({ seconds: 10 });
  // Sharp's promise APIs do not consume stream 'error' events, and destroy()
  // cannot interrupt an already-running native buffer operation. Do not emit
  // an unhandled error or release its CPU slot before native work settles.
  const cancelProbe = () => probe.destroy();
  signal.addEventListener("abort", cancelProbe, { once: true });
  let metadata: Awaited<ReturnType<typeof probe.metadata>>;
  try { metadata = await probe.metadata(); signal.throwIfAborted(); }
  catch {
    throw new LowResolutionError("This photo is not readable or exceeds the pixel limit. Please use another version.");
  } finally { signal.removeEventListener("abort", cancelProbe); }
  if (!["jpeg", "png", "webp", "gif"].includes(metadata.format || "") || !metadata.width || !metadata.height)
    throw new LowResolutionError("This photo is not readable. Please use another version.");
  return fitLowResolution(async (edge, quality) => {
    signal.throwIfAborted();
    const remaining = 30_000 - (Date.now() - started);
    if (remaining < 1000) throw new LowResolutionError("Low-Res processing timed out. Please retry or use High-Res.");
    const image = sharp(source, options).rotate()
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .timeout({ seconds: Math.min(10, Math.floor(remaining / 1000)) })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, chromaSubsampling: "4:4:4" });
    const cancel = () => image.destroy();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const bytes = await image.toBuffer();
      signal.throwIfAborted();
      return bytes;
    }
    catch (error) {
      if (error instanceof LowResolutionError) throw error;
      throw new LowResolutionError("Low-Res processing failed. The photo may be damaged or too large; try High-Res.");
    } finally { signal.removeEventListener("abort", cancel); }
  });
}

/** Acquire CPU slot before opening storage. Spool bounded input to temporary disk,
 * never a third persistent object or a full 100-MiB buffer. Queue/read/encode
 * share a 45-second deadline; disconnected requests are removed from the queue. */
export async function lowResolutionDownload(open: () => Readable, requestSignal?: AbortSignal) {
  const signal = AbortSignal.any([AbortSignal.timeout(45_000), ...(requestSignal ? [requestSignal] : [])]);
  try { return await withMediaWorkBudget(async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "vco-low-download-"));
    try {
      signal.throwIfAborted();
      const filename = path.join(directory, "source");
      let size = 0;
      const limit = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          callback(size > LOW_SOURCE_BYTES ? new MediaLimitError("Photo exceeds the Low-Res input limit. Please use High-Res.") : null, chunk);
        },
      });
      await pipeline(open(), limit, createWriteStream(filename), { signal });
      if (!size) throw new LowResolutionError("The photo source is empty.");
      return await prepareLowResolution(filename, signal);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, signal); }
  catch (error) {
    if (signal.aborted) throw new LowResolutionError("Low-Res download timed out or was cancelled. Please retry or use High-Res.");
    throw error;
  }
}
