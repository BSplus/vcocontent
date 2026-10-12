export const profileFields = ["username", "displayName", "bio", "publicContactEmail", "websiteUrl", "instagramUrl", "profileImage", "coverImage"] as const;
export type ProfileField = typeof profileFields[number];
export type ProfileFieldErrors = Partial<Record<ProfileField, string>>;
export const profileMessages = {
  validation: "Check the highlighted profile fields and try again.",
  username_taken: "This username is already taken. Choose another username.",
  storage_full: "Your storage is full. Remove unused files before adding another image.",
  storage_unknown: "Storage usage needs an administrator check. Contact an administrator before adding images.",
  storage_cleanup: "Storage cleanup is pending. Wait a little and try again, or contact an administrator.",
  safety_unavailable: "The automatic safety check could not finish. Your saved profile is unchanged. Try saving again later.",
  safety_blocked: "The submitted profile text and images did not pass the automatic safety check. Your saved profile is unchanged. Review them against the community safety policy, adjust them and try saving again.",
  safety_uncertain: "The automatic safety check could not confidently approve the submitted profile text and images. No policy violation has been confirmed. Your saved profile is unchanged. Adjust your text or choose different images and try saving again; no administrator approval is required.",
  authentication: "Sign in again before saving your profile.",
  permission: "You cannot edit these profile details. Contact an administrator if you need access.",
  rate_limit: "Too many profile changes. Wait up to an hour before trying again.",
  request_size: "The profile request is too large. Use files no larger than 3 MB each and keep profile text within its limits.",
  server: "The server could not complete the profile save. Try again later.",
  connection: "The save could not be confirmed. Check your connection and reload your saved profile before retrying; changes may already have been saved.",
} as const;
export type ProfileErrorCode = keyof typeof profileMessages;
export function profileFailure(code: ProfileErrorCode, fieldErrors: ProfileFieldErrors = {}) {
  return { code, error: code === "validation" && Object.keys(fieldErrors).length
    ? Object.values(fieldErrors).join(" ") : profileMessages[code], fieldErrors };
}
export const profileImageMessage = (field: "profileImage" | "coverImage", reason: "size" | "format" | "unreadable" | "dimensions") => {
  const label = field === "profileImage" ? "Profile photo" : "Creator cover image";
  return ({
    size: `${label} must be no larger than 3 MB (3,000,000 bytes). Choose a smaller file.`,
    format: `${label} must be a supported static JPEG, PNG or WebP. Choose a still image in one of these formats.`,
    unreadable: `${label} is damaged or could not be read. Export it again or choose another file.`,
    dimensions: `${label} needs to be smaller. Reduce its pixel dimensions and export it again.`,
  })[reason];
};
