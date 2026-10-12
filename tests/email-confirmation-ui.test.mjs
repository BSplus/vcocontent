import test from "node:test";
import assert from "node:assert/strict";
import { verificationEmail } from "../server/email-templates/verification.ts";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const token = "a".repeat(64);
const otherToken = "b".repeat(64);
const fixture = { id: 65001, username: "Fixture session", email: "fixture@example.test",
  isAdmin: false, isCreator: false, creatorStatus: "none", emailVerifiedAt: null };
const panel = `[data-testid="verification-status"]`;

test("email button → clear confirmation → unchanged session or explicit login (isolated API fixtures)", { timeout: 180000 }, async () => {
  const browser = await uiBrowser();
  let scenario = {};
  let currentUser = null;
  let confirmed = false;
  let userReads = 0;
  const writes = [];
  const mockErrors = [];
  const logs = [];
  browser.listeners.add(event => {
    if (event.method === "Runtime.consoleAPICalled") {
      logs.push(JSON.stringify(event.params.args));
    }
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const path = new URL(request.url).pathname;
    const run = scenario;
    const respond = async () => {
      let status = 200, body = [];
      if (request.method !== "GET") writes.push({ path, method: request.method, body: request.postData });
      if (path === "/api/email-verification/confirm") {
        assert.equal(request.method, "POST");
        assert.equal(new URL(request.url).search, "");
        assert.deepEqual(JSON.parse(request.postData), { token: run.token || token });
        if (run.confirmDelay) await delay(run.confirmDelay);
        if (run.networkError) {
          await browser.command("Fetch.failRequest", { requestId, errorReason: "ConnectionClosed" });
          return;
        }
        status = run.status || 200;
        body = run.response || (status === 200 ? { verified: true } : { error: `Synthetic ${run.reason || "failure"}` });
        confirmed = status === 200 && body.verified === true;
      } else if (path === "/api/user") {
        userReads++;
        const read = userReads;
        // Capture the old value before holding the initial lookup.
        body = currentUser ? { ...currentUser,
          emailVerifiedAt: confirmed && !run.otherAccount ? "2026-10-12T12:00:00Z" : currentUser.emailVerifiedAt } : null;
        status = body ? 200 : 401;
        if (read === 1 && run.initialDelay) await delay(run.initialDelay);
        if (read > 1 && run.sessionDelay) await delay(run.sessionDelay);
        if (read > 1 && run.sessionFailure) { status = 503; body = { error: "Synthetic session outage" }; }
      } else if (path === "/api/login" || path === "/api/register") {
        currentUser = { ...fixture, emailVerifiedAt: confirmed ? "2026-10-12T12:00:00Z" : null };
        body = currentUser;
      } else if (path === "/api/credits") body = { credits: 0 };
      else if (path === "/api/account/usage") body = {};
      if (Array.isArray(body) && new URL(request.url).searchParams.get("pagination") === "true")
        body = { items: body, page: 1, totalPages: 1, total: 0, pageSize: 48, hasMore: false };
      await browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64") });
    };
    respond().catch(error => {
      if (!/Invalid InterceptionId/.test(String(error))) mockErrors.push(String(error));
    });
  });
  const visit = async (options = {}, hash = `#verify=${token}`, next = "/privacy-policy") => {
    // Page.navigate can return while the previous document is still visible.
    await browser.command("Page.navigate", { url: "about:blank" });
    await browser.wait(`location.href === 'about:blank' && !document.querySelector(${JSON.stringify(panel)})`);
    scenario = options;
    currentUser = options.signedIn ? { ...fixture } : null;
    confirmed = false; userReads = 0; writes.length = 0;
    await browser.command("Page.navigate", { url: `${base}/auth?${new URLSearchParams({ next })}${hash}` });
  };
  const text = () => browser.evaluate(`document.querySelector(${JSON.stringify(panel)})?.textContent || ''`);
  const ready = () => browser.wait(`!!document.querySelector(${JSON.stringify(panel)}) && !document.querySelector(${JSON.stringify(panel)}).textContent.includes('Checking your current session') && !document.querySelector(${JSON.stringify(panel)}).textContent.includes('Confirming your email')`);
  const click = label => browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  const login = async () => {
    await browser.evaluate(`document.querySelector('#login-username').focus()`);
    await browser.command("Input.insertText", { text: fixture.username });
    await browser.evaluate(`document.querySelector('#login-password').focus()`);
    await browser.command("Input.insertText", { text: "Synthetic123!" });
    await browser.evaluate(`document.querySelector('#login-password').closest('form').requestSubmit()`);
    await browser.wait(`location.pathname === '/privacy-policy'`);
  };
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    // Use the actual email template CTA URL, with only the origin replaced for preview.
    const href = verificationEmail("https://example.test", `https://example.test/auth#verify=${token}`).html
      .match(/<a href="([^"]+)" target="_blank" style="display:inline-block/)[1];
    assert.equal(new URL(href).hash, `#verify=${token}`);
    await visit({ confirmDelay: 1200 }, new URL(href).hash);
    await browser.wait(`document.querySelector(${JSON.stringify(panel)})?.textContent.includes('Confirming your email')`);
    assert.equal(await browser.evaluate("location.hash"), "");
    assert.equal(await browser.evaluate("!!document.querySelector('#login-username')"), false);
    await ready();
    assert.match(await text(), /Email confirmed/);
    assert.match(await text(), /Verification does not sign you in/);
    assert.equal(await browser.evaluate("location.pathname"), "/auth");
    assert.equal(writes.length, 1);
    await click("Sign in");
    await browser.wait("!!document.querySelector('#login-username')");
    await login();
    assert.deepEqual(writes.map(w => w.path), ["/api/email-verification/confirm", "/api/login"]);

    for (const options of [
      { signedIn: true, initialDelay: 1500 },
      { signedIn: true, otherAccount: true, confirmDelay: 900 },
      { signedIn: true, sessionDelay: 1200 },
    ]) {
      await visit(options);
      await browser.wait(`document.querySelector(${JSON.stringify(panel)})?.textContent.includes('Email confirmed')`);
      if (options.sessionDelay) {
        assert.match(await text(), /Checking your current session/);
        assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Continue')`), false);
      }
      await ready();
      assert.match(await text(), /Fixture session.*Your current session has not changed/s);
      assert.doesNotMatch(await text(), /Your email.*verified/i);
      assert.equal(userReads >= 2, true);
      assert.equal(writes.length, 1, "No login or session switching");
      await delay(200);
      assert.equal(await browser.evaluate("location.pathname"), "/auth");
      await click("Continue");
      await browser.wait("location.pathname === '/privacy-policy'");
    }

    await visit({ signedIn: true, sessionFailure: true });
    await ready();
    assert.match(await text(), /Email confirmation succeeded, but/);
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Continue')`), false);
    scenario.sessionFailure = false;
    await click("Retry session check");
    await browser.wait(`document.querySelector(${JSON.stringify(panel)})?.textContent.includes('Your current session has not changed')`);
    assert.equal(writes.length, 1, "Retry only reads session");

    for (const reason of ["invalid", "expired", "already used"]) {
      await visit({ status: 400, reason });
      await ready();
      assert.match(await text(), /invalid, expired, or has already been used/);
      assert.doesNotMatch(await text(), /Email confirmed/);
      await click("Sign in to check Account");
      await browser.wait("!!document.querySelector('#login-username')");
      await login();
    }
    for (const options of [{ status: 503 }, { status: 429 }, { networkError: true }, { response: {} }]) {
      await visit(options);
      await ready();
      assert.match(await text(), /couldn’t confirm|couldn’t confirm/i);
      assert.match(await text(), /original email link again/);
      assert.doesNotMatch(await text(), /Email confirmed/);
      assert.equal(writes.length, 1, "Never retry a one-use token automatically");
    }
    for (const hash of ["#verify=%ZZ", "#verify=", "#verify=short"]) {
      await visit({}, hash);
      await ready();
      assert.match(await text(), /invalid, expired/);
      assert.equal(writes.length, 0);
      assert.equal(await browser.evaluate("location.hash"), "");
    }
    await visit({ signedIn: true, status: 400 });
    await ready();
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(panel)}+' a')?.getAttribute('href')`), "/account?tab=settings");
    assert.equal(await browser.evaluate(`!!document.querySelector(${JSON.stringify(panel)}+' a[href="/creator/apply"]')`), true);
    assert.equal(await browser.evaluate("!!document.querySelector('#login-username')"), false);

    // A second email opened while already on /auth must be handled, not lost.
    await visit();
    await ready();
    scenario.token = otherToken;
    await browser.evaluate(`location.hash='verify=${otherToken}'`);
    await browser.wait(`location.hash === '' && document.querySelector(${JSON.stringify(panel)})?.textContent.includes('Email confirmed')`);
    await ready();
    assert.equal(writes.length, 2);

    for (const width of [390, 320]) {
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
      await visit();
      await ready();
      assert.match(await text(), /Email confirmed/);
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
      await click("Sign in");
      await browser.wait("!!document.querySelector('#login-username')");
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
      await visit({ status: 400 });
      await ready();
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    }
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 844, deviceScaleFactor: 1, mobile: false });

    // Ordinary auth and registration still work, with safe, role-aware destinations.
    await visit({}, "");
    await browser.wait("!!document.querySelector('#login-username')");
    await login();
    assert.deepEqual(writes.map(w => w.path), ["/api/login"]);
    for (const next of ["https://foreign.example/path", "//foreign.example", "/auth", "/admin/users", "/creator/dashboard"]) {
      await visit({ signedIn: true }, "", next);
      await browser.wait("location.pathname === '/'");
      assert.equal(new URL(await browser.evaluate("location.href")).origin, new URL(base).origin);
    }
    await visit({}, "");
    await browser.wait("!!document.querySelector('#login-username')");
    await browser.evaluate(`document.querySelector('[role="tab"][data-state="inactive"]').focus()`);
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await browser.wait("!!document.querySelector('#register-email')");
    for (const [id, value] of [["register-username", "Fixture registration"], ["register-email", "fixture@example.test"], ["register-password", "Synthetic123!"]]) {
      await browser.evaluate(`document.getElementById(${JSON.stringify(id)}).focus()`);
      await browser.command("Input.insertText", { text: value });
    }
    await browser.evaluate("document.querySelector('#register-password').closest('form').requestSubmit()");
    await browser.wait("location.pathname === '/privacy-policy'");
    assert.deepEqual(writes.map(w => w.path), ["/api/register"]);
    assert.equal(logs.some(log => log.includes(token) || log.includes(otherToken)), false, "Tokens never appear in console logs");
    assert.deepEqual(mockErrors, []);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
