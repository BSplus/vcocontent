import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { videoTool, probeVideoFile } from "./video-tools";
import { mediaPolicy } from "./media-policy";
import { VideoAnalysisFailure } from "./video-failures";

export async function videoFrameThumbnail(image: Buffer): Promise<Buffer> {
  if (!image.length || image.length > 524288) throw new VideoAnalysisFailure("frame_extraction", "FRAME_LIMIT", false);
  for (const quality of [76, 62, 48, 36, 24]) {
    const output = await sharp(image, { limitInputPixels: mediaPolicy.maxPixels, failOn: "error" }).rotate()
      .resize({ width: mediaPolicy.thumbnailEdge, height: mediaPolicy.thumbnailEdge,
        fit: "inside", withoutEnlargement: true }).webp({ quality }).toBuffer();
    if (output.length < 100 * 1024) return output;
  }
  throw new VideoAnalysisFailure("frame_extraction", "FRAME_LIMIT", false);
}

/** Upload's private local file; no second original download, remote URLs or placeholder. */
export async function createVideoPreview(filename: string): Promise<Buffer> {
  const directory = await mkdtemp(path.join(tmpdir(), "vco-video-preview-"));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65000);
  try {
    const { duration } = await probeVideoFile(filename, controller.signal);
    const frame = path.join(directory, "frame.jpg");
    for (const start of [Math.min(1, duration / 5), 0]) {
      await videoTool("ffmpeg", ["-v", "error", "-nostdin", "-threads", "1",
        "-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm",
        "-ss", String(start), "-t", String(Math.min(1, duration - start)), "-i", filename,
        "-map", "0:v:0", "-an", "-sn", "-dn", "-filter_threads", "1", "-fps_mode", "passthrough",
        "-vf", "scale=w='min(640,iw)':h='min(640,ih)':force_original_aspect_ratio=decrease",
        "-frames:v", "1", "-q:v", "5", "-fs", "524288", "-y", frame], controller.signal);
      const info = await stat(frame).catch(() => null);
      if (info?.size && info.size <= 524288) return videoFrameThumbnail(await readFile(frame));
    }
    throw new VideoAnalysisFailure("frame_extraction", "FRAME_EMPTY", false);
  } finally {
    clearTimeout(timer); controller.abort();
    await rm(directory, { recursive: true, force: true });
  }
}
