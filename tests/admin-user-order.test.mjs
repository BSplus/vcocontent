import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../server/db.ts";
import { users } from "../shared/schema.ts";
import { storage } from "../server/storage.ts";
import { registerRoutes } from "../server/routes.ts";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const preview = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const accounts = [];
let server, base, admin, expected;

async function request(path, user = admin, method = "GET", body) {
  return fetch(base + path, {
    method,
    headers: {
      ...(user ? { "x-test-user": String(user.id) } : {}),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function assertOrder(list) {
  assert.deepEqual(list.filter(user => accounts.some(a => a.id === user.id)).map(user => user.id), expected);
  for (let i = 1; i < list.length; i++) {
    const previous = list[i - 1], current = list[i];
    const difference = +new Date(previous.createdAt) - +new Date(current.createdAt);
    assert.ok(difference > 0 || difference === 0 && previous.id > current.id, "createdAt DESC, id DESC");
  }
  assert.ok(list.every(user => !Object.hasOwn(user, "password")), "passwords must be omitted");
}

test.before(async () => {
  const token = randomUUID();
  // Deliberately disagree with insertion/ID order and include a timestamp tie.
  for (const [index, date] of ["2026-01-01", "2026-03-01", "2026-02-01", "2026-02-01"].entries()) {
    const [user] = await db.insert(users).values({
      username: `order-${token}-${index}`, email: `${token}-${index}@example.invalid`,
      password: "synthetic-unused", createdAt: new Date(date),
      isAdmin: index === 0, isCreator: index !== 0, creatorStatus: "pending",
    }).returning();
    accounts.push(user);
  }
  admin = accounts[0];
  expected = [accounts[1].id, accounts[3].id, accounts[2].id, admin.id];
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    const id = Number(req.headers["x-test-user"]);
    req.user = accounts.some(user => user.id === id) ? await storage.getUser(id) : undefined;
    req.isAuthenticated = () => !!req.user;
    next();
  });
  server = await registerRoutes(app, { workers: false });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    server.close();
    await once(server, "close");
  }
  if (accounts.length) await db.delete(users).where(inArray(users.id, accounts.map(user => user.id)));
  await pool.end();
});

test("real database order, repeat queries, administrative changes and access boundaries", async () => {
  assertOrder(await storage.getAllUsers());
  // The pending-creator caller filters this query without reordering it.
  assertOrder((await storage.getAllUsers()).filter(user => user.creatorStatus === "pending"));
  assert.equal((await request("/api/admin/users", null)).status, 401);
  assert.equal((await request("/api/admin/users", accounts[1])).status, 403);
  const response = await request("/api/admin/users");
  assert.equal(response.status, 200);
  assertOrder(await response.json());
  assert.equal((await request(`/api/admin/users/${accounts[2].id}`, null, "PATCH",
    { action: "quota_exception", enabled: true })).status, 401);
  assert.equal((await request(`/api/admin/users/${accounts[2].id}`, accounts[1], "PATCH",
    { action: "quota_exception", enabled: true })).status, 403);
  const updated = await request(`/api/admin/users/${accounts[2].id}`, admin, "PATCH",
    { action: "quota_exception", enabled: true });
  assert.equal(updated.status, 200);
  assert.equal(Object.hasOwn(await updated.json(), "password"), false);
  await db.update(users).set({ bio: "Changed profile, not registration date" }).where(eq(users.id, accounts[3].id));
  assertOrder(await (await request("/api/admin/users")).json());
  assertOrder(await (await request("/api/admin/users")).json());
});

test("desktop and mobile preserve actual API order after reload and a role action", { timeout: 90000 }, async () => {
  const browser = await uiBrowser();
  let reads = 0, writes = 0;
  const pending = new Set();
  browser.listeners.add(event => {
    if (event.method !== "Fetch.requestPaused") return;
    const task = (async () => {
      const { requestId, request: intercepted } = event.params;
      const path = new URL(intercepted.url).pathname;
      let status = 200, content;
      if (path === "/api/user") content = await storage.getUser(admin.id);
      else if (path.startsWith("/api/admin/users")) {
        const response = await request(path, admin, intercepted.method,
          intercepted.postData ? JSON.parse(intercepted.postData) : undefined);
        status = response.status;
        content = await response.json();
        if (intercepted.method === "GET") { assertOrder(content); reads++; }
        else writes++;
      } else throw new Error(`Unexpected API request: ${path}`);
      await browser.command("Fetch.fulfillRequest", {
        requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(content)).toString("base64"),
      });
    })();
    pending.add(task);
    task.catch(error => browser.errors.push(String(error))).finally(() => pending.delete(task));
  });
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    const names = expected.map(id => accounts.find(user => user.id === id).username);
    for (const width of [1280, 360]) {
      await browser.command("Emulation.setDeviceMetricsOverride", {
        width, height: 900, deviceScaleFactor: 1, mobile: width < 500,
      });
      const selector = width < 500 ? 'section[aria-label^="User "] h2' : "tbody tr td:first-child";
      const rendered = `[...document.querySelectorAll(${JSON.stringify(selector)})].map(el=>el.textContent).filter(name=>${JSON.stringify(names)}.includes(name))`;
      const check = async () => {
        await browser.wait(`JSON.stringify(${rendered})===${JSON.stringify(JSON.stringify(names))}`);
        assert.deepEqual(await browser.evaluate(rendered), names);
        assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(width < 500 ? 'section[aria-label^="User "]' : "table")})).display!=="none"`), true);
      };
      await browser.command("Page.navigate", { url: new URL("/admin/users", preview).href });
      await check();
      const readBeforeReload = reads;
      await browser.command("Page.reload");
      await check();
      assert.ok(reads > readBeforeReload, "reload must query the server again");
      const target = accounts[1];
      const container = width < 500
        ? `document.querySelector('section[aria-label="User ${target.username}"]')`
        : `[...document.querySelectorAll('tbody tr')].find(row=>row.cells[0].textContent===${JSON.stringify(target.username)})`;
      const before = reads, writesBefore = writes;
      await browser.evaluate(`[...(${container}).querySelectorAll('button')].find(button=>button.textContent.includes('2× exception')&&!button.disabled).click()`);
      await browser.wait(`${container} && [...(${container}).querySelectorAll('button')].some(button=>button.textContent.includes(${JSON.stringify(width === 1280 ? "Remove 2× exception" : "Enable 2× exception")})&&!button.disabled)`);
      // A visible updated badge alone does not prove the invalidated query finished.
      assert.ok(writes > writesBefore);
      assert.ok(reads > before, "role action must refetch the ordered list");
      await check();
    }
    assert.deepEqual(browser.errors, []);
  } finally {
    await Promise.allSettled([...pending]);
    await browser.close();
  }
});
