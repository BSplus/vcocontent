// Development/post-merge only. Never invoked by startup or deployment builds.
import { readFile } from "node:fs/promises";
import { pool } from "../server/db.ts";
import { assertDevelopmentMediaTarget } from "../server/development-media-target.ts";
if (process.env.NODE_ENV === "production") throw new Error("Development schema setup cannot run in production");
assertDevelopmentMediaTarget();
try {
  for (const name of ["media-process-jobs.sql", "motorsport-recognition.sql", "public-beta.sql", "community-studio.sql", "creator-event-association.sql", "creator-profiles.sql", "0005-nextcloud-sources.sql", "photo-matching.sql", "media-object-routing.sql", "media-archive.sql", "event-vehicle.sql"]) {
    await pool.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  console.log("Additive media-process development schema is ready.");
} finally { await pool.end(); }
