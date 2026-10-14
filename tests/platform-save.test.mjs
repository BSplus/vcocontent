import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { db, pool } from "../server/db.ts";
import { events, users } from "../shared/schema.ts";
import { storage } from "../server/storage.ts";
import { registerRoutes } from "../server/routes.ts";
import { savePhotoMatchingSettings } from "../client/src/lib/photo-matching-save.ts";
import { EventSaveError } from "../client/src/lib/event-save.ts";

let server, base, admin, owner, other;
const ids = [], userIds = [];
const originalExecute = db.execute, originalGet = storage.getEvent, originalTransaction = db.transaction;
const realFetch = globalThis.fetch;
const api = (id, body, role = "admin", method = body === undefined ? "GET" : "PATCH", suffix = "/photo-matching") =>
  realFetch(`${base}/api/events/${id}${suffix}`, { method, headers: { "Content-Type": "application/json", "x-role": role },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function album(creatorId = null) {
  const [event] = await db.insert(events).values({ title: "Isolated platform fixture", description: "Disposable local database only",
    date: new Date("2026-10-11"), creatorId, visibility: "draft" }).returning();
  ids.push(event.id); return event;
}
test.before(async () => {
  for (const role of ["admin", "owner", "other"]) {
    const [u] = await db.insert(users).values({ username: `platform-${randomUUID()}`, email: `${randomUUID()}@example.invalid`,
      password: "fixture-not-login", isAdmin: role === "admin", creatorStatus: "approved", emailVerifiedAt: new Date() }).returning();
    userIds.push(u.id);
    if (role === "admin") admin = u; else if (role === "owner") owner = u; else other = u;
  }
  // Safety quota database failure, not a provider request. No AI or workers.
  db.execute = async query => {
    // Allow creator creation throttling; fail only the independent safety quota.
    if (new PgDialect().sqlToQuery(query).params.some(value => typeof value === "string" && value.startsWith("safety:")))
      throw new Error("Synthetic safety outage");
    return originalExecute.call(db, query);
  };
  globalThis.fetch = async () => { throw new Error("External network forbidden"); };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { admin, owner, other }[req.headers["x-role"]];
    req.isAuthenticated = () => !!req.user; next();
  });
  server = await registerRoutes(app, { workers: false });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  storage.getEvent = originalGet; db.execute = originalExecute; db.transaction = originalTransaction; globalThis.fetch = realFetch;
  await new Promise(resolve => server.close(resolve));
  await db.delete(events).where(inArray(events.id, ids));
  await db.delete(users).where(inArray(users.id, userIds));
  storage.sessionStore.close(); await pool.end();
});

for (const role of ["admin", "owner"])
  test(`${role}: general event creation and updates persist optional platform independently of matching`, async () => {
    const response = await realFetch(`${base}${role === "admin" ? "/api/events" : "/api/creator/events"}`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-role": role },
      body: JSON.stringify({ title: "Platform create fixture", description: "Disposable fixture", date: "2026-10-11", platform: "  iRacing  " }),
    });
    assert.equal(response.status, 201);
    const created = await response.json(); ids.push(created.id);
    assert.equal(created.platform, "iRacing"); assert.equal(created.photoMatchingEnabled, false);
    assert.equal(created.creatorId, role === "owner" ? owner.id : null);
    assert.equal((await api(created.id, { platform: "  ACC  " }, role, "PUT", "")).status, 200);
    const saved = await storage.getEvent(created.id);
    assert.equal(saved.platform, "ACC"); assert.equal(saved.referenceRevision, 1);
    assert.equal(saved.contentVersion, 1); assert.equal(saved.photoMatchingEnabled, false);
    const unchanged = await (await api(created.id, { platform: "ACC" }, role, "PUT", "")).json();
    assert.equal(unchanged.saveStatus, "unchanged");
    await api(created.id, { description: "Other changed field" }, role, "PUT", "");
    await api(created.id, { enabled: true }, role);
    assert.equal((await storage.getEvent(created.id)).platform, "ACC");
    for (const invalid of ["x".repeat(121), 4]) {
      assert.equal((await api(created.id, { platform: invalid }, role, "PUT", "")).status, 400);
      assert.equal((await storage.getEvent(created.id)).platform, "ACC");
    }
    assert.equal((await api(created.id, { platform: "x".repeat(120) }, role, "PUT", "")).status, 200);
    await api(created.id, { platform: "   " }, role, "PUT", "");
    assert.equal((await storage.getEvent(created.id)).platform, null);
    await api(created.id, { platform: "iRacing" }, role, "PUT", "");
    await api(created.id, { platform: null }, role, "PUT", "");
    assert.equal((await storage.getEvent(created.id)).platform, null);
    assert.equal((await api(created.id, { platform: "bad" }, "other", "PUT", "")).status, 403);
  });

for (const role of ["admin", "owner"])
  test(`${role}: persisted platform without photos or opt-in, independent GET, toggle and other-field save`, async () => {
    const e = await album(role === "owner" ? owner.id : null);
    const response = await api(e.id, { platform: "  iRacing  " }, role);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.id, e.id); assert.equal(result.platform, "iRacing"); assert.equal(result.enabled, false);
    assert.equal(result.saveStatus, "saved");
    assert.equal(result.referenceRevision, 1); assert.equal(result.photoMatchingRevision, 0);
    if (role === "owner") assert.equal(result.safetyCheckStatus, "unavailable");
    for (const enabled of [true, false]) {
      const toggle = await (await api(e.id, { enabled }, role)).json();
      assert.equal(toggle.platform, "iRacing"); assert.equal(toggle.enabled, enabled);
    }
    assert.equal((await api(e.id, { title: "Other field saved" }, role, "PUT", "")).status, 200);
    const independent = await (await api(e.id, undefined, role, "GET", "")).json();
    assert.equal(independent.platform, "iRacing"); assert.equal(independent.photoMatchingEnabled, false);
    const matching = await (await api(e.id, undefined, role)).json();
    assert.equal(matching.platform, "iRacing"); assert.deepEqual(matching.photos, []);
    const stored = await storage.getEvent(e.id);
    assert.equal(stored.platform, "iRacing"); assert.equal(stored.referenceRevision, 2);
    assert.equal(stored.photoMatchingRevision, 2);
    if (role === "owner") {
      assert.equal(stored.safetyStatus, "error");
      assert.ok(stored.contentVersion > stored.safetyVersion);
    }
    const unchanged = await (await api(e.id, { platform: "iRacing" }, role)).json();
    assert.equal(unchanged.saveStatus, "unchanged"); assert.equal(unchanged.contentVersion, stored.contentVersion);
    assert.equal((await api(e.id, { platform: "" }, role)).status, 200);
    assert.equal((await storage.getEvent(e.id)).platform, null);
    await api(e.id, { platform: "ACC" }, role);
    await api(e.id, { platform: null }, role);
    assert.equal((await storage.getEvent(e.id)).platform, null);
  });

test("authorization, invalid and absent fields never write; lock rechecks ownership", async () => {
  const e = await album(owner.id);
  for (const [role, status] of [["other", 403], ["anonymous", 401]]) {
    assert.equal((await api(e.id, { platform: "bad" }, role)).status, status);
    assert.equal((await api(e.id, undefined, role)).status, status);
  }
  for (const body of [{}, { platform: "x".repeat(121) }, { enabled: null }, { platform: 4 }, { extra: true }]) {
    const response = await api(e.id, body, "owner");
    assert.equal(response.status, 400); assert.equal((await response.json()).saveStatus, "rejected");
  }
  assert.equal((await storage.getEvent(e.id)).contentVersion, 0);
  storage.getEvent = async id => {
    const event = await originalGet.call(storage, id);
    if (id === e.id) await db.update(events).set({ creatorId: other.id }).where(eq(events.id, id));
    return event;
  };
  try {
    const response = await api(e.id, { platform: "bad" }, "owner");
    assert.equal(response.status, 403); assert.equal((await response.json()).saveStatus, "rejected");
    assert.equal((await originalGet.call(storage, e.id)).platform, null);
  } finally { storage.getEvent = originalGet; }
});

test("parallel partial actions preserve both fields and post-commit reads cannot reject a save", async () => {
  const e = await album();
  const results = await Promise.all([api(e.id, { platform: "iRacing" }), api(e.id, { enabled: true })]);
  assert.ok(results.every(response => response.status === 200));
  const stored = await storage.getEvent(e.id);
  assert.equal(stored.platform, "iRacing"); assert.equal(stored.photoMatchingEnabled, true);
  assert.equal(stored.referenceRevision, 1); assert.equal(stored.photoMatchingRevision, 1);
  let reads = 0;
  storage.getEvent = async id => {
    if (++reads > 1) throw new Error("Synthetic post-commit read failure");
    return originalGet.call(storage, id);
  };
  try {
    const response = await api(e.id, { platform: "ACC" });
    assert.equal(response.status, 200); assert.equal((await response.json()).platform, "ACC");
    assert.equal(reads, 1, "acknowledgement is taken directly from the committed transaction");
  } finally { storage.getEvent = originalGet; }
  assert.equal((await storage.getEvent(e.id)).platform, "ACC");
});

test("client validates authoritative response and distinguishes rejection from unknown without retries", async () => {
  const result = { id: 42, enabled: false, platform: "iRacing", contentVersion: 2,
    referenceRevision: 1, photoMatchingRevision: 0, saveStatus: "saved" };
  try {
    for (const [response, expected] of [
      [() => { throw new Error("Lost connection"); }, "unknown"],
      [() => new Response("{broken"), "unknown"],
      [() => Response.json({}), "unknown"],
      [() => Response.json({ ...result, id: 43 }), "unknown"],
      [() => Response.json({ ...result, enabled: "false" }), "unknown"],
      [() => Response.json({ ...result, platform: 1 }), "unknown"],
      [() => Response.json({ error: "upstream" }, { status: 503 }), "unknown"],
      [() => Response.json({ error: "Rejected", saveStatus: "rejected" }, { status: 400 }), "rejected"],
    ]) {
      let attempts = 0;
      globalThis.fetch = async () => { attempts++; return response(); };
      await assert.rejects(() => savePhotoMatchingSettings(42, { platform: "iRacing" }),
        reason => reason instanceof EventSaveError && reason.status === expected);
      assert.equal(attempts, 1);
    }
    globalThis.fetch = async () => Response.json(result);
    assert.equal((await savePhotoMatchingSettings(42, { platform: "  iRacing " })).platform, "iRacing");
  } finally { globalThis.fetch = async () => { throw new Error("External network forbidden"); }; }
});

test("lost database commit acknowledgement reports unknown, not rejection, even when the value exists", async () => {
  const e = await album();
  db.transaction = async callback => {
    await originalTransaction.call(db, callback);
    throw new Error("Synthetic lost COMMIT acknowledgement");
  };
  try {
    const response = await api(e.id, { platform: "iRacing" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).saveStatus, "unknown");
  } finally { db.transaction = originalTransaction; }
  assert.equal((await storage.getEvent(e.id)).platform, "iRacing");
});
