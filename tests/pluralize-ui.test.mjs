import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const image = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='60'/%3E";
const event = {
  id: 95601, title: "Count fixture", date: new Date(Date.now() - 86400000).toISOString(),
  creatorId: null, seriesId: null, visibility: "published", safetyStatus: "approved", coverImage: image,
};
const user = { id: 95600, username: "CountFixture", isAdmin: true, isCreator: true,
  creatorStatus: "approved", emailVerifiedAt: "2026-01-01T00:00:00Z" };

test("home downloads, Creator cards, profiles, account followers and selection use English count forms",
  { timeout: 180000 }, async () => {
    const browser = await uiBrowser(), mockErrors = [];
    let count = 0, unknown = false;
    const media = () => [0, 1, 2].map((n) => ({
      id: 95610 + n, eventId: event.id, type: "image", thumbnail: image, url: image,
      caption: `Count frame ${n}`, tags: [], downloadCount: n, safetyStatus: "approved",
    }));
    const creator = () => ({ ...user, followerCount: unknown ? undefined : count, following: false });
    const envelope = items => ({ items, page: 1, totalPages: 1, hasMore: false });
    browser.listeners.add(message => {
      if (message.method !== "Fetch.requestPaused") return;
      const { requestId, request } = message.params;
      const path = new URL(request.url).pathname;
      let body = [], status = 200;
      if (request.method === "POST" && path.endsWith("/nextcloud/preview")) body = {
        count: count * 2, images: count, videos: count, skipped: count,
      };
      else if (request.method !== "GET") { status = 405; body = { error: "No writes allowed in fixture" }; }
      else if (path === "/api/user") body = user;
      else if (path === `/api/users/${user.id}`) body = creator();
      else if (path === "/api/events" || path === "/api/admin/events" || path === "/api/creator/events" || path === `/api/events/creator/${user.id}`) body = [event];
      else if (path === `/api/events/${event.id}`) body = event;
      else if (path === "/api/media") body = media();
      else if (path === "/api/admin/safety") body = { media: [], events: [] };
      else if (path === "/api/admin/native-upload-diagnostics") {
        status = 503; body = { error: "Diagnostics intentionally unavailable in this text fixture" };
      }
      else if (path === "/api/admin/media-usage") body = {
        total: { bytes: "0", count: String(count), legacy: "0", legacyTextBytes: "0" },
        cleanupCount: String(count), byCreator: [], byEvent: [],
        policy: { eventBytes: 500000000, creatorBytes: 500000000, eventCount: 1000, creatorCount: 1000 },
        warningFraction: 0.8,
      };
      else if (path === `/api/admin/events/${event.id}/nextcloud/sources`) body = { sources: [{ link: "https://example.invalid/s/fixture" }] };
      else if (path === `/api/admin/events/${event.id}/nextcloud`) body = {
        status: "completed", total: count, imported: count, importedImages: count,
        importedVideos: count, warnings: count, analysisPending: count, analysisCompleted: count, files: [],
      };
      else if (path === `/api/events/${event.id}/references`) body = { entries: [], documents: [] };
      else if (path === "/api/media/top-shots" || path === "/api/media/creator-top" || path === `/api/media/top/creator/${user.id}` || path === "/api/creator/media") body = media();
      else if (path === "/api/account/following") body = envelope([creator()]);
      else if (path.startsWith("/api/community/")) body = { count: 0, liked: false, saved: false };
      else if (path === "/api/creator/usage") body = {
        bytes: 0, galleries: 1, photos: count, unknown: 0, pendingCleanup: 0,
        retainedBytes: 0, reservedBytes: 0, availableBytes: null, capacityWarning: false,
        byType: [], byGallery: [], limits: { bytes: 500000000, galleries: 5, photos: 1000, imageBytes: 5000000 },
        eventStats: [{ eventId: event.id, photos: count, videos: count, downloads: unknown ? undefined : count }],
      };
      void browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64"),
      }).catch(error => mockErrors.push(String(error)));
    });
    const visit = async (path, ready) => {
      await browser.command("Page.navigate", { url: new URL(path, base).href });
      await browser.wait(`location.pathname === ${JSON.stringify(new URL(path, base).pathname)} && document.readyState === 'complete' && (${ready})`);
    };
    const text = selector => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).innerText`);
    const click = label => browser.evaluate(`(()=> {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)});
      if (!button) throw Error("Button not found"); button.click();
    })()`);
    try {
      await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
      await visit("/", `document.querySelectorAll('section[aria-labelledby="top-shots-heading"] button').length >= 3 &&
        document.querySelector('section[aria-labelledby="creator-media-heading"]')?.innerText.includes('2 downloads')`);
      for (const selector of ['section[aria-labelledby="top-shots-heading"]', 'section[aria-labelledby="creator-media-heading"]']) {
        const value = await text(selector);
        for (const expected of ["0 downloads", "1 download", "2 downloads"]) assert.ok(value.includes(expected), value);
        assert.ok(!value.includes("1 downloads"));
      }
      for (count of [0, 1, 2]) {
        const suffix = count === 1 ? "" : "s";
        await visit("/creator/dashboard", `document.querySelector('h1')?.textContent.includes('Creator Studio')`);
        assert.ok((await text("main")).includes(`${count} photo${suffix} · ${count} download${suffix}`));
        await click("My Galleries");
        // Creator Studio mounts CreatorGalleryCards ("My Galleries", article).
        // The Admin view below instead mounts DashboardEventList ("VCO Events", li).
        await browser.wait(`!!document.querySelector('section[aria-label="My Galleries"] article')`);
        assert.ok((await text('section[aria-label="My Galleries"]')).includes(`${count} photo${suffix} · ${count} download${suffix}`));
        await visit("/admin/dashboard", `!!document.querySelector('section[aria-label="VCO Events"] li')`);
        await click("Edit Event");
        await browser.wait(`document.querySelector('[role="dialog"]')?.innerText.includes('Historical totals:')`);
        let dialog = await text('[role="dialog"]');
        const historical = `Historical totals: ${count}/${count} file${suffix} (${count} image${suffix}, ${count} video${suffix}) · ${count} analysis warning${suffix}`;
        assert.ok(dialog.includes(historical), dialog);
        assert.ok(dialog.includes("1 saved source") && !dialog.includes("1 saved sources"), dialog);
        assert.ok(dialog.includes(`${count} media item${suffix} waiting or being processed`), dialog);
        await click("Check access and media");
        await browser.wait(`document.querySelector('[role="dialog"]')?.innerText.includes('${count} file${suffix} skipped.')`);
        dialog = await text('[role="dialog"]');
        assert.ok(dialog.includes(`${count} image${suffix} and ${count} video${suffix} found; ${count} file${suffix} skipped.`), dialog);
        await browser.evaluate(`document.querySelector('[role="dialog"] button:has(.sr-only)').click()`);
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
        await browser.evaluate(`(()=> {
          const tab = [...document.querySelectorAll('[role="tab"]')].find(t => t.textContent === 'Media Management');
          tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
        })()`);
        await browser.wait(`document.querySelector('[role="tabpanel"][data-state="active"]')?.textContent.includes('Storage usage')`);
        const management = await text('[role="tabpanel"][data-state="active"]');
        assert.ok(management.includes(`${count} measured item${suffix}`), management);
        assert.ok(management.includes(`${count} ${count === 1 ? "object awaits" : "objects await"} cleanup.`), management);
        for (const path of [`/creator/${user.id}`, "/account?tab=following"]) {
          await visit(path, `document.querySelector('main')?.innerText.includes('${count} follower${suffix}')`);
          const value = await text("main");
          assert.ok(value.includes(`${count} follower${suffix}`));
          if (count === 1) assert.ok(!value.includes("1 followers"));
        }
      }
      unknown = true;
      await visit("/creator/dashboard", `document.querySelector('main')?.innerText.includes('— downloads')`);
      assert.ok(!(await text("main")).includes("0 downloads"));
      await visit(`/creator/${user.id}`, `document.querySelector('main')?.innerText.includes('— followers')`);
      assert.ok(!(await text("main")).includes("0 followers"));
      // Select two real rendered MediaGrid items, then return to one.
      const select = index => browser.evaluate(`document.querySelectorAll('[role="checkbox"]')[${index}].click()`);
      await select(0);
      await browser.wait(`document.body.innerText.includes('1 item selected')`);
      assert.ok(!(await text("main")).includes("1 items selected"));
      await select(1);
      await browser.wait(`document.body.innerText.includes('2 items selected')`);
      await select(1);
      await browser.wait(`document.body.innerText.includes('1 item selected')`);
      await select(0);
      await browser.wait(`!document.body.innerText.includes('item selected')`);
      assert.deepEqual(mockErrors, []);
      assert.deepEqual(browser.errors, []);
    } finally { await browser.close(); }
  });
