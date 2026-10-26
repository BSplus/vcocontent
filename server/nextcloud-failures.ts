import { MediaLimitError } from "./media-policy";
import { MediaBusyError } from "./media-work-budget";
import { VideoAnalysisFailure } from "./video-failures";

export type ImportStage = "download" | "validation" | "probe" | "poster" | "reservation" | "storage" | "commit";
const messages = {
  FILE_LIMIT: "File size limit exceeded. Check the configured image or video limit.",
  TRANSFER_LIMIT: "Source transfer budget exceeded. Import fewer new files in this run.",
  DOWNLOAD_FAILED: "Nextcloud download failed or timed out. Check access and retry this file.",
  DOWNLOAD_EMPTY: "Nextcloud returned an empty file. Check the source file.",
  DOWNLOAD_TRUNCATED: "Nextcloud download was incomplete. Retry this file.",
  VALIDATION_FAILED: "File content does not match a supported, readable media format.",
  EVENT_LIMIT: "Event storage or item budget exceeded, including existing media and active reservations.",
  STORAGE_UNAVAILABLE: "Storage is unavailable or new uploads are disabled. The operator must check storage readiness.",
  RESERVATION_FAILED: "Storage reservation failed. Check storage availability and retry.",
  STORAGE_FAILED: "Original or poster could not be stored. Check storage access and retry.",
  COMMIT_FAILED: "Media could not be committed. Retry after checking database availability.",
  PROCESSING_BUSY: "Media processing is busy. Retry shortly.",
  POSTER_FAILED: "A readable video poster could not be generated. Check the video and retry.",
  TOOL_MISSING: "Video tools are missing. The operator must provide FFmpeg and FFprobe.",
  TOOL_ACCESS_DENIED: "Video tools cannot be executed. The operator must check tool permissions.",
  TOOL_OPTION_UNSUPPORTED: "Installed video tools do not support the required options. Check FFmpeg compatibility.",
  CODEC_UNAVAILABLE: "The installed video tools cannot decode this codec. Check codec support.",
  TOOL_TIMEOUT: "Video validation or poster generation timed out. Retry or check video complexity.",
  VIDEO_INVALID: "Video is unreadable, unsupported or exceeds the decode policy.",
};
type Code = keyof typeof messages;
export type ImportFailure = { stage: ImportStage; code: Code; message: string };
export class NextcloudFileFailure extends Error {
  constructor(readonly code: Code) { super(messages[code]); }
}

export function importFailure(error: unknown, stage: ImportStage): ImportFailure {
  let code: Code;
  if (error instanceof NextcloudFileFailure) code = error.code;
  else if (error instanceof VideoAnalysisFailure) {
    stage = error.stage === "probe" ? "probe" : "poster";
    code = (["TOOL_MISSING", "TOOL_ACCESS_DENIED", "TOOL_OPTION_UNSUPPORTED", "CODEC_UNAVAILABLE",
      "TOOL_TIMEOUT"] as string[]).includes(error.code) ? error.code as Code :
      stage === "probe" ? "VIDEO_INVALID" : "POSTER_FAILED";
  } else if (error instanceof MediaBusyError) code = "PROCESSING_BUSY";
  else if (error instanceof MediaLimitError)
    code = error.code ? "STORAGE_UNAVAILABLE" :
      stage === "reservation" || stage === "commit" ? "EVENT_LIMIT" : "FILE_LIMIT";
  else code = stage === "download" ? "DOWNLOAD_FAILED" : stage === "validation" ? "VALIDATION_FAILED" :
    stage === "poster" ? "POSTER_FAILED" : stage === "reservation" ? "RESERVATION_FAILED" :
    stage === "commit" ? "COMMIT_FAILED" : "STORAGE_FAILED";
  return { stage, code, message: messages[code] };
}

// Versioned safe envelope in the existing private message column. No schema
// rollout is needed; old rows retain their original human-readable message.
const prefix = "nc-failure-v1:";
export function encodeImportFailure(failure: ImportFailure): string {
  return prefix + JSON.stringify({ stage: failure.stage, code: failure.code });
}
export function decodeImportFailure(message: string | null): { message: string | null; failure?: ImportFailure } {
  if (!message?.startsWith(prefix)) return { message };
  try {
    const data = JSON.parse(message.slice(prefix.length));
    if (!["download", "validation", "probe", "poster", "reservation", "storage", "commit"].includes(data.stage) ||
      !Object.hasOwn(messages, data.code)) throw new Error("Invalid envelope");
    const failure = { stage: data.stage as ImportStage, code: data.code as Code, message: messages[data.code as Code] };
    return { message: failure.message, failure };
  } catch { return { message: "Import failed. Retry this file to obtain a current diagnosis." }; }
}
