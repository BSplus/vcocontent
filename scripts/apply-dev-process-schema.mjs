// Development/post-merge only. Never invoked by startup or deployment builds.
import { readFile } from "node:fs/promises";
import { pool } from "../server/db.ts";
if (process.env.NODE_ENV === "production") throw new Error("Development schema setup cannot run in production");
try {
  await pool.query(await readFile(new URL("../migrations/media-process-jobs.sql", import.meta.url), "utf8"));
  console.log("Additive media-process development schema is ready.");
} finally { await pool.end(); }
