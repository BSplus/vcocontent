import { createHash } from "node:crypto";

type Environment = Record<string, string | undefined>;
export class ObjectStoreError extends Error {
  constructor(public code: "configuration" | "authorization" | "missing" | "upstream" | "integrity" | "retained") {
    super(`Media storage ${code}`); this.name = "ObjectStoreError";
  }
}
export const PRODUCTION_MEDIA_BUCKET = "vco-content-media";

/** Replit's published-runtime marker is authoritative, not a locally set NODE_ENV. */
export function mediaStorageEnvironment(env: Environment = process.env): "development" | "production" {
  const scope = env.MEDIA_STORAGE_ENVIRONMENT;
  if (scope !== "development" && scope !== "production") throw new ObjectStoreError("configuration");
  if (env.REPLIT_DEPLOYMENT === "1") {
    if (scope !== "production" || env.NODE_ENV !== "production" ||
        env.MEDIA_STORAGE_PRODUCTION_APPROVED !== "true") throw new ObjectStoreError("configuration");
  } else if (scope !== "development") throw new ObjectStoreError("configuration");
  return scope;
}

/** A non-secret connection-target fingerprint; does not include passwords or usernames.
 * This catches a wrong connection against an independently verified expected target.
 * It is NOT proof that two operator-selected targets represent isolated databases.
 */
export function mediaDatabaseFingerprint(url: string) {
  try {
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname === "/")
      throw new Error();
    return createHash("sha256").update(JSON.stringify([
      parsed.hostname.toLowerCase(), parsed.port || "5432", decodeURIComponent(parsed.pathname.slice(1)),
    ])).digest("hex");
  } catch { throw new ObjectStoreError("configuration"); }
}

export function assertMediaDatabaseTarget(env: Environment = process.env) {
  if (!env.DATABASE_URL || !/^[0-9a-f]{64}$/.test(env.MEDIA_STORAGE_DATABASE_FINGERPRINT || "") ||
      mediaDatabaseFingerprint(env.DATABASE_URL) !== env.MEDIA_STORAGE_DATABASE_FINGERPRINT)
    throw new ObjectStoreError("configuration");
}
