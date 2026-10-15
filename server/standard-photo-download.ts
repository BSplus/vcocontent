import sharp from "sharp";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fitOfficialDownload } from "./image-downloads";
import { mediaPolicy, MediaLimitError } from "./media-policy";
import { withMediaWorkBudget } from "./media-work-budget";

/**
 * Privacy-filtered standard export, NOT an exact-original/metadata export.
 * Keep original bytes private and immutable, and retain the existing 5-MB
 * official download ladder. No persistent third object or full-source buffer.
 */
export async function standardPhotoDownload(open: () => Readable, requestSignal?: AbortSignal) {
  const signal = AbortSignal.any([AbortSignal.timeout(75_000), ...(requestSignal ? [requestSignal] : [])]);
  return withMediaWorkBudget(async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "vco-standard-download-"));
    try {
      signal.throwIfAborted();
      const filename = path.join(directory, "source");
      let size = 0;
      const limit = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          callback(size > mediaPolicy.imageBytes
            ? new MediaLimitError("Photo exceeds the standard download input limit.") : null, chunk);
        },
      });
      await pipeline(open(), limit, createWriteStream(filename), { signal });
      if (!size) throw new MediaLimitError("The photo source is empty.");
      const options = { limitInputPixels: mediaPolicy.maxPixels, failOn: "warning" as const };
      const probe = sharp(filename, options).timeout({ seconds: 10 });
      const cancelProbe = () => probe.destroy();
      signal.addEventListener("abort", cancelProbe, { once: true });
      let metadata: Awaited<ReturnType<typeof probe.metadata>>;
      try { metadata = await probe.metadata(); signal.throwIfAborted(); }
      finally { signal.removeEventListener("abort", cancelProbe); }
      if (metadata.format !== "jpeg" || !metadata.width || !metadata.height)
        throw new MediaLimitError("The original is not a readable JPEG.");
      const started = Date.now();
      return await fitOfficialDownload(async (scale, quality) => {
        signal.throwIfAborted();
        const remaining = 60_000 - (Date.now() - started);
        if (remaining < 1000) throw new MediaLimitError("Standard photo export timed out. Please retry.");
        let image = sharp(filename, options).rotate()
          .timeout({ seconds: Math.min(20, Math.floor(remaining / 1000)) });
        if (scale < 1) image = image.resize({
          width: Math.max(1, Math.floor((metadata.autoOrient?.width ?? metadata.width!) * scale)),
          height: Math.max(1, Math.floor((metadata.autoOrient?.height ?? metadata.height!) * scale)),
          fit: "inside", withoutEnlargement: true,
        });
        // Sharp strips EXIF/IPTC/XMP by default. Never use keepMetadata here.
        const cancel = () => image.destroy();
        signal.addEventListener("abort", cancel, { once: true });
        try {
          const bytes = await image.jpeg({ quality, chromaSubsampling: "4:4:4" }).toBuffer();
          signal.throwIfAborted();
          return bytes;
        } finally { signal.removeEventListener("abort", cancel); }
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, signal);
}
