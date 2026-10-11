import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import { readMediaStream } from "./media-storage";
import { mediaPolicy } from "./media-policy";
import { VideoAnalysisFailure, classifyVideoFailure, type VideoFailureStage } from "./video-failures";
import { videoTool, probeVideoFile } from "./video-tools";
export { videoTool } from "./video-tools";

export const SAMPLING_VERSION = "video-scenes-v1";
const root = path.join(tmpdir(), "vco-video-analysis");
export type VideoFrame = { timestamp: number; image: string; hash: string };
export const frameTarget = (duration: number) => duration < 2 ? 3 : duration <= 30 ? 5 : duration <= 180 ? 8 : 12;

/** Only stale interrupted directories are swept; live extraction has a 75s deadline. */
export async function cleanupVideoTemps() {
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const name of await readdir(root)) {
    if (!/^job-[A-Za-z0-9]+$/.test(name)) continue;
    const directory = path.join(root, name);
    if ((await stat(directory)).mtimeMs < Date.now() - 5 * 60_000)
      await rm(directory, { recursive: true, force: true });
  }
}

export async function sampleVideo(item: { url: string }, consume: (value: {
  frames: VideoFrame[]; sourceHash: string; duration: number; samplingMs: number;
}) => Promise<void>, reader = readMediaStream) {
  const key = /^\/api\/media\/files\/(media-[0-9a-f-]{36}\.(?:mp4|mov|webm))$/.exec(item.url)?.[1];
  if (!key) throw new VideoAnalysisFailure("file_access","SOURCE_PRIVATE_REQUIRED",false);
  await cleanupVideoTemps();
  // Stop rapid restart cycles from accumulating originals before the stale
  // cleanup grace expires. With two database-wide workers this admits at most
  // five directories even when both race at the four-directory threshold.
  if ((await readdir(root)).filter(name => /^job-[A-Za-z0-9]+$/.test(name)).length >= 4)
    throw new VideoAnalysisFailure("file_access","TEMP_STORAGE_BUSY",true);
  const directory = await mkdtemp(path.join(root, "job-"));
  const controller = new AbortController();
  let extractionTimedOut=false;
  const timer = setTimeout(() => { extractionTimedOut=true; controller.abort(); }, 75000);
  const started = Date.now();
  let stage: VideoFailureStage = "file_access";
  let samplingComplete = false;
  try {
    const original = path.join(directory, "original");
    let bytes = 0;
    const digest = createHash("sha256");
    await pipeline(reader(key), new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > mediaPolicy.videoBytes) return callback(new VideoAnalysisFailure("file_access","SOURCE_BYTE_LIMIT",false));
      digest.update(chunk); callback(null, chunk);
    } }), createWriteStream(original, { mode: 0o600 }), { signal: controller.signal });
    stage="probe";
    const { duration } = await probeVideoFile(original, controller.signal);
    stage="frame_extraction";
    const frames: VideoFrame[] = [];
    const signatures: Buffer[] = [];
    const count = frameTarget(duration);
    for (let i = 0; i < count; i++) {
      const start = duration * i / count;
      const output = path.join(directory, "frame.jpg");
      // Prefer the first scene change in a bounded local window, not a scan of the whole clip.
      const window = Math.min(1, duration - start);
      const base = ["-v", "error", "-nostdin", "-threads", "1", "-protocol_whitelist", "file",
        "-format_whitelist", "mov,matroska,webm",
        "-ss", String(start), "-t", String(window), "-i", original, "-an", "-sn", "-dn",
        "-filter_threads", "1", "-fps_mode", "passthrough"];
      const sceneInfo = await videoTool("ffmpeg", [...base, "-v", "info", "-vf",
        "select='gt(scene,0.18)',showinfo,scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease",
        "-frames:v", "1", "-q:v", "5", "-fs", "524288", "-y", output], controller.signal, true);
      let timestamp = start;
      if (await stat(output).catch(() => null)) {
        const pts = /pts_time:([0-9.]+)/.exec(sceneInfo)?.[1];
        if (pts) timestamp = start + Number(pts);
      } else {
        const fallbackInfo = await videoTool("ffmpeg", [...base, "-v", "info", "-vf",
          "showinfo,scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease",
          "-frames:v", "1", "-q:v", "5", "-fs", "524288", "-y", output], controller.signal, true);
        const pts = /pts_time:([0-9.]+)/.exec(fallbackInfo)?.[1];
        if (pts) timestamp = start + Number(pts);
      }
      // Low-frame-rate/very-short clips may have no later presentation frame.
      // The first sample starts at zero, so a readable clip still has evidence.
      if (!await stat(output).catch(() => null)) continue;
      const image = await readFile(output);
      if (!image.length || image.length > 524288) throw new VideoAnalysisFailure("frame_extraction","FRAME_LIMIT",false);
      const signature: Buffer = await sharp(image).resize(16, 16, { fit: "fill" }).removeAlpha().raw().toBuffer();
      const duplicate = signatures.some(prior => signature.reduce((sum, value, j) => sum + Math.abs(value - prior[j]), 0) / signature.length < 4);
      if (!duplicate) {
        signatures.push(signature);
        frames.push({ timestamp, hash: createHash("sha256").update(image).digest("hex"),
          image: `data:image/jpeg;base64,${image.toString("base64")}` });
      }
      await rm(output, { force: true });
    }
    if (!frames.length) throw new VideoAnalysisFailure("frame_extraction","FRAME_EMPTY",false);
    clearTimeout(timer);
    samplingComplete=true;
    await consume({ frames, sourceHash: digest.digest("hex"), duration, samplingMs: Date.now() - started });
  } catch (error) {
    // Callback failures keep their AI/database stage rather than becoming decoder failures.
    throw samplingComplete ? error : extractionTimedOut
      ? new VideoAnalysisFailure(stage,"EXTRACTION_TIMEOUT",true) : classifyVideoFailure(error,stage);
  } finally {
    clearTimeout(timer);
    controller.abort();
    await rm(directory, { recursive: true, force: true });
  }
}
