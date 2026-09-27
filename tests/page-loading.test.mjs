import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5000";
const chromium = process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function browser() {
  const process = spawn(chromium, [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", "--user-data-dir=/tmp/vco-smoke-" + randomUUID(),
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let output = "";
  process.stderr.on("data", chunk => { output += chunk.toString(); });
  try {
    const deadline = Date.now() + 15000;
    while (!output.match(/DevTools listening on (ws:\/\/\S+)/) && Date.now() < deadline) {
      if (process.exitCode !== null) throw new Error(`Chromium exited: ${output}`);
      await delay(100);
    }
    const endpoint = output.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
    assert.ok(endpoint, `Chromium did not start: ${output}`);
    const socket = new ws(endpoint);
    await once(socket, "open");
    let nextId = 0;
    const pending = new Map();
    const listeners = new Set();
    socket.on("message", bytes => {
      const message = JSON.parse(bytes.toString());
      if (message.id) {
        const resolver = pending.get(message.id);
        pending.delete(message.id);
        resolver?.(message);
      } else listeners.forEach(listener => listener(message));
    });
    const send = async (method, params = {}, sessionId) => {
      const id = ++nextId;
      const reply = new Promise(resolve => pending.set(id, resolve));
      socket.send(JSON.stringify({ id, method, params, sessionId }));
      const result = await reply;
      if (result.error) throw new Error(`${method}: ${result.error.message}`);
      return result.result;
    };
    return { process, socket, listeners, send };
  } catch (error) {
    process.kill("SIGTERM");
    throw error;
  }
}

test("browser pages, modules, loading states and role boundaries", { timeout: 120000 }, async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for disposable role fixtures");
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const instance = await browser();
  const accounts = [];
  try {
    const { targetId } = await instance.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await instance.send("Target.attachToTarget", { targetId, flatten: true });
    await instance.send("Page.enable", {}, sessionId);
    await instance.send("Runtime.enable", {}, sessionId);
    await instance.send("Network.enable", {}, sessionId);
    const failures = [];
    const listener = event => {
      if (event.sessionId !== sessionId) return;
      if (event.method === "Network.responseReceived") {
        const { response } = event.params;
        if (response.status >= 400 && !response.url.endsWith("/api/user")) {
          failures.push(`${response.status} ${response.url}`);
        }
      }
      if (event.method === "Network.loadingFailed" && !event.params.canceled)
        failures.push(`Network: ${event.params.errorText}`);
      if (event.method === "Runtime.exceptionThrown")
        failures.push(`Browser: ${event.params.exceptionDetails.text}`);
    };
    instance.listeners.add(listener);
    const evaluate = async expression => {
      const result = await instance.send("Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: true,
      }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    async function visit(path, expected) {
      failures.length = 0;
      await instance.send("Page.navigate", { url: new URL(path, base).href }, sessionId);
      const deadline = Date.now() + 15000;
      let state;
      while (Date.now() < deadline) {
        try {
          state = await evaluate("document.body && ({path:location.pathname, text:document.body.innerText, modules:[...document.scripts].map(s=>s.src)})");
        } catch (error) {
          // A navigation can invalidate the execution context between CDP calls.
          if (!/context|document|Uncaught/.test(String(error))) throw error;
          await delay(100);
          continue;
        }
        if (state?.path === expected.path && state.text.includes(expected.text)) break;
        await delay(150);
      }
      assert.equal(state.path, expected.path, `${path}: ${state.text.slice(0, 300)}`);
      assert.match(state.text, new RegExp(expected.text), `${path}: page stuck loading`);
      assert.ok(state.modules.some(url => url.includes("/src/main.tsx")), "Vite entry script missing");
      assert.deepEqual(failures, [], `${path}: asset/API/browser errors`);
    }
    await visit("/", { path: "/", text: "VCO" });
    await visit("/auth", { path: "/auth", text: "Login" });
    for (const path of ["/admin/dashboard", "/admin/users", "/creator/dashboard"]) {
      await visit(path, { path: "/auth", text: "Login" });
    }
    for (const path of ["/api/admin/users", "/api/creator/events"]) {
      const response = await fetch(new URL(path, base));
      assert.equal(response.status, 401, `${path}: anonymous access`);
    }

    for (const role of ["user", "creator", "approved", "admin"]) {
      const username = `page_smoke_${role}_${randomUUID().slice(0, 10)}`;
      const password = `${randomUUID()}Ab!`;
      const registered = await fetch(new URL("/api/register", base), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email: `${username}@example.invalid`, password }),
      });
      assert.equal(registered.status, 201);
      const account = await registered.json();
      accounts.push(account.id);
      if (role === "admin") {
        await pool.query("UPDATE users SET is_admin = true WHERE id = $1", [account.id]);
      } else if (role === "creator" || role === "approved") {
        await pool.query(
          "UPDATE users SET is_creator = $2, creator_status = 'approved' WHERE id = $1",
          [account.id, role === "creator"],
        );
      }
      const login = await fetch(new URL("/api/login", base), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      assert.equal(login.status, 200, await login.text());
      const cookie = login.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      await instance.send("Network.setCookie", {
        name: "vco.sid", value: cookie.split("=").slice(1).join("="),
        url: base,
      }, sessionId);
      await visit("/admin/dashboard", role === "admin"
        ? { path: "/admin/dashboard", text: "ADMIN DASHBOARD" }
        : { path: "/", text: "VCO" });
      await visit("/admin/users", role === "admin"
        ? { path: "/admin/users", text: "USER MANAGEMENT" }
        : { path: "/", text: "VCO" });
      await visit("/creator/dashboard", role !== "user"
        ? { path: "/creator/dashboard", text: "CREATOR DASHBOARD" }
        : { path: "/creator/apply", text: "BECOME A VCO CREATOR" });
      const adminApi = await fetch(new URL("/api/admin/users", base), { headers: { Cookie: cookie } });
      assert.equal(adminApi.status, role === "admin" ? 200 : 403);
      const creatorApi = await fetch(new URL("/api/creator/events", base), { headers: { Cookie: cookie } });
      assert.equal(creatorApi.status, role === "user" ? 403 : 200);
      await visit("/", { path: "/", text: "VCO" });
      const navigationDeadline = Date.now() + 5000;
      let navigation;
      while (Date.now() < navigationDeadline) {
        navigation = await evaluate("document.querySelector('nav[aria-label=\"Main navigation\"]')?.textContent");
        if (navigation?.includes("Creator dashboard") === (role !== "user")) break;
        await delay(100);
      }
      assert.equal(navigation?.includes("Creator dashboard"), role !== "user", `${role}: creator dashboard navigation`);
      await instance.send("Network.deleteCookies", { name: "vco.sid", url: base }, sessionId);
    }
  } finally {
    instance.socket.close();
    instance.process.kill("SIGTERM");
    await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [accounts]);
    await pool.end();
  }
});