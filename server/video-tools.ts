import { spawn } from "node:child_process";
import { VideoAnalysisFailure } from "./video-failures";
import { mediaPolicy } from "./media-policy";

/** Separate bounded budgets: a cold probe on the small VM can exceed eight seconds. */
export const videoToolTimeout = (tool: "ffmpeg" | "ffprobe") => tool === "ffprobe" ? 30000 : 15000;
export function videoTool(tool: "ffmpeg" | "ffprobe", args: string[], signal?: AbortSignal, diagnostics = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { stdio: ["ignore", "pipe", "pipe"], signal });
    let output = ""; let size = 0;
    let stderr = ""; let timedOut = false; let outputLimited = false;
    const stage = tool === "ffprobe" ? "probe" : "frame_extraction";
    const timer = setTimeout(() => { timedOut=true; child.kill("SIGKILL"); }, videoToolTimeout(tool));
    const collect = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65536) { outputLimited=true; child.kill("SIGKILL"); }
      else output += chunk.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", chunk => {
      stderr=(stderr+chunk.toString()).slice(-8192);
      if (diagnostics) collect(chunk);
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new VideoAnalysisFailure(stage,
        error.code==="ENOENT" ? "TOOL_MISSING" :
        error.code==="EACCES" || error.code==="EPERM" ? "TOOL_ACCESS_DENIED" : "TOOL_INTERRUPTED",
        !["ENOENT","EACCES","EPERM"].includes(error.code || "")));
    });
    child.once("close", (code, exitSignal) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut && !outputLimited) return resolve(output);
      const failureCode = timedOut ? "TOOL_TIMEOUT" : outputLimited ? "TOOL_OUTPUT_LIMIT" :
        /unrecognized option|option .* not found/i.test(stderr) ? "TOOL_OPTION_UNSUPPORTED" :
        /unknown decoder|decoder .* not found|decoding requested, but no decoder found/i.test(stderr) ? "CODEC_UNAVAILABLE" :
        /invalid data found when processing input|not on whitelist|moov atom not found|unsupported codec/i.test(stderr) ? "INPUT_UNSUPPORTED" :
        exitSignal ? "TOOL_INTERRUPTED" : "DECODE_FAILED";
      reject(new VideoAnalysisFailure(stage,failureCode,
        !["TOOL_OUTPUT_LIMIT","TOOL_OPTION_UNSUPPORTED","CODEC_UNAVAILABLE","INPUT_UNSUPPORTED"].includes(failureCode),
        {exitCode:code,signal:exitSignal}));
    });
  });
}

export async function probeVideoFile(filename: string, signal?: AbortSignal) {
  // FFprobe's automatic decoder threading follows host cores, not VM CPU quota.
  const output = await videoTool("ffprobe", ["-v", "error", "-threads", "1",
    "-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm", "-select_streams", "v:0",
    "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", filename], signal);
  let probe;
  try { probe = JSON.parse(output); } catch { throw new VideoAnalysisFailure("probe", "PROBE_INVALID", false); }
  const duration = Number(probe?.format?.duration);
  const stream = probe?.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
  if (!Number.isFinite(duration) || duration <= 0 || duration > 21600 || !stream ||
    !stream.width || !stream.height || stream.width * stream.height > mediaPolicy.maxPixels)
    throw new VideoAnalysisFailure("probe", "DECODE_POLICY_LIMIT", false);
  return { duration, width: stream.width as number, height: stream.height as number };
}
