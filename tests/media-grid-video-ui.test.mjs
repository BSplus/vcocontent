import test from "node:test";
import assert from "node:assert/strict";
import { pageMetadata } from "../shared/pagination.ts";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const poster = color => "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${color}"/></svg>`);
const items = [
  { id: 64901, type: "image", caption: "Fixture photo", thumbnail: poster("#888888") },
  { id: 64902, type: "video", caption: "Fixture light video", thumbnail: poster("#ffffff") },
  { id: 64903, type: "video", caption: "Fixture dark video", thumbnail: poster("#000000") },
].map(item => ({ ...item, eventId: 64900, url: item.type === "video" ? "/fixture-video.mp4" : item.thumbnail, tags: [], downloadCount: 0 }));

test("shared video markers, preview and admin selection on desktop and touch (isolated fixtures)", { timeout: 120000 }, async () => {
  const browser = await uiBrowser();
  let admin = false;
  let metadataAllowed = false;
  const writes = [];
  const mediaRequests = [];
  const mockErrors = [];
  browser.listeners.add(event => {
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method !== "GET") writes.push(`${request.method} ${path}`);
    if (!path.startsWith("/api/")) mediaRequests.push({ path, metadataAllowed });
    let body = [];
    let status = 200;
    if (path === "/api/user") {
      status = admin ? 200 : 401;
      body = admin ? { id: 64999, username: "Fixture admin", isAdmin: true } : { message: "Not signed in" };
    } else if (path === "/api/events/64900") body = { id: 64900, title: "Fixture mixed gallery", creatorId: 64910 };
    else if (path === "/api/media" || path === "/api/events/64900/media" || path === "/api/media/top/creator/64910") body = items;
    else if (path === "/api/users/64910") body = { id: 64910, username: "Fixture creator", isCreator: true, followerCount: 0 };
    else if (path.startsWith("/api/community/")) body = { count: 0, liked: false, saved: false };
    if (Array.isArray(body) && url.searchParams.get("pagination") === "true") body = { ...pageMetadata(body.length, 1, 48), items: body };
    void browser.command("Fetch.fulfillRequest", {
      requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    }).catch(error => {
      if (!String(error).includes("Invalid InterceptionId")) mockErrors.push(String(error));
    });
  });
  await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }, { urlPattern: "*/fixture-video.mp4" }] });
  const video = 'button[aria-label="Preview video: Fixture light video"]';
  const marker = "[data-video-play-overlay]";
  const key = async (key, code, value) => {
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: value, ...(key === "Enter" && { text: "\r" }) });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: value });
  };
  const close = async () => {
    await delay(100);
    await key("Escape", "Escape", 27);
    await browser.wait(`!document.querySelector('[role="dialog"]') && getComputedStyle(document.body).pointerEvents !== 'none'`);
  };
  const activate = async (selector, touch) => {
    const point = await browser.evaluate(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'});
      const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    if (touch) {
      await browser.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await browser.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    }
  };
  const visit = async path => {
    await browser.command("Page.navigate", { url: new URL(path, base).href });
    await browser.wait(`document.querySelectorAll('article').length === 3 && !!document.querySelector(${JSON.stringify(video)})`);
    if (admin) await browser.wait(`document.querySelectorAll('article [role="checkbox"]').length === 3`);
  };
  const checkMarkers = async width => {
    // Move away before measuring: visibility must not depend on hover.
    await browser.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
    const state = await browser.evaluate(`(() => {
      const buttons=[...document.querySelectorAll('article button[aria-label^="Preview "]')];
      return {width:innerWidth, overflow:document.documentElement.scrollWidth>innerWidth+1,
        inlineVideos:document.querySelectorAll('article video').length,
        cards:buttons.map(b=>{
          const o=b.querySelector('${marker}'), r=b.getBoundingClientRect(), img=b.querySelector('img');
          const s=o && getComputedStyle(o), q=o && o.getBoundingClientRect();
          return {label:b.getAttribute('aria-label'), count:b.querySelectorAll('${marker}').length,
            ratio:r.width/r.height,fit:getComputedStyle(img).objectFit,
            visible:o ? s.display!=='none' && s.visibility==='visible' && s.opacity==='1' : false,
            centered:o ? Math.abs(q.x+q.width/2-r.x-r.width/2)<1 && Math.abs(q.y+q.height/2-r.y-r.height/2)<1 : false,
            size:q?.width, color:s?.color, background:s?.backgroundColor,pointer:s?.pointerEvents,
            hidden:o?.getAttribute('aria-hidden'),focusable:o ? o.matches('a,button,[tabindex]') || !!o.querySelector('a,button,[tabindex]') : false,
            filled:o ? getComputedStyle(o.querySelector('svg')).fill : null};
        })};
    })()`);
    assert.equal(state.width, width);
    assert.equal(state.overflow, false);
    assert.equal(state.inlineVideos, 0);
    assert.equal(state.cards.length, 3);
    for (const card of state.cards) {
      assert.ok(Math.abs(card.ratio - 4 / 3) < 0.01);
      assert.equal(card.fit, "contain");
      if (card.label.startsWith("Preview photo")) { assert.equal(card.count, 0); continue; }
      assert.equal(card.count, 1);
      assert.equal(card.visible, true);
      assert.equal(card.centered, true);
      assert.equal(card.size, 48);
      assert.equal(card.color, "rgb(255, 255, 255)");
      assert.equal(card.filled, "rgb(255, 255, 255)");
      assert.equal(card.background, "rgba(0, 0, 0, 0.65)");
      assert.equal(card.pointer, "none");
      assert.equal(card.hidden, "true");
      assert.equal(card.focusable, false);
    }
  };
  try {
    for (const width of [1280, 390]) {
      const touch = width < 600;
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: touch });
      await browser.command("Emulation.setTouchEmulationEnabled", { enabled: touch });
      for (const path of ["/events/64900", "/search", "/creator/64910"]) {
        await visit(path);
        await checkMarkers(width);
        await activate(video, touch); // Hits the center occupied by the decorative marker.
        await browser.wait(`!!document.querySelector('[role="dialog"]')`);
        assert.match(await browser.evaluate(`document.querySelector('[role="dialog"]').innerText`), /Fixture light video/);
        assert.equal(await browser.evaluate(`!!document.querySelector('[role="dialog"] video')`), false);
        await close();
        assert.equal(await browser.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(video)})`), true);
        await browser.evaluate(`document.querySelector(${JSON.stringify(video)}).focus()`);
        await key("Tab", "Tab", 9);
        await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
        await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
        assert.equal(await browser.evaluate(`document.activeElement.matches(':focus-visible') && document.activeElement === document.querySelector(${JSON.stringify(video)})`), true);
        await key("Enter", "Enter", 13);
        await browser.wait(`!!document.querySelector('[role="dialog"]')`);
        await close();
        await key(" ", "Space", 32);
        await browser.wait(`!!document.querySelector('[role="dialog"]')`);
        await close();
      }
      admin = true;
      await visit("/events/64900");
      await checkMarkers(width);
      await activate('article [role="checkbox"]', touch);
      await browser.wait(`document.querySelectorAll('${marker}').length === 0`);
      const select = 'button[aria-label="Select: Fixture light video"]';
      const deselect = 'button[aria-label="Deselect: Fixture light video"]';
      await activate(select, touch);
      await browser.wait(`document.querySelector(${JSON.stringify(deselect)})?.getAttribute('aria-pressed') === 'true'`);
      assert.equal(await browser.evaluate(`document.querySelectorAll('article [role="checkbox"][data-state="checked"]').length`), 2);
      assert.equal(await browser.evaluate(`!!document.querySelector('[role="dialog"]')`), false);
      await browser.evaluate(`document.querySelector(${JSON.stringify(deselect)}).focus()`);
      await key("Enter", "Enter", 13);
      await browser.wait(`document.querySelector(${JSON.stringify(select)})?.getAttribute('aria-pressed') === 'false'`);
      assert.equal(await browser.evaluate(`document.querySelectorAll('article [role="checkbox"][data-state="checked"]').length`), 1);
      // Explicit preview still opens the video, without changing selection.
      metadataAllowed = true; // Existing preload="metadata", not autoplay or inline playback.
      await browser.evaluate(`document.querySelector('article:nth-child(2) .p-4 button').focus()`);
      await key("Enter", "Enter", 13);
      await browser.wait(`!!document.querySelector('[role="dialog"] video[controls]')`);
      assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"] video').autoplay`), false);
      assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"] video').paused`), true);
      await close();
      metadataAllowed = false;
      assert.equal(await browser.evaluate(`document.querySelectorAll('article [role="checkbox"][data-state="checked"]').length`), 1);
      assert.equal(await browser.evaluate(`document.querySelectorAll('${marker}').length`), 0);
      await activate('article [role="checkbox"]', touch);
      await browser.wait(`document.querySelectorAll('${marker}').length === 2`);
      await checkMarkers(width);
      admin = false;
    }
    assert.deepEqual(writes, []);
    assert.ok(mediaRequests.every(request => request.path === "/fixture-video.mp4" && request.metadataAllowed),
      "Video metadata may load only in the explicitly opened, signed-in dialog; no downloads");
    assert.deepEqual(mockErrors, []);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
