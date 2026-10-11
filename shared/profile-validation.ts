import { z } from "zod";
import { PROFILE_IMAGE_DATA_URL_LENGTH } from "./profile-image-limits";
import { profileImageMessage } from "./profile-errors";

const nullableText = (max: number, message: string) => z.string().trim().max(max, message).transform(value => value || null).nullable().optional();
const externalLink = (instagram = false) => z.string().trim().max(2048, "Use no more than 2,048 characters.").transform((value, ctx) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (instagram && !["instagram.com", "www.instagram.com"].includes(url.hostname.toLowerCase()))) throw new Error();
    return url.toString();
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: instagram ? "Use an HTTP or HTTPS Instagram profile URL without embedded credentials." : "Use an HTTP or HTTPS website URL without embedded credentials." });
    return z.NEVER;
  }
}).nullable().optional();

export const profileUpdateSchema = z.object({
  username: z.string().trim().min(3, "Username must be between 3 and 80 characters.").max(80, "Username must be between 3 and 80 characters."),
  bio: z.string().trim().max(500, "Biography must be no longer than 500 characters."),
  profileImage: z.string().max(PROFILE_IMAGE_DATA_URL_LENGTH, profileImageMessage("profileImage", "size")).nullable().optional(),
  coverImage: z.string().max(PROFILE_IMAGE_DATA_URL_LENGTH, profileImageMessage("coverImage", "size")).nullable().optional(),
  displayName: nullableText(80, "Public display name must be no longer than 80 characters."),
  publicContactEmail: z.string().trim().max(254, "Public contact email must be no longer than 254 characters.").refine(value => !value || z.string().email().safeParse(value).success, "Enter a valid public contact email, or leave it blank.").transform(value => value || null).nullable().optional(),
  websiteUrl: externalLink(),
  instagramUrl: externalLink(true),
}).strict();
