import { randomUUID } from "crypto";
import { withMediaWorkBudget } from "./media-work-budget";
import { mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { Readable } from "stream";
import { unlink } from "fs/promises";
import multer, { type Multer } from "multer";
import sharp from "sharp";
import { Client } from "@replit/object-storage";
import { mediaPolicy, MediaLimitError } from "./media-policy";

const TEMP_UPLOAD_DIR = path.join(tmpdir(), "vco-media-uploads");

export type MediaType = "image" | "video";

export interface StoredMedia {
  /** App route URL; storage objects are not exposed as public bucket URLs. */
  url: string;
  /** App route URL for a generated image thumbnail or video poster. */
  thumbnail: string;
  /** Private App Storage object key for the original file. */
  storageKey: string;
  /** Private App Storage object key for its thumbnail. */
  thumbnailKey: string;
  mediaType: MediaType;
  mimeType: string;
  size: number;
  storedBytes: number;
  highBytes: number;
  lowBytes: number;
  objectCount: number;
}

let storageClient: Client | undefined;

function getStorageClient(): Client {
  // Replit App Storage resolves the current app's default bucket automatically.
  return (storageClient ??= new Client());
}

mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

/**
 * Multipart parser for the eventual POST /api/events/:eventId/media/upload
 * route. Files are written to a temporary disk path (not held in RAM) and
 * always removed by uploadMedia after they are persisted or rejected.
 */
export const mediaUpload: Multer = multer({
  storage: multer.diskStorage({
    destination: TEMP_UPLOAD_DIR,
    filename: (_req, _file, callback) => callback(null, randomUUID()),
  }),
  limits: {
    fileSize: Math.max(mediaPolicy.videoBytes, mediaPolicy.imageBytes),
    files: 1,
    fields: 10,
    parts: 12,
  },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set([
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/quicktime",
      "video/webm",
    ]);
    if (!allowed.has(file.mimetype)) {
      callback(new Error("Unsupported media type. Use JPEG, PNG, GIF, WebP, MP4, MOV, or WebM."));
      return;
    }
    callback(null, true);
  },
});

function assertStoredKey(key: string): void {
  // Keep callers from using this helper as an arbitrary object-store reader.
  if (!/^(media|thumb)-[0-9a-f-]{36}\.(jpg|png|gif|webp|mp4|mov|webm)$/.test(key)
    && !/^ref-[0-9a-f-]{36}\.(csv|xlsx|pdf|png|jpg|jpeg|webp)$/.test(key)) {
    throw new Error("Invalid media storage key");
  }
}

function checkUploadResult(result: { ok: boolean; error?: unknown }, label: string): void {
  if (!result.ok) {
    const message = result.error instanceof Error
      ? result.error.message
      : typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error);
    throw new Error(`Could not store ${label}: ${message || "Unknown storage error"}`);
  }
}

function detectMediaType(file: Express.Multer.File): MediaType {
  if (file.mimetype.startsWith("image/")) return "image";
  if (file.mimetype.startsWith("video/")) return "video";
  throw new Error("Unsupported media type");
}

async function validateFileSignature(file: Express.Multer.File, type: MediaType): Promise<void> {
  const expectedMimes: Record<MediaType, string[]> = {
    image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    video: ["video/mp4", "video/quicktime", "video/webm"],
  };
  if (!expectedMimes[type].includes(file.mimetype)) {
    throw new Error(`The uploaded file does not match the selected ${type} type`);
  }

  if (type === "image") {
    const metadata = await sharp(file.path, {
      limitInputPixels: mediaPolicy.maxPixels,
      failOn: "error",
    }).metadata();
    if (!metadata.width || !metadata.height || !metadata.format) {
      throw new Error("The uploaded image is invalid or unsupported");
    }
    const validFormats = new Set(["jpeg", "png", "gif", "webp"]);
    if (!validFormats.has(metadata.format)) {
      throw new Error("The uploaded file is not a supported image");
    }
    if (metadata.width * metadata.height > mediaPolicy.maxPixels) {
      throw new MediaLimitError(`Image exceeds ${mediaPolicy.maxPixels / 1_000_000} megapixels`);
    }
    const mimeFormat = file.mimetype === "image/jpeg" ? "jpeg" : file.mimetype.split("/")[1];
    if (mimeFormat !== metadata.format) throw new Error("Image content does not match its file type");
    return;
  }

  // QuickTime and MP4 are ISO base media containers identified by `ftyp`;
  // WebM starts with the EBML signature. Do not trust a client-supplied MIME.
  const header = Buffer.alloc(12);
  const fs = await import("fs/promises");
  const handle = await fs.open(file.path, "r");
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  const isIsoMedia = header.toString("ascii", 4, 8) === "ftyp";
  const isWebm = header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  const isQuicktime = isIsoMedia && header.toString("ascii", 8, 12) === "qt  ";
  if (!((file.mimetype === "video/mp4" && isIsoMedia && !isQuicktime)
      || (file.mimetype === "video/quicktime" && isQuicktime)
      || (file.mimetype === "video/webm" && isWebm))) {
    throw new Error("The uploaded file is not a supported video");
  }
}

async function uploadFromFilename(objectName: string, filename: string): Promise<void> {
  const result = await getStorageClient().uploadFromFilename(
    objectName,
    filename,
    { compress: false },
  );
  checkUploadResult(result, objectName);
}

/**
 * Saves a verified upload to private, persistent App Storage and returns
 * opaque keys/URLs for database metadata. The caller must authorize access to
 * those URLs in the media-serving route; never make a bucket public.
 */
export async function uploadMedia(
  file: Express.Multer.File,
  type?: MediaType,
  keys?: { storageKey: string; thumbnailKey: string },
): Promise<StoredMedia> {
  return withMediaWorkBudget(() => performUploadMedia(file, type, keys));
}

async function performUploadMedia(
  file: Express.Multer.File,
  type?: MediaType,
  keys?: { storageKey: string; thumbnailKey: string },
): Promise<StoredMedia> {
  const tempPaths = new Set<string>([file.path]);
  let generatedKeys: { storageKey: string; thumbnailKey: string } | undefined;
  try {
    const actualType = detectMediaType(file);
    if (type && type !== actualType) {
      throw new Error("The uploaded file does not match the selected media type");
    }
    const mediaType = type ?? actualType;
    const maxBytes = mediaType === "image" ? mediaPolicy.imageBytes : mediaPolicy.videoBytes;
    if (!file.size || file.size > maxBytes) {
      throw new MediaLimitError(`File must be between 1 byte and ${Math.floor(maxBytes / (1024 * 1024))} MiB`);
    }
    await validateFileSignature(file, mediaType);

    const { storageKey, thumbnailKey } = keys ?? createMediaKeys(file.mimetype);
    if (!keys) generatedKeys = { storageKey, thumbnailKey };
    let storedBytes = file.size;
    let thumbnailBytes = 0;

    if (mediaType === "image") {
      const displayPath = path.join(TEMP_UPLOAD_DIR, `${randomUUID()}.webp`);
      tempPaths.add(displayPath);
      // Never persist the input as a second "original": paid originals require
      // an explicit product decision before this free-only upload path changes.
      let display = Buffer.alloc(0);
      for (const quality of [86, 76, 64, 52, 40]) {
        display = await sharp(file.path, { limitInputPixels: mediaPolicy.maxPixels, failOn: "error" })
          .rotate().resize({ width: mediaPolicy.displayEdge, height: mediaPolicy.displayEdge, fit: "inside", withoutEnlargement: true })
          .webp({ quality, effort: 4 }).toBuffer();
        if (display.length <= 4 * 1024 * 1024) break;
      }
      if (!display.length || display.length > 4 * 1024 * 1024) throw new MediaLimitError("Image cannot fit the 4 MiB display budget");
      const { writeFile } = await import("fs/promises");
      await writeFile(displayPath, display);
      storedBytes = display.length;
      const thumbnailPath = path.join(TEMP_UPLOAD_DIR, `${randomUUID()}.webp`);
      tempPaths.add(thumbnailPath);
      let thumb = Buffer.alloc(0);
      for (const quality of [76, 62, 48, 36, 24]) {
        thumb = await sharp(display).resize({ width: mediaPolicy.thumbnailEdge, height: mediaPolicy.thumbnailEdge, fit: "inside", withoutEnlargement: true })
          .webp({ quality, effort: 5 }).toBuffer();
        if (thumb.length < 100 * 1024) break;
      }
      if (!thumb.length || thumb.length >= 100 * 1024) throw new MediaLimitError("Thumbnail cannot fit the 100 KiB budget");
      await writeFile(thumbnailPath, thumb);
      thumbnailBytes = thumb.length;
      await uploadFromFilename(storageKey, displayPath);
      await uploadFromFilename(thumbnailKey, thumbnailPath);
    } else {
      await uploadFromFilename(storageKey, file.path);
      // There is no video-frame extractor in this app yet. Save a small,
      // generic poster rather than falsely presenting an analyzed frame.
      const poster = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#111827"/><circle cx="320" cy="180" r="48" fill="#1f2937" stroke="#9ca3af" stroke-width="3"/><path d="M307 151v58l45-29z" fill="#e5e7eb"/><text x="320" y="265" fill="#d1d5db" font-family="sans-serif" font-size="20" text-anchor="middle">Video</text></svg>',
      );
      const posterBytes = await sharp(poster).webp().toBuffer();
      thumbnailBytes = posterBytes.length;
      const posterResult = await getStorageClient().uploadFromBytes(
        thumbnailKey,
        posterBytes,
        { compress: false },
      );
      checkUploadResult(posterResult, "video poster");
    }

    return {
      url: `/api/media/files/${storageKey}`,
      thumbnail: `/api/media/files/${thumbnailKey}`,
      storageKey,
      thumbnailKey,
      mediaType,
      mimeType: mediaType === "image" ? "image/webp" : file.mimetype,
      size: file.size,
      storedBytes: storedBytes + thumbnailBytes,
      highBytes: storedBytes,
      lowBytes: thumbnailBytes,
      objectCount: 2,
    };
  } catch (error) {
    // Callers passing reserved keys use the durable cleanup queue. Direct
    // callers retain immediate cleanup semantics on partial object uploads.
    if (generatedKeys) {
      const results = await Promise.allSettled([
        deleteMediaObject(generatedKeys.storageKey),
        deleteMediaObject(generatedKeys.thumbnailKey),
      ]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length) throw new AggregateError([error, ...failures.map(result => result.reason)], "Upload failed and object cleanup failed");
    }
    throw error;
  } finally {
    await Promise.all(Array.from(tempPaths).map((tempPath) => unlink(tempPath).catch(() => undefined)));
  }
}

export function createMediaKeys(mime: string): { storageKey: string; thumbnailKey: string } {
  const extension: Record<string, string> = {
    "image/jpeg": "webp", "image/png": "webp", "image/gif": "webp", "image/webp": "webp",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  };
  if (!extension[mime]) throw new Error("Unsupported media type");
  const id = randomUUID();
  return { storageKey: `media-${id}.${extension[mime]}`, thumbnailKey: `thumb-${id}.webp` };
}

export async function deleteMediaObject(key: string): Promise<void> {
  assertStoredKey(key);
  const result = await getStorageClient().delete(key, { ignoreNotFound: true });
  checkUploadResult(result, `deletion of ${key}`);
}

/** Compatibility helper for callers holding a completed upload. */
export async function deleteStoredMedia(saved: StoredMedia): Promise<void> {
  await Promise.all([deleteMediaObject(saved.storageKey), deleteMediaObject(saved.thumbnailKey)]);
}

/**
 * Opens a private App Storage object for streaming through an authenticated
 * application route. Only keys generated by uploadMedia are accepted.
 */
export function readMediaStream(key: string): Readable {
  assertStoredKey(key);
  return getStorageClient().downloadAsStream(key);
}

/** Content type for a previously generated key, for the authorized route. */
export function getMediaContentType(key: string): string {
  assertStoredKey(key);
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".jpg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".gif")) return "image/gif";
  if (key.endsWith(".mov")) return "video/quicktime";
  if (key.endsWith(".webm")) return "video/webm";
  return "video/mp4";
}