import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const studio = "/creator/dashboard";
const envelope = { items: [], page: 1, totalPages: 1, hasMore: false };
const usage = {
  bytes: 0, galleries: 0, photos: 0, unknown: 0, pendingCleanup: 0,
  retainedBytes: 0, reservedBytes: 0, availableBytes: 500000000, capacityWarning: false,
  byType: [{type:"image",bytes:0,objects:0,unknown:0}], byGallery: [],
  limits: { bytes: 500000000, galleries: 5, photos: 1000, imageBytes: 5000000 },
  eventStats: [], exception: false, adminExempt: false,
};

for (const role of ["creator", "admin"]) {
  test(`${role} retains Creator Studio navigation on desktop and mobile, including loading and errors`,
    { timeout: 180000 }, async () => {
      const browser = await uiBrowser();
      const mockErrors = [], writes = [], held = [];
      let holdPath = null, failPath = null;
      const user = {
        id: 65100, username: "StudioFixture", email: "studio@example.invalid",
        isCreator: role === "creator", isAdmin: role === "admin",
        creatorStatus: role === "creator" ? "approved" : "none",
        emailVerifiedAt: "2026-01-01T00:00:00Z", bio: "",
      };
      const fulfill = (requestId, body, status = 200) => browser.command("Fetch.fulfillRequest", {
        requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64"),
      }).catch(error => {
        if (!String(error).includes("Invalid InterceptionId")) mockErrors.push(String(error));
      });
      browser.listeners.add(event => {
        if (event.method !== "Fetch.requestPaused") return;
        const { requestId, request } = event.params;
        const path = new URL(request.url).pathname;
        if (request.method !== "GET") {
          writes.push(`${request.method} ${path}`);
          void fulfill(requestId, { error: "Fixture disallows writes" }, 405);
          return;
        }
        if (path === holdPath) { held.push(requestId); return; }
        if (path === failPath) {
          void fulfill(requestId, { error: "Fixture studio failure" }, 503);
          return;
        }
        const body = path === "/api/user" ? user
          : path === "/api/creator/usage" ? { ...usage, adminExempt: role === "admin" }
          : path.startsWith("/api/account/") || path === "/api/media" ? envelope
          : [];
        void fulfill(requestId, body);
      });
      const visit = async path => {
        await browser.command("Page.navigate", { url: `${base}${path}` });
      };
      const ready = () => browser.wait(`!!document.querySelector('nav[aria-label="Creator Studio sections"]')`);
      const click = selector => browser.evaluate(`(() => {
        const e = document.querySelector(${JSON.stringify(selector)});
        if (!e) throw Error('Missing navigation control');
        e.click();
      })()`);
      const openMenu = async () => {
        await click('button[aria-label="Open navigation"]');
        await browser.wait(`!!document.querySelector('#mobile-navigation')`);
      };
      const assertLayout = async () => {
        const layout = await browser.evaluate(`(() => {
          const nav = document.querySelector('nav[aria-label="Main navigation"]').closest('header');
          const main = document.querySelector('main');
          return {
            logos: document.querySelectorAll('a[aria-label="VCO Media Database home"]').length,
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            navTop: nav.getBoundingClientRect().top,
            navBottom: nav.getBoundingClientRect().bottom,
            contentTop: (document.querySelector('h1') || main).getBoundingClientRect().top,
          };
        })()`);
        assert.equal(layout.logos, 1, "main navigation must appear exactly once");
        assert.ok(layout.scrollWidth <= layout.width + 1, "no horizontal overflow");
        assert.ok(layout.navTop >= 0 && layout.contentTop >= layout.navBottom,
          "navigation must not cover Studio content");
      };
      const assertCurrent = async mobile => {
        const selector = `${mobile ? "#mobile-navigation" : 'nav[aria-label="Main navigation"]'} a[href="${studio}"]`;
        assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-current')`), "page");
        assert.ok(await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).classList.contains('text-primary')`));
        assert.equal(await browser.evaluate(`!!document.querySelector(${JSON.stringify(`${mobile ? "#mobile-navigation" : 'nav[aria-label="Main navigation"]'} a[href="/admin/users"]`)})`), role === "admin");
      };
      const navigate = async (path, mobile) => {
        if (mobile) await openMenu();
        const selector = path === "/search" || path === "/account"
          ? `header a[href="${path}"]`
          : `${mobile ? "#mobile-navigation" : 'nav[aria-label="Main navigation"]'} a[href="${path}"]`;
        await click(selector);
        await browser.wait(`location.pathname === ${JSON.stringify(path)}`);
        if (mobile) await browser.wait(`!document.querySelector('#mobile-navigation') && !!document.querySelector('button[aria-label="Open navigation"]')`);
      };
      try {
        await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
        for (const width of [1920, 390]) {
          const mobile = width < 500;
          await browser.command("Emulation.setDeviceMetricsOverride", {
            width, height: 900, deviceScaleFactor: 1, mobile,
          });
          // Enter via existing main navigation, then verify a direct fresh entry.
          await visit("/archive-events");
          await browser.wait(`!!document.querySelector('a[href="${studio}"]')`);
          await navigate(studio, mobile);
          await ready();
          await visit(studio);
          await ready();
          await assertLayout();
          if (mobile) await openMenu();
          await assertCurrent(mobile);
          if (mobile) {
            await click(`#mobile-navigation a[href="${studio}"]`);
            await browser.wait(`!document.querySelector('#mobile-navigation')`);
          }
          for (const [section, expected] of [
            ["My Galleries", "No events created yet."],
            ["Account", "Account & public profile"],
            ["Studio", "Keep the archive moving."],
          ]) {
            await browser.evaluate(`[...document.querySelectorAll('nav[aria-label="Creator Studio sections"] button')].find(b=>b.textContent.trim()===${JSON.stringify(section)}).click()`);
            await browser.wait(`document.querySelector('main').textContent.includes(${JSON.stringify(expected)})`);
            if (section === "My Galleries") {
              await browser.wait(`document.querySelector('main').textContent.includes('Stored files: 0.0 MB')`);
              assert.ok(await browser.evaluate(`!!document.querySelector('ul[aria-label="Storage by file type"]')`));
              assert.equal(await browser.evaluate(`/NaN|undefined/.test(document.querySelector('main').textContent)`), false);
            }
            assert.equal(await browser.evaluate(`document.querySelector('nav[aria-label="Creator Studio sections"] [aria-current="page"]').textContent.trim()`), section);
            await assertLayout();
          }
          for (const target of ["/search", "/current-events", "/account", ...(role === "admin" ? ["/admin/users"] : [])]) {
            await navigate(target, mobile);
            await browser.wait(`!!document.querySelector('h1')`);
            await navigate(studio, mobile);
            await ready();
          }
          // Every Studio query can hold loading open independently. Release without
          // changing routes and ensure the same navigation/menu remains mounted.
          for (const endpoint of ["/api/creator/events", "/api/creator/media", "/api/creator/usage"]) {
            holdPath = endpoint;
            await visit(studio);
            await browser.wait(`!!document.querySelector('main[aria-label="Loading Creator Studio"]')`);
            await assertLayout();
            if (mobile) await openMenu();
            await assertCurrent(mobile);
            holdPath = null;
            const responses = held.splice(0);
            assert.ok(responses.length > 0);
            await Promise.all(responses.map(id => fulfill(id, endpoint.endsWith("/usage") ? usage : [])));
            await ready();
            if (mobile) {
              assert.ok(await browser.evaluate(`!!document.querySelector('#mobile-navigation')`),
                "menu must survive transition from loading to loaded content");
              await click('button[aria-label="Close navigation"]');
              await browser.wait(`!document.querySelector('#mobile-navigation')`);
            }
            await assertLayout();
          }
          for (const endpoint of ["/api/creator/events", "/api/creator/media", "/api/creator/usage"]) {
            failPath = endpoint;
            await visit(studio);
            await browser.wait(`!!document.querySelector('main [role="alert"], main[role="alert"]')`);
            if (endpoint.endsWith("/usage")) {
              await ready();
              assert.ok(await browser.evaluate(`document.querySelector('main [role="alert"]').textContent.includes('Usage details could not be loaded')`));
            } else {
              assert.ok(await browser.evaluate(`document.querySelector('main[role="alert"]').textContent.includes('Creator data could not be loaded')`));
            }
            await assertLayout();
            if (mobile) await openMenu();
            await assertCurrent(mobile);
            if (mobile) await click('button[aria-label="Close navigation"]');
            await navigate("/archive-events", mobile);
            failPath = null;
          }
        }
        assert.deepEqual(writes, [], "tests must not send mutations");
        assert.deepEqual(mockErrors, []);
        assert.deepEqual(browser.errors, []);
      } finally { await browser.close(); }
    });
}
