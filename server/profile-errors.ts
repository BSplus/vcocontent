import { profileFailure } from "../shared/profile-errors";
import { MediaLimitError } from "./media-policy";

export class ProfileAccessError extends Error {}
/** Only the actual users.username constraint proves a login-name collision. */
export function isUsernameConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: any = error;
  for (let depth = 0; current && depth < 8 && !seen.has(current); depth++) {
    seen.add(current);
    if (current.code === "23505" && current.constraint === "users_username_unique" &&
      (!current.table || current.table === "users")) return true;
    current = current.cause;
  }
  return false;
}
export function mapProfileError(error: unknown) {
  if (isUsernameConflict(error)) return { status: 409, body: profileFailure("username_taken", { username: profileFailure("username_taken").error }) };
  if (error instanceof ProfileAccessError) return { status: 403, body: profileFailure("permission") };
  if (error instanceof MediaLimitError && error.code) return {
    status: error.code === "permission" ? 403 : error.code === "storage_full" ? 409 : 503,
    body: profileFailure(error.code),
  };
  return { status: 500, body: profileFailure("server") };
}
