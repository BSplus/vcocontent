import { pool } from "./db";
export class VisionBusy extends Error {}

// A shared two-request budget for tag jobs, caption previews and entry-list
// OCR/vision. Connection-scoped locks are released on process termination.
export async function withVisionBudget<T>(work: () => Promise<T>): Promise<T> {
  const connection = await pool.connect();
  let slot: number | undefined;
  let destroyed = false;
  try {
    for (const key of [761030, 761031]) {
      const result = await connection.query("select pg_try_advisory_lock($1) as acquired", [key]);
      if (result.rows[0]?.acquired) { slot = key; break; }
    }
    if (slot === undefined) throw new VisionBusy("AI is busy. Please retry shortly.");
    return await work();
  } finally {
    if (slot !== undefined) {
      try { await connection.query("select pg_advisory_unlock($1)", [slot]); }
      catch { connection.release(true); destroyed = true; }
    }
    if (!destroyed) connection.release();
  }
}
