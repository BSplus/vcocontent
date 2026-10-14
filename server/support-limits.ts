import { createHmac } from "node:crypto";
import { pool } from "./db";

export function supportHash(value: string) {
  if (!process.env.SESSION_SECRET) throw new Error("Support protection unavailable");
  return createHmac("sha256", process.env.SESSION_SECRET).update(`vco-support:${value}`).digest("hex");
}
const requestKey = (id: string) => `support:request:${supportHash(id)}`;

/** Shared lock makes the request ledger and all budgets one atomic reservation.
 * Only HMAC identifiers, counters and expiry times are persisted, never messages.
 */
export async function reserveSupport(ip: string, id: string, fingerprint: string): Promise<"reserved" | "accepted" | "uncertain" | "limited"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '3s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SELECT pg_advisory_xact_lock(198, 1)");
    await client.query("DELETE FROM beta_rate_limits WHERE key LIKE 'support:%' AND reset_at <= now()");
    const key = requestKey(id);
    const payloadKey = `support:payload:${supportHash(id + ":" + fingerprint)}`;
    const existing = await client.query("SELECT count FROM beta_rate_limits WHERE key=$1", [key]);
    if (existing.rows.length) {
      const matching = await client.query("SELECT key FROM beta_rate_limits WHERE key=$1", [payloadKey]);
      await client.query("COMMIT");
      return existing.rows[0].count === 1 && matching.rows.length ? "accepted" : "uncertain";
    }
    const hash = supportHash(ip);
    const buckets = [
      [`support:ip:hour:${hash}`, 3, 3600], [`support:ip:day:${hash}`, 10, 86400],
      ["support:global:hour", 30, 3600], ["support:global:day", 100, 86400],
    ] as const;
    for (const [bucket, limit, seconds] of buckets) {
      const result = await client.query(`INSERT INTO beta_rate_limits(key,count,reset_at)
        VALUES($1,1,now()+$3 * interval '1 second')
        ON CONFLICT(key) DO UPDATE SET count=beta_rate_limits.count+1
        WHERE beta_rate_limits.count<$2 RETURNING key`, [bucket, limit, seconds]);
      if (!result.rows.length) { await client.query("ROLLBACK"); return "limited"; }
    }
    await client.query("INSERT INTO beta_rate_limits(key,count,reset_at) VALUES($1,0,now()+interval '24 hours')", [key]);
    await client.query("INSERT INTO beta_rate_limits(key,count,reset_at) VALUES($1,0,now()+interval '24 hours')", [payloadKey]);
    await client.query("COMMIT");
    return "reserved";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function confirmSupport(id: string) {
  await pool.query("UPDATE beta_rate_limits SET count=1 WHERE key=$1", [requestKey(id)]);
}
