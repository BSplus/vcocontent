import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5000";

test("registration, session, role boundaries and disabled purchases", async () => {
  const name = `beta_smoke_${randomUUID().slice(0, 12)}`;
  const password = `${randomUUID()}Ab!`;
  let cookie = "";

  async function request(path, method = "GET", body) {
    const response = await fetch(new URL(path, base), {
      method,
      headers: {
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
  assert.equal((await request("/api/media", "POST", { eventId: 1 })).status, 403);
  assert.equal((await request("/api/credits/purchase", "POST", { amount: 10 })).status, 503);
  assert.equal((await request("/api/webhook/stripe", "POST", {})).status, 503);
  assert.equal((await request("/api/logout", "POST")).status, 200);
  assert.equal((await request("/api/user")).status, 401);
  assert.equal((await request("/api/login", "POST", { username: name, password })).status, 200);
  assert.equal((await request("/api/user")).status, 200);
});