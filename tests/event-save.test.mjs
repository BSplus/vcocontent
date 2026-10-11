import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";

process.env.RESEND_API_KEY = "synthetic-key";
process.env.RESEND_FROM = "verify@example.test";
process.env.PUBLIC_SITE_URL = "https://example.test";
const { storage } = await import("../server/storage.ts");
const { db, pool } = await import("../server/db.ts");
const { events } = await import("../shared/schema.ts");
const { registerRoutes } = await import("../server/routes.ts");
const { registerRequestParsers } = await import("../server/request-parsers.ts");
const { saveEvent, EventSaveError } = await import("../client/src/lib/event-save.ts");
const fixture = { id: 95601, title: "Save fixture", description: "Fixture", date: new Date("2026-10-11"),
  creatorId: null, customThumbnail: "data:image/png;base64," + "A".repeat(2_000_000),
  coverImage: null, isPremium: false, visibility: "draft", contentVersion: 4, referenceRevision: 3,
  safetyStatus: "approved", safetyVersion: 4, safetyPolicy: "fixture" };
let event, writes, reads, failAfterCommit, writeFails, server, base;
const original = { getEvent: storage.getEvent, updateEvent: storage.updateEvent,
  transaction: db.transaction, execute: db.execute, select: db.select };
const call = (body, role = "admin") => fetch(`${base}/api/events/${fixture.id}`, {
  method: "PUT", headers: { "content-type": "application/json", "x-role": role }, body: JSON.stringify(body),
});
test.before(async () => {
  storage.getEvent = async () => {
    reads++;
    if (failAfterCommit && writes) throw new Error("synthetic post-commit read outage");
    return { ...event };
  };
  storage.updateEvent = async (_id, changes) => {
    if (writeFails) throw new Error("synthetic write outage");
    writes++; event = { ...event, ...changes };
    if (event.creatorId && ["title", "description", "round", "track", "platform"].some(k => k in changes))
      event = { ...event, contentVersion: event.contentVersion + 1, safetyStatus: "error", safetyReason: "Safety check pending." };
    return { ...event };
  };
  const app = express();
  registerRequestParsers(app);
  app.use((req, _res, next) => {
    const role = req.headers["x-role"];
    if (role !== "anonymous") req.user = { id: role === "stranger" ? 88 : 87,
      isAdmin: role === "admin", creatorStatus: "approved", emailVerifiedAt: new Date(), suspended: role === "suspended" };
    req.isAuthenticated = () => !!req.user;
    next();
  });
  server = await registerRoutes(app, { workers: false });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => { event = { ...fixture }; writes = reads = 0; failAfterCommit = writeFails = false; });
test.after(async () => {
  storage.getEvent = original.getEvent; storage.updateEvent = original.updateEvent;
  db.transaction = original.transaction; db.execute = original.execute; db.select = original.select;
  await new Promise(resolve => server.close(resolve));
  storage.sessionStore.close(); await pool.end();
});

test("baseline reproduction: Drizzle rejects the old empty update instruction", () => {
  assert.throws(() => db.update(events).set({}), /No values to set/);
});
test("empty, identical and stripped changes do not write or change safety/version state", async () => {
  for (const body of [{}, { title: event.title, date: event.date }, { creatorId: 999 }, { safetyStatus: "approved" }]) {
    const response = await call(body);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: event.id, saveStatus: "unchanged" });
    assert.deepEqual(event, fixture); assert.equal(writes, 0);
  }
  event.creatorId = 87;
  assert.equal((await call({ isPremium: true, creditCost: 20 }, "owner")).status, 200);
  assert.equal(writes, 0);
});
test("storage itself skips empty and identical updates under the row lock", async () => {
  let mutations = 0;
  db.transaction = async callback => callback({
    select: () => ({ from: () => ({ where: () => ({ for: async () => [event] }) }) }),
    update: () => { mutations++; throw new Error("must not update"); },
  });
  try {
    for (const changes of [{}, { title: event.title }, { date: new Date(event.date) }, { track: undefined }]) {
      const result = await original.updateEvent.call(storage, event.id, changes);
      assert.equal(result.saveStatus, "unchanged");
      assert.equal(result.contentVersion, fixture.contentVersion);
      assert.equal(result.referenceRevision, fixture.referenceRevision);
    }
    assert.equal(mutations, 0);
  } finally { db.transaction = original.transaction; }
});
test("official commit acknowledgement does not reread, and excludes large historical image data", async () => {
  failAfterCommit = true;
  const response = await call({ title: "Saved fixture" });
  const text = await response.text(), result = JSON.parse(text);
  assert.equal(response.status, 200); assert.equal(result.saveStatus, "saved");
  assert.equal(result.title, "Saved fixture"); assert.equal(reads, 1); assert.equal(writes, 1);
  assert.ok(text.length < 1500); assert.ok(!text.includes("base64"));
  failAfterCommit = false;
  const independent = await fetch(`${base}/api/events/${fixture.id}`, { headers: { "x-role": "admin" } });
  assert.equal((await independent.json()).title, "Saved fixture");
});
test("authorisation and image/schema validation still reject without writing", async () => {
  for (const [role, status] of [["anonymous", 401], ["stranger", 403], ["suspended", 403]])
    assert.equal((await call({}, role)).status, status);
  for (const body of [{ title: "" }, { customThumbnail: "https://example.test/foreign.png" }]) {
    const response = await call(body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).saveStatus, "rejected"); assert.equal(writes, 0);
  }
  event.creatorId = 87;
  assert.equal((await call({ customThumbnail: "data:image/png;base64,YmFk" }, "owner")).status, 400);
  assert.equal(writes, 0);
});
test("explicit image and series removal is valid and independently readable", async () => {
  event.seriesId = 42;
  const response = await call({ customThumbnail: null, coverImage: null, seriesId: null });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).saveStatus, "saved");
  const saved = await (await fetch(`${base}/api/events/${fixture.id}`, { headers: { "x-role": "admin" } })).json();
  assert.equal(saved.customThumbnail, null); assert.equal(saved.coverImage, null); assert.equal(saved.seriesId, null);
});
test("creator safety remains private and post-commit review failure confirms save without stale approval", async () => {
  event.creatorId = 87;
  // A safety-lane database outage occurs after the content transaction commits.
  db.execute = async () => { throw new Error("synthetic safety outage"); };
  try {
    const response = await call({ title: "Creator saved fixture" }, "owner");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: event.id, saveStatus: "saved", safetyCheckStatus: "unavailable" });
    assert.equal(writes, 1); assert.equal(event.safetyStatus, "error");
    assert.equal(event.contentVersion, fixture.contentVersion + 1);
    const read = await fetch(`${base}/api/events/${fixture.id}`, { headers: { "x-role": "owner" } });
    const saved = await read.json();
    assert.equal(saved.title, "Creator saved fixture"); assert.equal(saved.safetyStatus, "error");
  } finally { db.execute = original.execute; }
});
test("creator response reads actual safety state after review, not the pre-review write result", async () => {
  event.creatorId = 87;
  // Exhausted safety quota leaves the actual pending/error status unchanged.
  db.execute = async () => ({ rows: [] });
  try {
    const response = await call({ title: "Creator pending fixture" }, "owner");
    const result = await response.json();
    assert.equal(result.saveStatus, "saved");
    assert.equal(result.safetyStatus, "error"); assert.equal(result.contentVersion, 5);
    assert.equal(reads, 3, "ownership, initial event, actual post-review state");
  } finally { db.execute = original.execute; }
});
test("client makes one attempt and distinguishes rejection from lost/invalid acknowledgement", async () => {
  const fetchOriginal = globalThis.fetch;
  let attempts = 0;
  try {
    const noChange = await saveEvent(fixture.id, {});
    assert.equal(noChange.saveStatus, "unchanged");
    for (const [response, status] of [
      [() => { throw new TypeError("Load failed"); }, "unknown"],
      [() => new Response("broken JSON"), "unknown"],
      [() => Response.json({ id: fixture.id, title: "not an acknowledgement" }), "unknown"],
      [() => Response.json({ id: fixture.id + 1, saveStatus: "saved" }), "unknown"],
      [() => Response.json({ error: "gateway" }, { status: 502 }), "unknown"],
      [() => new Response("bad error page", { status: 400 }), "unknown"],
      [() => Response.json({ error: "Image rejected" }, { status: 400 }), "rejected"],
    ]) {
      attempts = 0;
      globalThis.fetch = async () => { attempts++; return response(); };
      await assert.rejects(() => saveEvent(fixture.id, { title: "Changed" }),
        error => error instanceof EventSaveError && error.status === status);
      assert.equal(attempts, 1);
    }
    globalThis.fetch = async () => Response.json({ id: fixture.id, saveStatus: "saved" });
    assert.equal((await saveEvent(fixture.id, { title: "Changed" })).saveStatus, "saved");
  } finally { globalThis.fetch = fetchOriginal; }
});
