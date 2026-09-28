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
        if (response.status >= 400 &&
            !(response.status === 401 && response.url.endsWith("/api/user"))) {
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
    async function waitForPage(path, expected, { allowFailures = false } = {}) {
      const deadline = Date.now() + 25000;
      let state;
      while (Date.now() < deadline) {
        try {
          state = await evaluate("document.body && ({path:location.pathname, text:document.body.innerText, modules:[...document.scripts].map(s=>s.src), spinner:!!document.querySelector('.min-h-screen .animate-spin'), alert:!!document.querySelector('[role=alert]')})");
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
      assert.equal(state.spinner, false, `${path}: loading indicator still visible`);
      assert.ok(state.modules.some(url => url.includes("/src/main.tsx")), "Vite entry script missing");
      await delay(300); // Include requests started just after the first paint.
      if (!allowFailures) assert.deepEqual(failures, [], `${path}: asset/API/browser errors`);
      return state;
    }
    async function visit(path, expected, options) {
      failures.length = 0;
      await instance.send("Page.navigate", { url: new URL(path, base).href }, sessionId);
      return waitForPage(path, expected, options);
    }
    async function failApi(path) {
      const listener = event => {
        if (event.sessionId === sessionId && event.method === "Fetch.requestPaused") {
          void instance.send("Fetch.fulfillRequest", {
            requestId: event.params.requestId,
            responseCode: 500,
            responseHeaders: [{ name: "content-type", value: "application/json" }],
            body: Buffer.from('{"error":"Test failure"}').toString("base64"),
          }, sessionId);
        }
      };
      instance.listeners.add(listener);
      await instance.send("Fetch.enable", { patterns: [{ urlPattern: `*${path}*`, requestStage: "Request" }] }, sessionId);
      return async () => {
        await instance.send("Fetch.disable", {}, sessionId);
        instance.listeners.delete(listener);
      };
    }
    async function waitForRedirect(expected) {
      const deadline = Date.now() + 15000;
      let state;
      while (Date.now() < deadline) {
        try {
          state = await evaluate("({path:location.pathname, search:location.search, hash:location.hash, text:document.body?.innerText || ''})");
        } catch (error) {
          if (!/context|document|Uncaught/.test(String(error))) throw error;
          await delay(100);
          continue;
        }
        if (state.path === expected.path && state.text.includes(expected.text)) return state;
        await delay(150);
      }
      assert.fail(`Expected ${expected.path} (${expected.text}), got ${JSON.stringify(state)?.slice(0, 400)}`);
    }
    async function submitLogin(username, password) {
      await evaluate(`(() => {
        for (const [id, value] of ${JSON.stringify([["login-username", username], ["login-password", password]])}) {
          const input = document.getElementById(id);
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        document.querySelector('#login-password').closest('form').querySelector('button[type="submit"]').click();
      })()`);
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
      // A late request from the previous page can set a fresh session cookie
      // after logout; isolate each disposable role before checking its boundary.
      await instance.send("Network.clearBrowserCookies", {}, sessionId);
      const before = await instance.send("Network.getCookies", { urls: [base] }, sessionId);
      assert.ok(!before.cookies.some(cookie => cookie.name === "vco.sid"), `${role}: previous browser session persisted`);
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
      const target = role === "admin" ? "/admin/users?from=login#users"
        : role === "creator" || role === "approved" ? "/creator/dashboard"
        : "/creator/apply";
      await visit(target, { path: "/auth", text: "Login" });
      assert.equal(new URLSearchParams(await evaluate("location.search")).get("next"), target);
      await submitLogin(username, password);
      const destination = role === "admin" ? "/admin/users" : target;
      const landed = await waitForRedirect({
        path: destination,
        text: role === "admin" ? "USER MANAGEMENT"
          : role === "creator" || role === "approved"
            ? "CREATOR DASHBOARD"
            : "BECOME A VCO CREATOR",
      });
      if (role === "admin") {
        assert.equal(landed.search, "?from=login");
        assert.equal(landed.hash, "#users");
      }
      const cookies = await instance.send("Network.getCookies", { urls: [base] }, sessionId);
      const sessionCookie = cookies.cookies.find(cookie => cookie.name === "vco.sid");
      assert.ok(sessionCookie, `${role}: login did not establish a session`);
      const cookie = `vco.sid=${sessionCookie.value}`;

      if (role !== "admin") {
        await visit("/auth?next=%2Fadmin%2Fdashboard", { path: "/", text: "VCO" });
      } else {
        await visit("/auth?next=https%3A%2F%2Fexample.com%2F", { path: "/", text: "VCO" });
        await visit("/auth?next=%2F%2Fexample.com%2F", { path: "/", text: "VCO" });
        await visit("/auth?next=%2Fnot-a-protected-page", { path: "/", text: "VCO" });
        await visit("/auth?next=%2Fcreator%2Fdashboard", {
          path: "/creator/dashboard",
          text: "CREATOR DASHBOARD",
        });
        await visit("/", { path: "/", text: "VCO" });
        failures.length = 0;
        assert.equal(await evaluate("!!document.querySelector('a[href=\"/admin/dashboard\"]')"), true, "Admin menu link missing");
        await evaluate("document.querySelector('a[href=\"/admin/dashboard\"]').click()");
        await waitForPage("/admin/dashboard", { path: "/admin/dashboard",
          text: "ADMIN DASHBOARD" });
      }
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
      if (role === "admin") {
        // Exercise both responsive admin layouts with disposable user/event fixtures.
        const fixture = await fetch(new URL("/api/events", base), {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ title: `Mobile admin ${randomUUID().slice(0, 8)}`, date: new Date().toISOString(), description: "Viewport fixture" }),
        });
        assert.equal(fixture.status, 201, "create disposable admin event");
        const event = await fixture.json();
        try {
          await pool.query(
            "INSERT INTO media_items (event_id, type, url, thumbnail, caption) VALUES ($1, 'image', $2, $2, 'Mobile edit fixture')",
            [event.id, "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="],
          );
          await instance.send("Emulation.setDeviceMetricsOverride", {
            width: 360, height: 640, deviceScaleFactor: 1, mobile: true,
          }, sessionId);
          const noOverflow = async context => {
            const metrics = await evaluate("({width:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth})");
            assert.ok(metrics.scroll <= metrics.width + 1, `${context}: horizontal overflow ${JSON.stringify(metrics)}`);
          };
          await visit("/admin/users", { path: "/admin/users", text: "USER MANAGEMENT" });
          await noOverflow("mobile users");
          assert.equal(await evaluate("!!document.querySelector('section[aria-label^=\"User \"] dl')"), true);
          assert.equal(await evaluate("getComputedStyle(document.querySelector('table').parentElement.parentElement).display"), "none");
          assert.equal(await evaluate("!!document.querySelector('section[aria-label^=\"User \"] button')"), true, "mobile role action missing");
          const fixtureUser = accounts[0];
          const username = (await (await fetch(new URL("/api/admin/users", base), { headers: { Cookie: cookie } })).json())
            .find(user => user.id === fixtureUser).username;
          await evaluate(`document.querySelector('section[aria-label=${JSON.stringify(`User ${username}`)}] button:last-child').click()`);
          const roleDeadline = Date.now() + 5000;
          while (Date.now() < roleDeadline) {
            if ((await pool.query("SELECT is_creator FROM users WHERE id = $1", [fixtureUser])).rows[0]?.is_creator) break;
            await delay(100);
          }
          assert.equal((await pool.query("SELECT is_creator FROM users WHERE id = $1", [fixtureUser])).rows[0]?.is_creator, true, "mobile role action did not apply");
          await evaluate("document.querySelector('button[aria-label=\"Open navigation\"]').click()");
          assert.equal(await evaluate("!!document.querySelector('nav[aria-label=\"Mobile navigation\"] a[href=\"/admin/dashboard\"]')"), true);
          await evaluate("document.querySelector('nav[aria-label=\"Mobile navigation\"] a[href=\"/admin/dashboard\"]').click()");
          await waitForPage("/admin/dashboard", { path: "/admin/dashboard", text: "ADMIN DASHBOARD" });
          await noOverflow("mobile dashboard");
          await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Create VCO Event')).click()");
          assert.equal(await evaluate("!!document.querySelector('[role=dialog] input[type=date]')"), true);
          assert.equal(await evaluate("!!document.querySelector('[role=dialog] #image-source')"), true);
          assert.equal(await evaluate("!!document.querySelector('[role=dialog] button')"), true);
          assert.equal(await evaluate("(() => {const d=document.querySelector('[role=dialog]'); return d.scrollHeight>d.clientHeight && d.getBoundingClientRect().bottom<=innerHeight})()"), true, "event form should scroll inside viewport");
          await evaluate("document.querySelector('#image-source').focus(); document.querySelector('#image-source').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}))");
          for (let i = 0; i < 20 && !await evaluate("!!document.querySelector('[role=option]')"); i++)
            await delay(100);
          assert.equal(await evaluate("[...document.querySelectorAll('[role=option]')].some(o=>o.textContent.includes('Nextcloud'))"), true, "Nextcloud selection inaccessible");
          await evaluate("[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.includes('Nextcloud')).click()");
          assert.equal(await evaluate("!!document.querySelector('[role=dialog] input[type=url]')"), true, "Nextcloud link field missing");
          assert.equal(await evaluate("!!document.querySelector('[role=dialog] input[type=password]')"), true, "Nextcloud password field missing");
          await noOverflow("mobile Nextcloud dialog");
          await evaluate("document.querySelector('[role=dialog] button:has(svg.lucide-x)').click()");
          for (let i = 0; i < 20 && await evaluate("!!document.querySelector('[role=dialog]')"); i++)
            await delay(100);
          await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.includes('Media Management')).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))");
          for (let i = 0; i < 20 && !await evaluate("!!document.querySelector('select[aria-label=\"Select event for media management\"]')"); i++)
            await delay(100);
          assert.equal(await evaluate("!!document.querySelector('select[aria-label=\"Select event for media management\"]')"), true,
            `media tab missing: ${JSON.stringify(await evaluate("({tabs:[...document.querySelectorAll('[role=tab]')].map(t=>[t.textContent,t.getAttribute('data-state')]),dialog:!!document.querySelector('[role=dialog]'),panels:[...document.querySelectorAll('[role=tabpanel]')].map(p=>[p.getAttribute('data-state'),p.textContent.slice(0,60)])})"))}`);
          await noOverflow("mobile media tab");
          await evaluate(`(() => {const s=document.querySelector('select[aria-label="Select event for media management"]'); s.value=${JSON.stringify(String(event.id))}; s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          for (let i = 0; i < 20 && !await evaluate("document.body.innerText.includes('Mobile edit fixture')"); i++)
            await delay(100);
          assert.equal(await evaluate("document.body.innerText.includes('Mobile edit fixture')"), true);
          assert.equal(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Previous') && [...document.querySelectorAll('button')].some(b=>b.textContent==='Next')"), true, "media pagination missing");
          await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Edit Media')).click()");
          assert.equal(await evaluate("!!document.querySelector('[role=dialog] input#tags')"), true);
          assert.equal(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().bottom<=innerHeight"), true);
          await evaluate("document.querySelector('[role=dialog] button:has(svg.lucide-x)').click()");
          for (let i = 0; i < 20 && await evaluate("!!document.querySelector('[role=dialog]')"); i++)
            await delay(100);
          await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Upload Media')).click()");
          assert.equal(await evaluate("!!document.querySelector('[role=dialog] button[type=button]')"), true, "upload file picker inaccessible");
          assert.equal(await evaluate("document.querySelector('[role=dialog]').getBoundingClientRect().bottom<=innerHeight"), true);
          await evaluate("document.querySelector('[role=dialog] button:has(svg.lucide-x)').click()");
          await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.includes('Race Series')).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))");
          await noOverflow("mobile series tab");
          await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Add Series')).click()");
          assert.equal(await evaluate("!!document.querySelector('input[aria-label=\"Series logo\"]')"), true);
          await noOverflow("mobile series form");
          await instance.send("Emulation.setDeviceMetricsOverride", {
            width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
          }, sessionId);
          await visit("/admin/users", { path: "/admin/users", text: "USER MANAGEMENT" });
          await noOverflow("desktop users");
          assert.notEqual(await evaluate("getComputedStyle(document.querySelector('table').parentElement.parentElement).display"), "none");
          assert.equal(await evaluate("!!document.querySelector('table button')"), true, "desktop role action missing");
          await visit("/admin/dashboard", { path: "/admin/dashboard", text: "ADMIN DASHBOARD" });
          await noOverflow("desktop dashboard");
          await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.includes('Race Series')).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))");
          for (let i = 0; i < 20 && !await evaluate("document.body.innerText.includes('RACE SERIES MANAGEMENT')"); i++)
            await delay(100);
          assert.equal(await evaluate("document.body.innerText.includes('RACE SERIES MANAGEMENT')"), true);
          await evaluate("[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent==='Events').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))");
          await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Create VCO Event')).click()");
          assert.equal(await evaluate("!!document.querySelector('[role=dialog] input#title')"), true, "desktop event dialog missing");
          await evaluate("document.querySelector('[role=dialog] button:has(svg.lucide-x)').click()");
        } finally {
          await instance.send("Emulation.clearDeviceMetricsOverride", {}, sessionId);
          const removed = await fetch(new URL(`/api/events/${event.id}`, base), {
            method: "DELETE", headers: { Cookie: cookie },
          });
          assert.ok(removed.ok, "remove disposable event");
        }
        let restore = await failApi("/api/events");
        try {
          const state = await visit("/admin/dashboard",
            { path: "/admin/dashboard", text: "Die Dashboard-Daten konnten nicht geladen werden" },
            { allowFailures: true });
          assert.equal(state.alert, true);
        } finally { await restore(); }
        failures.length = 0;
        await evaluate("document.querySelector('[role=alert] button').click()");
        await waitForPage("/admin/dashboard", { path: "/admin/dashboard", text: "ADMIN DASHBOARD" });

        restore = await failApi("/api/media");
        try {
          const state = await visit("/admin/dashboard",
            { path: "/admin/dashboard", text: "Die Dashboard-Daten konnten nicht geladen werden" },
            { allowFailures: true });
          assert.equal(state.alert, true, "Media API failure must offer a retry");
        } finally { await restore(); }
        failures.length = 0;
        await evaluate("document.querySelector('[role=alert] button').click()");
        await waitForPage("/admin/dashboard", { path: "/admin/dashboard", text: "ADMIN DASHBOARD" });

        restore = await failApi("/api/user");
        try {
          const state = await visit("/admin/dashboard",
            { path: "/admin/dashboard", text: "Die Anmeldung konnte nicht geprüft werden" },
            { allowFailures: true });
          assert.equal(state.alert, true);
        } finally { await restore(); }
        failures.length = 0;
        await evaluate("document.querySelector('[role=alert] button').click()");
        await waitForPage("/admin/dashboard", { path: "/admin/dashboard", text: "ADMIN DASHBOARD" });

        await instance.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
        restore = await failApi("/src/main.tsx");
        try {
          const state = await visit("/admin/dashboard",
            { path: "/admin/dashboard", text: "Die Anwendung konnte nicht geladen werden" },
            { allowFailures: true });
          assert.equal(state.alert, true, "Module failure must offer a retry");
        } finally {
          await restore();
          await instance.send("Network.setCacheDisabled", { cacheDisabled: false }, sessionId);
        }
        failures.length = 0;
        await evaluate("document.querySelector('[role=alert] button').click()");
        await waitForPage("/admin/dashboard", { path: "/admin/dashboard", text: "ADMIN DASHBOARD" });
      }
      assert.equal(await evaluate('fetch("/api/logout", { method: "POST" }).then(response => response.status)'), 200);
      await instance.send("Network.clearBrowserCookies", {}, sessionId);
    }
  } finally {
    instance.socket.close();
    instance.process.kill("SIGTERM");
    await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [accounts]);
    await pool.end();
  }
});