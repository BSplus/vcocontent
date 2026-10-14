import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { supportSchema } from "../shared/support.ts";
import { supportEmail } from "../server/email-templates/support.ts";

const input = () => ({ name: "Visitor <script>", email: "visitor@example.test",
  subject: "Rights & support", message: "Line one\n<script>alert('x')</script>", website: "", requestId: randomUUID() });

test("support validation is bounded and prevents header injection and recipient overrides", () => {
  assert.equal(supportSchema.safeParse(input()).success, true);
  for (const changes of [
    { name: "" }, { email: "invalid" }, { email: "a@b.test\r\nBcc: attacker@example.test" },
    { subject: "test\nBcc: other@example.test" }, { name: "x".repeat(101) },
    { email: "x".repeat(255) }, { subject: "x".repeat(151) }, { message: "x".repeat(5001) },
    { message: "\0" }, { requestId: "bad" }, { to: "attacker@example.test" }, { from: "attacker@example.test" },
  ]) assert.equal(supportSchema.safeParse({ ...input(), ...changes }).success, false, JSON.stringify(changes));
  const email = supportEmail(input());
  assert.match(email.html, /Visitor &lt;script&gt;/);
  assert.match(email.html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.text, /Line one\n<script>/);
  assert.match(email.html, /cid:vco-logo/);
  assert.ok(supportEmail({ ...input(), subject: "x".repeat(150) }).subject.length < 200);
});

if (!process.env.VCO_TEST_PG_PROXY) {
  test("persistent support transport checks require the disposable PostgreSQL runner", { skip: true }, () => {});
} else {
  process.env.RESEND_API_KEY = "synthetic-support-key";
  process.env.RESEND_FROM = "support@example.test";
  process.env.PUBLIC_SITE_URL = "https://example.test";
  process.env.SESSION_SECRET = "synthetic-support-hmac-secret";
  const { pool } = await import("../server/db.ts");
  const { registerSupportRoutes } = await import("../server/support-routes.ts");
  const { registerRequestParsers } = await import("../server/request-parsers.ts");
  const { supportHash } = await import("../server/support-limits.ts");
  const originalFetch = globalThis.fetch;
  const mail = [];
  let mode = "accepted", hold, reached;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.resend.com/emails", "No unexpected external network calls");
    mail.push({ body: JSON.parse(init.body), headers: init.headers, signal: init.signal });
    if (mode === "hold") { reached?.(); await new Promise(resolve => { hold = resolve; }); }
    if (mode === "network") throw new Error("synthetic-private-provider-details");
    if (mode === "timeout") throw new DOMException("synthetic timeout", "TimeoutError");
    return new Response(mode === "malformed" ? "{}" : JSON.stringify({ id: "synthetic-provider-id" }),
      { status: mode === "reject" ? 422 : mode === "upstream" ? 500 : 200 });
  };
  const app = express();
  app.set("trust proxy", 1);
  registerRequestParsers(app);
  registerSupportRoutes(app);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (body = input(), options = {}) => {
    const response = await originalFetch(base + "/api/support", {
      method: "POST", headers: {
        "Content-Type": "application/json", Origin: base, "X-Forwarded-For": "198.18.0.1", ...options.headers,
      }, body: options.raw || JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), retry: response.headers.get("Retry-After") };
  };
  const reset = async () => {
    mode = "accepted"; mail.length = 0;
    await pool.query("DELETE FROM beta_rate_limits WHERE key LIKE 'support:%'");
  };
  test.after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  });

  test("public endpoint fixes destination/from, uses validated Reply-To and never echoes content", async () => {
    await reset();
    const draft = input(), result = await request(draft);
    assert.equal(result.body.status, "accepted");
    assert.deepEqual(mail[0].body.to, ["info@vco-esports.com"]);
    assert.equal(mail[0].body.from, "support@example.test");
    assert.equal(mail[0].body.reply_to, draft.email);
    assert.ok(mail[0].body.attachments[0].content);
    assert.match(mail[0].headers["Idempotency-Key"], /^support-[a-f0-9]{64}$/);
    assert.equal(mail[0].signal.aborted, false);
    assert.doesNotMatch(JSON.stringify(result), /Visitor|visitor@example/);
    assert.equal((await request({ ...draft, to: "evil@example.test" })).body.status, "validation");
    assert.equal(mail.length, 1);
  });
  test("invalid JSON, bounds, honeypot and cross-origin requests never send", async () => {
    await reset();
    for (const changes of [{ email: "a\r\nb@example.test" }, { message: "x".repeat(5001) },
      { website: "bot.test" }, { from: "evil@example.test" }]) {
      assert.equal((await request({ ...input(), ...changes })).body.status, "validation");
    }
    assert.equal((await request(input(), { raw: "{" })).body.status, "validation");
    assert.equal((await request(input(), { raw: JSON.stringify({ ...input(), message: "x".repeat(26000) }) })).status, 413);
    assert.equal((await request(input(), { headers: { Origin: "https://evil.test" } })).status, 403);
    assert.equal((await request(input(), { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
    assert.equal(mail.length, 0);
  });
  test("parallel IP reservations are atomic; duplicate in-flight requests cannot send twice", async () => {
    await reset(); mode = "hold";
    const firstInput = input();
    const begun = new Promise(resolve => { reached = resolve; });
    const first = request(firstInput); await begun;
    assert.equal((await request(firstInput)).body.status, "uncertain");
    hold(); await first; mode = "accepted";
    assert.equal((await request(firstInput)).body.status, "accepted");
    assert.equal((await request({ ...firstInput, message: "changed" })).body.status, "uncertain");
    const results = await Promise.all(Array.from({ length: 8 }, () => request()));
    assert.equal(results.filter(r => r.body.status === "accepted").length, 2);
    assert.equal(results.filter(r => r.body.status === "rate_limited").length, 6);
    assert.equal(mail.length, 3);
    assert.equal(results.find(r => r.status === 429).retry, "3600");
    const rows = await pool.query("SELECT key,count,reset_at FROM beta_rate_limits WHERE key LIKE 'support:%'");
    assert.doesNotMatch(JSON.stringify(rows.rows), /198\.18\.0\.1|visitor@example|Visitor|<script>/);
    assert.ok(rows.rows.some(r => r.key.includes(supportHash("198.18.0.1"))));
  });
  test("global budget remains atomic across different IPs and application instances", async () => {
    await reset();
    const secondApp = express(); secondApp.set("trust proxy", 1);
    registerRequestParsers(secondApp); registerSupportRoutes(secondApp);
    const second = secondApp.listen(0, "127.0.0.1"); await once(second, "listening");
    try {
      const results = await Promise.all(Array.from({ length: 36 }, async (_, i) => {
        const target = i % 2 ? `http://127.0.0.1:${second.address().port}` : base;
        const response = await originalFetch(target + "/api/support", { method: "POST",
          headers: { "Content-Type": "application/json", Origin: target, "X-Forwarded-For": `198.18.1.${i + 1}` },
          body: JSON.stringify(input()) });
        return response.json();
      }));
      assert.equal(results.filter(r => r.status === "accepted").length, 30);
      assert.equal(results.filter(r => r.status === "rate_limited").length, 6);
      assert.equal(mail.length, 30);
    } finally { await new Promise(resolve => second.close(resolve)); }
  });
  test("missing config, protection outage and failure after acceptance are honest and fail closed", async () => {
    await reset();
    const key = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
    try { assert.equal((await request()).body.status, "unavailable"); }
    finally { process.env.RESEND_API_KEY = key; }
    const secret = process.env.SESSION_SECRET; delete process.env.SESSION_SECRET;
    try { assert.equal((await request()).body.status, "unavailable"); }
    finally { process.env.SESSION_SECRET = secret; }
    assert.equal(mail.length, 0);
    // Failure to record acceptance cannot change the already-confirmed provider result.
    const { reserveSupport } = await import("../server/support-limits.ts");
    const { sendBrandedEmail } = await import("../server/email-delivery.ts");
    const injected = express(); registerRequestParsers(injected);
    let protectionFails = true;
    registerSupportRoutes(injected, { configured: () => true, hash: supportHash,
      reserve: (...args) => protectionFails ? Promise.reject(new Error("synthetic database failure")) : reserveSupport(...args),
      confirm: () => Promise.reject(new Error("synthetic bookkeeping failure")), send: sendBrandedEmail });
    const temp = injected.listen(0, "127.0.0.1"); await once(temp, "listening");
    const target = `http://127.0.0.1:${temp.address().port}`;
    const post = async () => (await originalFetch(target + "/api/support", { method: "POST",
      headers: { Origin: target, "Content-Type": "application/json" }, body: JSON.stringify(input()) })).json();
    try {
      assert.equal((await post()).status, "unavailable"); assert.equal(mail.length, 0);
      protectionFails = false; assert.equal((await post()).status, "accepted"); assert.equal(mail.length, 1);
    } finally { await new Promise(resolve => temp.close(resolve)); }
  });
  for (const state of ["reject", "upstream", "network", "timeout", "malformed"]) {
    test(`provider ${state} is not confused with accepted delivery and has no automatic retries`, async () => {
      await reset(); mode = state;
      const result = await request();
      assert.equal(result.body.status, state === "reject" ? "rejected" : "uncertain");
      assert.equal(mail.length, 1);
      assert.doesNotMatch(JSON.stringify(result), /synthetic-private|synthetic timeout/);
    });
  }
  test("expired support buckets are removed; day limits still hold when hour resets", async () => {
    await reset();
    await pool.query(`INSERT INTO beta_rate_limits(key,count,reset_at) VALUES
      ($1,10,now()+interval '1 day'), ('support:expired',1,now()-interval '1 second')`,
      [`support:ip:day:${supportHash("198.18.0.1")}`]);
    assert.equal((await request()).body.status, "rate_limited");
    assert.equal(mail.length, 0);
    // Rejected transaction rolls back cleanup too; a successful reservation performs cleanup.
    assert.equal((await request(input(), { headers: { "X-Forwarded-For": "198.18.0.2" } })).body.status, "accepted");
    assert.equal((await pool.query("SELECT key FROM beta_rate_limits WHERE key='support:expired'")).rows.length, 0);
    await reset();
    await pool.query("INSERT INTO beta_rate_limits(key,count,reset_at) VALUES('support:global:day',100,now()+interval '1 day')");
    assert.equal((await request()).body.status, "rate_limited");
    assert.equal(mail.length, 0);
  });
}
