// Default: read-only plan. No startup/build hook and no production auto-apply.
import { pool } from "../server/db.ts";
import { retiredTagCleanupPlan, applyRetiredTagCleanup } from "../server/retired-tag-cleanup.ts";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const expected = args.find(arg => arg.startsWith("--expected="))?.slice("--expected=".length);
if (args.some(arg => !["--apply", "--production-reviewed"].includes(arg) && !/^--expected=[a-f0-9]{64}$/.test(arg)))
  throw new Error("Usage: --apply --expected=<plan fingerprint> [--production-reviewed]");
if (apply && (!expected || ((process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") && !args.includes("--production-reviewed"))))
  throw new Error("Apply requires a reviewed plan fingerprint and explicit production acknowledgement.");
let client;
try {
  client = await pool.connect();
  const query = (text, values) => client.query(text, values);
  await query(apply ? "begin" : "begin isolation level repeatable read read only");
  const result = apply ? await applyRetiredTagCleanup(query, expected) : await retiredTagCleanupPlan(query);
  await query("commit");
  console.log(JSON.stringify({ mode: apply ? "applied" : "read-only", ...result }, null, 2));
} catch (error) {
  if (client) await client.query("rollback").catch(() => {});
  console.error("Retired-tag cleanup failed; no partial cleanup was committed.");
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
