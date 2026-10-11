import { profileFields, profileMessages, profileImageMessage, type ProfileFieldErrors, type ProfileErrorCode } from "@shared/profile-errors";

const allowedFieldMessages = new Set([
  profileMessages.username_taken, "Enter a valid value for this field.",
  "Username must be between 3 and 80 characters.", "Biography must be no longer than 500 characters.",
  "Public display name must be no longer than 80 characters.",
  "Public contact email must be no longer than 254 characters.", "Enter a valid public contact email, or leave it blank.",
  "Use no more than 2,048 characters.", "Use an HTTP or HTTPS website URL without embedded credentials.",
  "Use an HTTP or HTTPS Instagram profile URL without embedded credentials.",
  ...(["profileImage", "coverImage"] as const).flatMap(field => (["size", "format", "unreadable", "dimensions"] as const).map(reason => profileImageMessage(field, reason))),
]);
export function readProfileFailure(status: number, value: unknown) {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const fallback: ProfileErrorCode = status === 401 ? "authentication" : status === 403 ? "permission" : status === 429 ? "rate_limit" : status === 413 ? "request_size" : "server";
  const code = typeof data.code === "string" && Object.hasOwn(profileMessages, data.code) && data.code !== "connection" ? data.code as ProfileErrorCode : fallback;
  const fields: ProfileFieldErrors = {};
  if (data.fieldErrors && typeof data.fieldErrors === "object") {
    for (const field of profileFields) {
      const message = (data.fieldErrors as Record<string, unknown>)[field];
      if (typeof message === "string" && allowedFieldMessages.has(message)) fields[field] = message;
    }
  }
  return { message: profileMessages[code], fields };
}
