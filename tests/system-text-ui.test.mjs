import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const admin = { id: 880001, username: "Synthetic admin", isAdmin: true, isCreator: true };
const event = { id: 880002, title: "Synthetic empty event", date: "2026-07-12", creatorId: null };

test("empty galleries and app, auth, admin and creator load errors are English", { timeout: 150000 }, async () => {
  const browser = await uiBrowser();
  let failure;
  let requests = 0;
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    const failed = path === failure || (failure === "startup" && path === "/src/main.tsx");
    if (failed) requests++;
    const data = failed ? { error: "Synthetic failure" }
      : path === "/api/user" ? admin
      : path === `/api/events/${event.id}` ? event
      : path === "/api/admin/safety" ? { media: [], events: [] }
      : path === "/api/creator/usage" ? { bytes: 0, galleries: 0, photos: 0, unknown: 0,
        pendingCleanup: 0, limits: { bytes: 500000000, galleries: 5, photos: 1000, imageBytes: 5000000 },
        exception: false, adminExempt: true, eventStats: [] }
      : path === "/api/admin/media-usage" ? null : [];
    void browser.command("Fetch.fulfillRequest", {
      requestId, responseCode: failed ? 500 : 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(data)).toString("base64"),
    });
  });
  try {
    await browser.command("Network.enable");
    await browser.command("Network.setCacheDisabled", { cacheDisabled: true });
    // API interception never writes fixtures or grants backend permissions.
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    const visit = async (path, text) => {
      await browser.command("Page.navigate", { url: new URL(path, base).href });
      await browser.wait(`document.body?.innerText.includes(${JSON.stringify(text)})`);
    };
    await visit(`/events/${event.id}`, "No media available for this event yet.");
    assert.equal(await browser.evaluate("document.querySelector('main').innerText.includes('No media available for this event yet.')"), true);
    for (const [path, api, text, button] of [
      ["/admin/dashboard", "/api/user", "Your sign-in status could not be checked. Please try again.", "Reload page"],
      ["/admin/dashboard", "/api/admin/events", "Dashboard data could not be loaded.", "Try again"],
      ["/admin/dashboard", "/api/media", "Dashboard data could not be loaded.", "Try again"],
      ["/admin/users", "/api/admin/users", "User management could not be loaded.", "Reload page"],
      ["/admin/dashboard", "/api/admin/media-usage", "The storage overview could not be loaded.", "Try again"],
      ["/creator/dashboard", "/api/creator/events", "Creator data could not be loaded.", "Reload page"],
    ]) {
      failure = api;
      await visit(path, text);
      const buttons = await browser.evaluate("[...document.querySelectorAll('[role=alert] button')].map(b=>b.textContent)");
      assert.ok(buttons.includes(button), `${api}: ${buttons}`);
      const before = requests;
      await browser.evaluate(`document.querySelector('[role=alert] button').click()`);
      for (let i = 0; i < 50 && requests <= before; i++) await delay(100);
      await browser.wait(`document.body?.innerText.includes(${JSON.stringify(text)})`);
      await browser.wait("document.querySelector('[role=alert] button') !== null");
      assert.ok(requests > before, `${api}: retry must retain its existing action`);
    }
    failure = "startup";
    await browser.command("Fetch.disable");
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/src/main.tsx*", requestStage: "Request" }] });
    // Public SEO routes retain server-rendered content when JS fails, so use a
    // client-only route to exercise the empty-root startup alert.
    await visit("/admin/dashboard", "The application could not be loaded. Please try again.");
    assert.equal(await browser.evaluate("document.querySelector('[role=alert] button').textContent"), "Reload page");
  } finally { await browser.close(); }
});
