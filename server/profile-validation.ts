import sharp from "sharp";
import { PROFILE_IMAGE_SOURCE_BYTES, PROFILE_IMAGE_DATA_URL_LENGTH, PROFILE_IMAGE_SIZE_MESSAGE } from "../shared/profile-image-limits";
export { profileUpdateSchema } from "../shared/profile-validation";

export class ProfileImageError extends Error {
  constructor(public reason: "size" | "format" | "unreadable" | "dimensions") { super(reason); }
}
export class ProfileImageSizeError extends ProfileImageError {
  constructor() {
    super("size");
    this.message = PROFILE_IMAGE_SIZE_MESSAGE;
  }
}

export async function normalizeProfileImage(value: string, cover = false) {
  if (value.length > PROFILE_IMAGE_DATA_URL_LENGTH) throw new ProfileImageSizeError();
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value))
    throw new ProfileImageError("format");
  const source = Buffer.from(value.split(",")[1], "base64");
  if (source.length > PROFILE_IMAGE_SOURCE_BYTES) throw new ProfileImageSizeError();
  if (!source.length) throw new ProfileImageError("unreadable");
  try {
  const info = await sharp(source, { animated: true, limitInputPixels: false }).metadata();
  if ((info.width || 0) * (info.height || 0) > 40000000) throw new ProfileImageError("dimensions");
  if (!["jpeg", "png", "webp"].includes(info.format || "") || (info.pages || 1) > 1 ||
    source.includes(Buffer.from("acTL")) || source.includes(Buffer.from("ANIM")))
    throw new ProfileImageError("format");
  const normalized = await sharp(source, { limitInputPixels: 40000000, failOn: "error" }).rotate()
    .resize(cover ? 1920 : 256, cover ? 640 : 256, { fit: "cover", withoutEnlargement: true })
    .webp({ quality: 75 }).toBuffer();
  if (normalized.length > (cover ? 250000 : 100000)) throw new ProfileImageError("dimensions");
  return { buffer: normalized, dataUrl: `data:image/webp;base64,${normalized.toString("base64")}` };
  } catch (error) {
    if (error instanceof ProfileImageError) throw error;
    // Only known decoder failures establish that the supplied file is unreadable.
    // Resource/system failures remain technical errors, with no private details.
    const message = error instanceof Error ? error.message : "";
    if (/unsupported image format|corrupt|truncated|premature end|invalid (?:header|chunk)|(?:pngload|jpegload|webpload)|VipsJpeg|not a known file format|insufficient image data/i.test(message))
      throw new ProfileImageError("unreadable");
    throw error;
  }
}
