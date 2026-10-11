import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
const image = (await sharp({ create: { width: 120, height: 80, channels: 3,
  background: "#fe315b" } }).webp().toBuffer()).toString("base64");

async function click(browser, expression) {
  await browser.wait(`!!(${expression})`);
  const point = await browser.evaluate(`(()=>{const el=${expression};el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}

async function pressEnter(browser, expression) {
  await browser.evaluate(`${expression}.focus()`);
  await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
  await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

for (const [width, role] of [[1440, "admin"], [390, "admin"], [390, "owner"], [1440, "official"]]) test(`${role} gallery thumbnail selection, paging, save recovery and restrictions at ${width}px`,
  { timeout: 90000 }, async () => {
    const browser = await uiBrowser();
    const requests = [];
    const writes = [];
    let rejectSave = true;
    let deleted = false;
    const event = {
      id: 95101, title: "Thumbnail selector fixture", description: "Fixture gallery",
      creatorId: role === "official" ? null : 8301, date: new Date().toISOString(), customThumbnail: null,
      coverImage: "/legacy/managed-value.webp", visibility: "draft",
    };
    const emptyEvent = { ...event, id: 95102, title: "Empty gallery fixture", customThumbnail: null, coverImage: null };
    const retryEvent = { ...event, id: 95103, title: "Retry gallery fixture", customThumbnail: null, coverImage: null };
    let failedOptions = false;
    browser.listeners.add(message => {
      if (message.method !== "Fetch.requestPaused") return;
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      const path = url.pathname;
      requests.push({ path, search: url.search, method: request.method });
      let status = 200, type = "application/json", content = [];
      if (path === "/api/user") content = { id: 8301, username: "gallery-owner", isAdmin: role !== "owner",
        isCreator: true, creatorStatus: "approved", emailVerifiedAt: new Date().toISOString() };
      if (path === "/api/admin/events" || path === "/api/events") content = [event, emptyEvent, retryEvent];
      if (path === "/api/creator/events") content = [event, emptyEvent, retryEvent];
      if (path === "/api/creator/usage") content = { bytes: 0, galleries: 3, photos: 2, unknown: 0, pendingCleanup: 0,
        limits: { bytes: 500000000, galleries: 5, photos: 1000, imageBytes: 5000000 }, eventStats: [] };
      if (path === "/api/events/95101") content = event;
      if (path === "/api/events/95102") content = emptyEvent;
      if (path === "/api/events/95103") content = retryEvent;
      if (path === "/api/media") content = [];
      if (path === "/api/admin/safety") content = { media: [], events: [] };
      if (path === "/api/admin/media-usage") content = { total: { bytes: "0", count: "0", legacy: "0", legacyTextBytes: "0" },
        byEvent: [], byCreator: [], cleanupCount: "0", policy: { eventBytes: 1000000, creatorBytes: 1000000,
          eventCount: 100, creatorCount: 100 }, warningFraction: 0.8 };
      if (path === "/api/events/95101/thumbnail-options") {
        const page = Number(url.searchParams.get("page") || 1);
        content = page === 1
          ? { photos: [{ id: 1, reference: "/api/media/files/thumb-one.webp", preview: "/api/media/files/thumb-one.webp", caption: "Paddock" },
            ...Array.from({ length: 23 }, (_, index) => ({ id: index + 100, reference: `/api/media/legacy/${index + 100}/thumbnail`,
              preview: `/api/media/legacy/${index + 100}/thumbnail`, caption: `Photo ${index + 100}` }))], hasMore: true, page: 1 }
          : { photos: [{ id: 2, reference: "/api/media/legacy/22/thumbnail", preview: "/api/media/legacy/22/thumbnail", caption: "Start line" }], hasMore: false, page: 2 };
      }
      if (path === "/api/events/95102/thumbnail-options") content = { photos: [], hasMore: false, page: 1 };
      if (path === "/api/events/95103/thumbnail-options") {
        if (!failedOptions) { status = 503; content = { error: "Temporarily unavailable" }; failedOptions = true; }
        else content = { photos: [], hasMore: false, page: 1 };
      }
      if (path.startsWith("/api/media/") || path === "/attached_assets/%2389_3.png") {
        type = "image/webp";
        content = image;
      }
      if (/\/api\/events\/\d+\/thumbnail$/.test(path)) {
        type = "image/webp"; content = image;
        if (deleted || !event.customThumbnail || url.searchParams.get("field") === "coverImage") status = 404;
      }
      if (request.method === "PUT" && path === "/api/events/95101") {
        const body = JSON.parse(request.postData);
        writes.push(body);
        if (rejectSave) { status = 400; content = { error: "Thumbnail update was rejected." }; }
        else { Object.assign(event, body); content = { ...event, saveStatus: "saved" }; }
      }
      void browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: type }],
        body: type === "image/webp" ? content : Buffer.from(JSON.stringify(content)).toString("base64") }).catch(() => {});
    });
    try {
      await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
      await browser.command("Emulation.setDeviceMetricsOverride", {
        width, height: 1000, deviceScaleFactor: 1, mobile: width < 500,
      });
      await browser.command("Page.navigate", { url: new URL(role === "owner" ? "/creator/dashboard" : "/admin/dashboard", base).href });
      if (role === "owner") {
        await browser.wait(`!!(${button("Manage galleries")})`);
        await browser.evaluate(`(${button("Manage galleries")}).click()`);
      }
      await browser.wait(`document.body.textContent.includes("Thumbnail selector fixture") && !!(${button("Edit Event")})`);
      const editFixture = `(()=>{const row=[...document.querySelectorAll('li,article')].find(node=>node.textContent.includes('Thumbnail selector fixture'));
        return row&&[...row.querySelectorAll('button')].find(node=>node.textContent.trim()==='Edit Event')})()`;
      await click(browser, editFixture);
      await browser.wait(`!!document.querySelector('[aria-label="Choose a gallery photo"]')`);
      assert.equal(await browser.evaluate(`!!document.querySelector('input[aria-label="Choose event thumbnail"]')`), role === "official",
        "only official admin events show the separate upload field");
      await browser.wait(`document.querySelectorAll('[aria-label="Choose a gallery photo"] button[aria-pressed]').length===24`);
      await click(browser, button("More photos"));
      await browser.wait(`!!document.querySelector('button[aria-label="Select photo: Start line"]')`);
      await click(browser, `document.querySelector('button[aria-label="Select photo: Start line"]')`);
      assert.equal(await browser.evaluate(`document.querySelector('button[aria-label="Select photo: Start line"]').getAttribute('aria-pressed')`), "true");
      await click(browser, button("Previous photos"));
      const paddockButton = `document.querySelector('button[aria-label="Select photo: Paddock"]')`;
      await browser.wait(`!!${paddockButton}`);
      await pressEnter(browser, paddockButton);
      await browser.wait(`${paddockButton}?.getAttribute('aria-pressed')==='true'`);
      assert.equal(await browser.evaluate(`${paddockButton}.getAttribute('aria-pressed')`), "true", "native selector supports Enter");
      await click(browser, button("More photos"));
      await browser.wait(`!!document.querySelector('button[aria-label="Select photo: Start line"]')`);
      await pressEnter(browser, `document.querySelector('button[aria-label="Select photo: Start line"]')`);
      await browser.wait(`document.querySelector('button[aria-label="Select photo: Start line"]')?.getAttribute('aria-pressed')==='true'`);
      assert.equal(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
      await click(browser, button("Update Event"));
      await browser.wait(`document.body.textContent.includes("Thumbnail update was rejected.")`);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].customThumbnail, "/api/media/legacy/22/thumbnail");
      assert.equal("coverImage" in writes[0], false, "unchanged historical cover is omitted");
      assert.equal("title" in writes[0], false, "thumbnail-only updates do not restart text safety checks");
      assert.equal(await browser.evaluate(`document.querySelector('button[aria-label="Select photo: Start line"]').getAttribute('aria-pressed')`), "true");
      rejectSave = false;
      await click(browser, button("Update Event"));
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.equal(writes.length, 2);
      assert.equal(writes[1].customThumbnail, "/api/media/legacy/22/thumbnail");
      await browser.wait(`!!document.querySelector('img[src*="/api/events/95101/thumbnail?field=customThumbnail"]')?.naturalWidth`);
      await click(browser, editFixture);
      await browser.wait(`!!document.querySelector('[aria-label="Choose a gallery photo"]')`);
      await click(browser, button("More photos"));
      await browser.wait(`document.querySelector('button[aria-label="Select photo: Start line"]')?.getAttribute('aria-pressed')==='true'`);
      await click(browser, button("Cancel"));
      await browser.wait(`!document.querySelector('[role="dialog"]') && getComputedStyle(document.body).pointerEvents!=='none'`);
      deleted = true;
      await browser.evaluate(`document.querySelectorAll('img[src*="/api/events/95101/thumbnail"]').forEach(img=>img.dispatchEvent(new Event('error')))`);
      await browser.wait(`!!document.querySelector('img[src="/attached_assets/%2389_3.png"]')`);
      assert.equal(await browser.evaluate(`!!document.querySelector('img[src="/api/media/legacy/22/thumbnail"]')`), false,
        "management cards never deliver a raw selected media reference after deletion");
      assert.ok(requests.some(request => request.path === "/api/events/95101/thumbnail-options" && request.search === "?page=1"));
      assert.ok(requests.some(request => request.path === "/api/events/95101/thumbnail-options" && request.search === "?page=2"));
      const editWithin = title => `(()=>{const row=[...document.querySelectorAll('li,article')].find(node=>node.textContent.includes(${JSON.stringify(title)}));
        return row&&[...row.querySelectorAll('button')].find(node=>node.textContent.trim()==='Edit Event')})()`;
      await browser.evaluate(`(${editWithin("Empty gallery fixture")}).click()`);
      await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes("No eligible photos are available yet.")`);
      await click(browser, button("Cancel"));
      await browser.wait(`!document.querySelector('[role="dialog"]') && getComputedStyle(document.body).pointerEvents!=='none'`);
      await browser.evaluate(`(${editWithin("Retry gallery fixture")}).click()`);
      await browser.wait(`document.querySelector('[aria-label="Choose a gallery photo"] [role="alert"]')?.textContent.includes("Photos could not be loaded.")`);
      await click(browser, `document.querySelector('[aria-label="Choose a gallery photo"] [role="alert"] button')`);
      await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes("No eligible photos are available yet.")`);
      assert.deepEqual(browser.errors, []);
    } finally {
      await browser.close();
    }
  });
