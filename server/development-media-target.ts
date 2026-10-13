import { assertMediaDatabaseTarget, mediaStorageEnvironment, ObjectStoreError } from "./media-storage-config";

/** This project uses the runtime-managed, container-local Development database.
 * No arbitrary URL, Production namespace, or caller-selected "-dev" name is enough.
 * Tests inject a disposable DB into archive functions instead of bypassing this CLI gate.
 */
export function assertDevelopmentMediaTarget(env = process.env) {
  if (mediaStorageEnvironment(env) !== "development" || env.REPLIT_DEPLOYMENT === "1" ||
      env.NODE_ENV === "production" || env.R2_BUCKET !== "vco-content-media-dev" ||
      ["R2_PROD_ACCESS_KEY_ID","R2_PROD_SECRET_ACCESS_KEY"].some(key => Object.hasOwn(env,key)))
    throw new ObjectStoreError("configuration");
  assertMediaDatabaseTarget(env);
  const target = new URL(env.DATABASE_URL!);
  if (target.hostname !== "helium" || decodeURIComponent(target.pathname) !== "/heliumdb")
    throw new ObjectStoreError("configuration");
}
