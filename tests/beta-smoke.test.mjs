import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import {once} from "node:events";
import {createHash} from "node:crypto";
await import("./helpers/beta-provider-preload.mjs");
const {setupAuth}=await import("../server/auth.ts");
const {registerRoutes}=await import("../server/routes.ts");
const {db,pool}=await import("../server/db.ts");
const {SAFETY_POLICY}=await import("../server/beta-policy.ts");
const {users,betaRateLimits,safetyResults}=await import("../shared/schema.ts");
const {eq}=await import("drizzle-orm");
const app=express();app.set("trust proxy",1);app.use(express.json());
app.use(session({secret:"synthetic-session-secret",resave:false,saveUninitialized:false}));
setupAuth(app);await registerRoutes(app,{workers:false});
const server=app.listen(0,"127.0.0.1");await once(server,"listening");
import { randomUUID } from "node:crypto";

const base = `http://127.0.0.1:${server.address().port}`;
const fixtureIp=`198.18.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)+1}`;
let fixtureId, fixtureName;
test.after(async()=>{
  if(fixtureId) await db.delete(users).where(eq(users.id,fixtureId));
  await db.delete(betaRateLimits).where(eq(betaRateLimits.key,`register:${createHash("sha256").update(fixtureIp).digest("hex")}`));
  // The cache contains no content, but remove this run's neutral registration result.
  if(fixtureName) await db.delete(safetyResults).where(eq(safetyResults.fingerprint,
    createHash("sha256").update(SAFETY_POLICY).update("gpt-4.1-mini").update(JSON.stringify({username:fixtureName,bio:null})).digest("hex")));
  await new Promise(resolve=>server.close(resolve));await pool.end();
});

test("registration, session, role boundaries and disabled purchases", async () => {
  const name = `beta_smoke_${randomUUID().slice(0, 12)}`;
  const password = `${randomUUID()}Ab!`;
  let cookie = "";

  async function request(path, method = "GET", body) {
    const response = await fetch(new URL(path, base), {
      method,
      headers: {
        "X-Forwarded-For":fixtureIp,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const newCookie = response.headers.get("set-cookie");
    if (newCookie) cookie = newCookie.split(";")[0];
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { message: text }; }
    return { status: response.status, data };
  }

  const registered = await request("/api/register", "POST", {
    username: name,
    email: `${name}@example.invalid`,
    password,
    isAdmin: true,
    isCreator: true,
    credits: 9999,
  });
  assert.equal(registered.status, 201);
  fixtureId=registered.data.id;fixtureName=name;
  assert.equal(registered.data.isAdmin, false);
  assert.equal(registered.data.isCreator, false);
  assert.equal(registered.data.credits, "0");
  assert.equal("password" in registered.data, false);
  assert.ok(cookie);

  const current = await request("/api/user");
  assert.equal(current.status, 200);
  assert.equal("password" in current.data, false);

  const event = await request("/api/events", "POST", {
    title: "Unauthorized",
    description: "Must be rejected",
    date: new Date().toISOString(),
  });
  assert.equal(event.status, 403);
  assert.equal((await request("/api/series", "POST", { name: "Unauthorized" })).status, 403);
  assert.equal((await request("/api/admin/nextcloud/preview", "POST", { sources: [] })).status, 403);
  assert.equal((await request("/api/admin/openai/test", "POST")).status, 403);
  assert.equal((await request("/api/admin/events/1/nextcloud", "POST", { sources: [] })).status, 403);
  assert.equal((await request("/api/admin/events/1/nextcloud")).status, 403);
  assert.equal((await request("/api/media", "POST", { eventId: 1 })).status, 403);
  assert.equal((await request("/api/credits/purchase", "POST", { amount: 10 })).status, 503);
  assert.equal((await request("/api/webhook/stripe", "POST", {})).status, 503);
  assert.equal((await request("/api/logout", "POST")).status, 200);
  assert.equal((await request("/api/user")).status, 401);
  assert.equal((await request("/api/admin/openai/test", "POST")).status, 401);
  assert.equal((await request("/api/login", "POST", { username: name, password })).status, 200);
  assert.equal((await request("/api/user")).status, 200);
});