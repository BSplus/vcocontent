// OFFLINE configuration validation only. No SDK clients, sockets or database queries.
// Reads configuration internally; prints no secret, connection URL or credential value.
import { assertMediaDatabaseTarget, mediaDatabaseFingerprint, mediaStorageEnvironment } from "../server/media-storage-config.ts";
import { r2Config } from "../server/object-store.ts";
try {
  if (process.argv[2] === "--database-fingerprint") {
    if (!process.env.DATABASE_URL) throw new Error();
    console.log(mediaDatabaseFingerprint(process.env.DATABASE_URL));
  } else {
    const scope=mediaStorageEnvironment();
    if(process.env.MEDIA_STORAGE_ROUTING==="enabled")assertMediaDatabaseTarget();
    r2Config();
    if(scope==="production" && process.env.MEDIA_STORAGE_PROVIDER==="r2" &&
      process.env.R2_PROD_WRITE_ENABLED!=="true")throw new Error();
    console.log(`Offline ${scope} configuration valid; bucket connectivity, IAM scope, privacy and jurisdiction NOT tested.`);
  }
} catch {
  console.error("Offline configuration blocked; check environment-specific settings. No connectivity test was performed.");
  process.exitCode=1;
}
