export type VideoFailureStage = "file_access" | "probe" | "frame_extraction" |
  "ai_request" | "result_parsing" | "database_read" | "database_persistence";

const messages = {
  SOURCE_PRIVATE_REQUIRED: "Video analysis requires a private stored original",
  SOURCE_BYTE_LIMIT: "Video exceeds analysis byte limit",
  SOURCE_READ_FAILED: "Video original could not be read",
  SOURCE_MISSING: "Video original is missing",
  SOURCE_ACCESS_DENIED: "Video storage access is unavailable",
  TEMP_STORAGE_BUSY: "Video temporary storage budget is busy",
  TOOL_MISSING: "Video tools unavailable or interrupted",
  TOOL_ACCESS_DENIED: "Video tools unavailable or interrupted",
  TOOL_INTERRUPTED: "Video tools unavailable or interrupted",
  TOOL_TIMEOUT: "Video decoding exceeded its process time budget",
  EXTRACTION_TIMEOUT: "Video extraction exceeded its overall time budget",
  TOOL_OUTPUT_LIMIT: "Video decoding exceeded its output budget",
  TOOL_OPTION_UNSUPPORTED: "Video decoding tool options are unsupported",
  CODEC_UNAVAILABLE: "Video decoding codec is unavailable",
  INPUT_UNSUPPORTED: "Video decoding failed: unsupported or invalid input",
  DECODE_FAILED: "Video decoding failed",
  PROBE_INVALID: "Video probe returned invalid output",
  DECODE_POLICY_LIMIT: "Video is unreadable or exceeds decode limits",
  FRAME_LIMIT: "Frame exceeds image budget",
  FRAME_EMPTY: "No readable video frames",
  FRAME_FAILED: "Video frame processing failed",
  AI_BATCH_LIMIT: "Video batch exceeds provider budget",
  AI_UNAVAILABLE: "AI recognition unavailable",
  AI_REQUEST_FAILED: "Video AI request failed",
  AI_OUTPUT_INVALID: "Invalid video recognition output",
  DATABASE_FAILED: "Video analysis database operation failed",
};
export type VideoFailureCode = keyof typeof messages;
type Details = { exitCode?: number | null; signal?: string | null; httpStatus?: number };

/** Only static labels and bounded scalar diagnostics; never provider bodies, URLs or stderr. */
export class VideoAnalysisFailure extends Error {
  readonly details: Details;
  constructor(readonly stage: VideoFailureStage, readonly code: VideoFailureCode,
    readonly retryable: boolean, details: Details = {}) {
    super(messages[code]);
    this.name = "VideoAnalysisFailure";
    this.details = {
      ...(Number.isInteger(details.exitCode) ? { exitCode: details.exitCode } : {}),
      ...(["SIGKILL","SIGTERM","SIGINT","SIGABRT","SIGSEGV"].includes(details.signal || "")
        ? {signal: details.signal} : {}),
      ...(Number.isInteger(details.httpStatus) && details.httpStatus! >= 400 && details.httpStatus! <= 599
        ? {httpStatus: details.httpStatus} : {}),
    };
  }
}

export function classifyVideoFailure(error: unknown, stage: VideoFailureStage): VideoAnalysisFailure {
  if (error instanceof VideoAnalysisFailure) return error;
  const value = error as { code?: string; status?: number } | null;
  if (stage === "file_access") {
    if (value?.code === "ENOENT" || value?.status === 404)
      return new VideoAnalysisFailure(stage,"SOURCE_MISSING",false);
    if (value?.code === "EACCES" || value?.code === "EPERM" || value?.status === 403)
      return new VideoAnalysisFailure(stage,"SOURCE_ACCESS_DENIED",false);
  }
  if (stage === "ai_request") {
    const status = value?.status;
    return new VideoAnalysisFailure(stage,"AI_REQUEST_FAILED",
      !(status && status >= 400 && status < 500 && status !== 408 && status !== 429), {httpStatus:status});
  }
  return new VideoAnalysisFailure(stage,
    stage === "file_access" ? "SOURCE_READ_FAILED" :
    stage === "result_parsing" ? "AI_OUTPUT_INVALID" :
    stage === "database_read" || stage === "database_persistence" ? "DATABASE_FAILED" : "FRAME_FAILED",true);
}

export function videoFailureRecord(mediaId: number, attempt: number, failure: VideoAnalysisFailure) {
  return { mediaId, attempt, stage:failure.stage, code:failure.code, retryable:failure.retryable, ...failure.details };
}
