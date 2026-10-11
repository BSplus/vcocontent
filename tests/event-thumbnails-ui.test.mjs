import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const photo = (await sharp({ create: { width: 120, height: 80, channels: 3,
  background: "#fe315b" } }).webp().toBuffer()).toString("base64");
const fallback = "/attached_assets/%2389_3.png";

for (const width of [1600, 390]) test(`event thumbnails, error recovery and refreshed selection work at ${width}px`,
  { timeout: 90000 }, async () => {
    const browser = await uiBrowser();
    const requests = [];
    const mockErrors = [];
    let version = 1, failFallback = false;
    const fixture = (id, title, customThumbnail, coverImage = null) => ({
      id, title, customThumbnail, coverImage, date: new Date(Date.now() - 86400000).toISOString(),
      description: "Synthetic event fixture", creatorId: null, isPremium: false,
    });
    const events = () => [
      fixture(95001, "Chosen photo empty gallery", `/api/events/95001/thumbnail?v=${version}`),
      fixture(95002, "Broken selection gallery recovery", "/api/events/95002/thumbnail"),
      fixture(95003, "Broken photo generic recovery", "/api/events/95003/thumbnail"),
      fixture(95004, "Chosen cover only", null, "/api/events/95004/thumbnail?field=coverImage"),
    ];
    browser.listeners.add(event => {
      if (event.method !== "Fetch.requestPaused") return;
      const { requestId, request } = event.params;
      const path = new URL(request.url).pathname;
      requests.push(path);
      let status = 200, contentType = "application/json", content = [];
      if (path === "/api/user") status = 401;
      if (path === "/api/events") content = events();
      if (path === "/api/events/95002/media") content = [{ id: 42, type: "image",
        thumbnail: "/api/media/fixture-gallery.webp", isPremium: false }];
      if (path.endsWith("/thumbnail") || path === "/api/media/fixture-gallery.webp" || path === fallback) {
        contentType = "image/webp"; content = photo;
        if (["/api/events/95002/thumbnail", "/api/events/95003/thumbnail"].includes(path) ||
          (path === fallback && failFallback)) status = 404;
      }
      void browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: contentType }],
        body: status === 404 ? "" : contentType === "image/webp" ? content :
          Buffer.from(JSON.stringify(content)).toString("base64") }).catch(e => mockErrors.push(String(e)));
    });
    const image = id => `document.querySelector('a[aria-label="Open ${events().find(e => e.id === id).title} gallery"] img')`;
    try {
      await browser.command("Network.enable");
      await browser.command("Fetch.enable", { patterns: [
        { urlPattern: `${base}/api/*` }, { urlPattern: `${base}/attached_assets/%2389_3.png` },
      ] });
      await browser.command("Emulation.setDeviceMetricsOverride", {
        width, height: 1080, deviceScaleFactor: 1, mobile: width < 500 });
      await browser.command("Page.navigate", { url: `${base}/` });
      await browser.wait(`document.body.textContent.includes("Chosen photo empty gallery")`);
      for (const [id, expected] of [[95001, "?v=1"], [95002, "/api/media/fixture-gallery.webp"],
        [95003, fallback], [95004, "field=coverImage"]]) {
        await browser.evaluate(`${image(id)}.scrollIntoView({block:'center'})`);
        await browser.wait(`!!${image(id)} && ${image(id)}.src.includes(${JSON.stringify(expected)}) && ${image(id)}.naturalWidth > 0`);
      }
      assert.ok(!requests.includes("/api/events/95001/media"), "no gallery request for a selected cover");
      assert.ok(!requests.includes("/api/events/95004/media"), "coverImage has the same lazy behavior");
      version = 2;
      // The same invalidation used by successful event edits; card remains mounted.
      await browser.evaluate(`(async () => {
        const { queryClient } = await import('/src/lib/queryClient.ts');
        await queryClient.invalidateQueries({queryKey:['/api/events']});
      })()`);
      await browser.evaluate(`${image(95001)}.scrollIntoView({block:'center'})`);
      await browser.wait(`!!${image(95001)} && ${image(95001)}.src.includes('?v=2') && ${image(95001)}.naturalWidth > 0`);
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
      // If even the standard image fails, remove the broken img and stop retrying.
      failFallback = true;
      await browser.command("Page.reload", { ignoreCache: true });
      await browser.wait(`document.body.textContent.includes("Broken photo generic recovery")`);
      await browser.evaluate(`document.querySelector('a[aria-label="Open Broken photo generic recovery gallery"]').scrollIntoView()`);
      await browser.wait(`!${image(95003)}`);
      const count = requests.filter(path => path === fallback).length;
      await delay(300);
      assert.equal(requests.filter(path => path === fallback).length, count);
      assert.deepEqual(mockErrors, []);
    } finally { await browser.close(); }
  });
