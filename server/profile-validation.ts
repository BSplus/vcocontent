import { z } from "zod";
import sharp from "sharp";
import { PROFILE_IMAGE_SOURCE_BYTES, PROFILE_IMAGE_DATA_URL_LENGTH, PROFILE_IMAGE_SIZE_MESSAGE } from "../shared/profile-image-limits";

export class ProfileImageSizeError extends Error {
  constructor() {
    super(PROFILE_IMAGE_SIZE_MESSAGE);
  }
}

const nullableText = (max: number) => z.string().trim().max(max).transform(value => value || null).nullable().optional();
const externalLink = (instagram = false) => z.string().trim().max(2048).transform((value, ctx) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (instagram && !["instagram.com", "www.instagram.com"].includes(url.hostname.toLowerCase())))
      throw new Error("Invalid link");
    return url.toString();
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: instagram ? "Use an Instagram profile URL." : "Use an HTTP or HTTPS link." });
    return z.NEVER;
  }
}).nullable().optional();

export const profileUpdateSchema = z.object({
  username: z.string().trim().min(3).max(80),
  bio: z.string().trim().max(500),
  profileImage: z.string().max(PROFILE_IMAGE_DATA_URL_LENGTH, PROFILE_IMAGE_SIZE_MESSAGE).nullable().optional(),
  coverImage: z.string().max(PROFILE_IMAGE_DATA_URL_LENGTH, PROFILE_IMAGE_SIZE_MESSAGE).nullable().optional(),
  displayName: nullableText(80),
  publicContactEmail: z.union([z.string().trim().email().max(254), z.literal("")]).transform(value => value || null).nullable().optional(),
  websiteUrl: externalLink(),
  instagramUrl: externalLink(true),
}).strict();

export async function normalizeProfileImage(value: string, cover = false) {
  if (value.length > PROFILE_IMAGE_DATA_URL_LENGTH) throw new ProfileImageSizeError();
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value))
    throw new Error("Choose a JPEG, PNG or WebP image.");
  const source = Buffer.from(value.split(",")[1], "base64");
  if (source.length > PROFILE_IMAGE_SOURCE_BYTES) throw new ProfileImageSizeError();
  if (!source.length) throw new Error("Choose a JPEG, PNG or WebP image.");
  const info = await sharp(source, { animated: true, limitInputPixels: 40000000 }).metadata();
  if (!["jpeg", "png", "webp"].includes(info.format || "") || (info.pages || 1) > 1 ||
    source.includes(Buffer.from("acTL")) || source.includes(Buffer.from("ANIM")))
    throw new Error("Choose a still JPEG, PNG or WebP image.");
  const normalized = await sharp(source, { limitInputPixels: 40000000 }).rotate()
    .resize(cover ? 1920 : 256, cover ? 640 : 256, { fit: "cover", withoutEnlargement: true })
    .webp({ quality: 75 }).toBuffer();
  if (normalized.length > (cover ? 250000 : 100000)) throw new Error("Image could not fit its size limit.");
  return { buffer: normalized, dataUrl: `data:image/webp;base64,${normalized.toString("base64")}` };
}
