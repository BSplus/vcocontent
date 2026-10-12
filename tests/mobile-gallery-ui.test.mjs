import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";
import { pageMetadata } from "../shared/pagination.ts";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const baseline = process.env.MOBILE_BASELINE === "1";
const poster = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="#223342"/><path d="M0 500L960 260V460L0 640" fill="#526775"/><text x="60" y="180" fill="#e7ff5e" font-size="50">VCO • Racing fixture</text></svg>');
const recent = new Date(Date.now() - 86400000).toISOString();
const events = Array.from({ length: 12 }, (_, i) => ({
  id: 98000 + i, title: `Race gallery ${i + 1}`, date: i < 8 ? recent : "2020-01-01",
  creatorId: i >= 4 && i < 8 ? 98000 : null, customThumbnail: poster,
  visibility: "published", safetyStatus: "legacy", isPremium: false, description: "Motorsport photographs",
}));
const media = Array.from({ length: 3 }, (_, i) => ({
  id: 98100 + i, eventId: 98000, caption: `Racing frame ${i + 1}`,
  photographer: "Fixture photographer", type: "image", url: poster, thumbnail: poster,
  tags: ["racing"], downloadCount: 12,
}));

test("mobile dock, snap rows, photo gestures and unchanged wide grids", { timeout: 180000 }, async () => {
  const browser = await uiBrowser();
  let role = "guest", count = 4, failed = false, videoMode = false, slow = false;
  const mockErrors = [], metrics = [];
  browser.listeners.add(event => {
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const url = new URL(request.url), path = url.pathname;
    let body = [], status = 200;
    if (path === "/api/user") {
      status = role === "guest" ? 401 : 200;
      body = role === "guest" ? {} : { id: 98000, username: "Fixture creator", profileImage: poster,
        isCreator: role === "creator", isAdmin: role === "admin", creatorStatus: role === "creator" ? "approved" : "none" };
    } else if (path === "/api/events") { body = count === 4 ? events : events.slice(0, count); if (failed) status = 503; }
    else if (path.startsWith("/api/community/")) body = { count: 0, liked: false, saved: false };
    else if (path === "/api/media/top-shots" || path === "/api/media/creator-top") { body = media; if (failed) status = 503; }
    else if (path === "/api/events/creator/98000") { body = events.slice(4, 4 + count); if (failed) status = 503; }
    else if (path === "/api/users/98000") body = { id: 98000, username: "Fixture creator", displayName: "Racing photographer", profileImage: poster, isCreator: true, creatorStatus: "approved" };
    else if (path === "/api/media/top/creator/98000") body = [];
    else if (path === "/api/media" || /\/api\/events\/\d+\/media$/.test(path)) {
      const items = videoMode ? media.map((item, index) => index === 1 ? { ...item, type: "video" } : item) : media;
      body = url.searchParams.get("pagination") === "true" ? { ...pageMetadata(3, 1, 48), items } : items;
    }
    else if (/\/api\/events\/\d+$/.test(path)) body = events[0];
    else if (/\/api\/media\/\d+$/.test(path)) body = media.find(item => item.id === Number(path.split("/").at(-1)));
    void (async () => {
      if (slow && path === "/api/media/top-shots") await delay(1200);
      await browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64") });
    })().catch(error => { if (!/Invalid InterceptionId|closed|session/i.test(String(error))) mockErrors.push(String(error)); });
  });
  const visit = async (path, ready = "!!document.querySelector('h1')") => {
    await browser.command("Page.navigate", { url: new URL(path, base).href }); await browser.wait(ready); await delay(150);
  };
  const key = async (key, code, number) => {
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: number });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: number });
  };
  const escape = async () => { await delay(180); await key("Escape", "Escape", 27); };
  const touch = async (selector, dx = 0, dy = 0) => {
    const point = await browser.evaluate(`(() => {
      const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center'});
      const r=e.getBoundingClientRect(); return {x:Math.min(innerWidth-30,r.left+r.width*.7),y:r.top+r.height*.5};
    })()`);
    await browser.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    for (let step = 1; step <= 8; step++) {
      if (dx || dy) await browser.command("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x + dx * step / 8, y: point.y + dy * step / 8 }] });
      await delay(20);
    }
    await browser.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await delay(200);
  };
  const capture = async name => {
    await browser.evaluate("document.fonts.ready");
    const screenshot = await browser.command("Page.captureScreenshot", { format: "png" });
    await writeFile(`generated-artifacts/mobile-navigation/${baseline ? "before" : "after"}-${name}.png`, Buffer.from(screenshot.data, "base64"));
  };
  const fit = async () => {
    const state = await browser.evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight})`);
    assert.ok(state.scrollWidth <= state.width + 1, JSON.stringify(state));
    return state;
  };
  try {
    await mkdir("generated-artifacts/mobile-navigation", { recursive: true });
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    for (const width of [320, 390, 430, 768, 1600]) {
      const mobile = width < 768;
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile });
      await browser.command("Emulation.setTouchEmulationEnabled", { enabled: mobile });
      await visit("/", "!!document.querySelector('section[aria-labelledby=\"creator-media-heading\"] button')");
      assert.equal((await fit()).width, width);
      await capture(`home-${width}`);
      if (baseline) continue;
      const layout = await browser.evaluate(`(() => {
        const r=document.querySelector('.mobile-gallery-row'), cards=r.children, a=cards[0].getBoundingClientRect(), b=cards[1].getBoundingClientRect();
        return {display:getComputedStyle(r).display,snap:getComputedStyle(r).scrollSnapType,
          peek:b.left<r.getBoundingClientRect().right&&b.right>r.getBoundingClientRect().right,
          sameRow:Math.abs(a.top-b.top)<1,dock:getComputedStyle(document.querySelector('.vco-mobile-bottom-nav')).display,
          header:document.querySelector('header').getBoundingClientRect().height};
      })()`);
      metrics.push({ width, ...layout });
      assert.equal(layout.display, mobile ? "flex" : "grid");
      assert.equal(layout.sameRow, true);
      assert.equal(layout.dock, mobile ? "grid" : "none");
      if (!mobile) {
        assert.equal(layout.header, 73);
        assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('.vco-legacy-mobile-actions')).display"), width < 1536 ? "flex" : "none");
        continue;
      }
      assert.ok(layout.peek); assert.match(layout.snap, /mandatory/); assert.ok(layout.header < 64);
      assert.deepEqual(await browser.evaluate(`[...document.querySelector('.vco-mobile-bottom-nav').children].map(e=>e.innerText)`), ["HOME", "SEARCH", "EVENTS", "MORE"]);
      await touch('section[aria-labelledby="recent-heading"] .mobile-gallery-row a', -170);
      await browser.wait(`document.querySelector('.mobile-gallery-row').scrollLeft > 50`);
      assert.equal(await browser.evaluate("location.pathname"), "/");
      assert.equal(await browser.evaluate("!!document.querySelector('[role=dialog]')"), false);
      assert.equal(await browser.evaluate(`(() => {
        const a=document.querySelector('.mobile-gallery-row a');
        a.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:100,clientY:100}));
        a.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:30,clientY:100}));
        a.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:30,clientY:100}));
        return a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));
      })()`), false, "drag-generated click must be cancelled");
      await browser.evaluate(`document.querySelector('button[aria-label="Next Recent events"]').click()`);
      await browser.wait(`document.querySelector('button[aria-label="Previous Recent events"]').disabled === false`);
      await browser.evaluate(`document.querySelector('.vco-mobile-bottom-nav button').click()`);
      await browser.wait("!!document.querySelector('#vco-mobile-more-dialog')");
      assert.ok(await browser.evaluate(`document.querySelector('[role=dialog]').contains(document.activeElement)`));
      assert.equal(await browser.evaluate(`!!document.querySelector('[role=dialog] a[href="/admin/dashboard"]')`), false);
      for (let tab = 0; tab < 7; tab++) {
        await key("Tab", "Tab", 9);
        assert.ok(await browser.evaluate(`document.querySelector('[role=dialog]').contains(document.activeElement)`));
      }
      await capture(`more-${width}`); await escape();
      await browser.wait("!document.querySelector('[role=dialog]')");
      await browser.wait(`document.activeElement===document.querySelector('.vco-mobile-bottom-nav button')`);
      await browser.evaluate(`document.querySelector('.vco-mobile-bottom-nav a[href="/current-events"]').click()`);
      await browser.wait(`location.pathname==='/current-events'`);
      assert.ok(await browser.evaluate(`!!document.querySelector('.vco-mobile-bottom-nav a[href="/current-events"][aria-current="page"]')`));
      await visit("/search?q=racing", "document.querySelectorAll('article').length===3");
      assert.equal(await browser.evaluate(`document.querySelectorAll('.mobile-gallery-row').length`), 0);
      await browser.evaluate(`document.querySelector('input').focus()`);
      await browser.wait(`document.body.classList.contains('vco-mobile-keyboard-open')`);
      assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('.vco-mobile-bottom-nav')).visibility`), "hidden");
      await browser.evaluate(`document.activeElement.blur()`);
      await browser.wait(`!document.body.classList.contains('vco-mobile-keyboard-open')`);
      await touch("article button");
      await browser.wait(`!!document.querySelector('[role=dialog]')`);
      await capture(`preview-${width}`);
      assert.ok(await browser.evaluate(`(() => {const d=document.querySelector('[role=dialog]').getBoundingClientRect();return d.left>=0&&d.right<=innerWidth&&d.top>=0&&d.bottom<=innerHeight})()`));
      await touch("[role=dialog] img", -110);
      await browser.wait(`document.querySelector('[role=dialog]').textContent.includes('Racing frame 2')`);
      await touch("[role=dialog] img", 0, -70);
      assert.match(await browser.evaluate(`document.querySelector('[role=dialog]').textContent`), /Racing frame 2/);
      await key("ArrowRight", "ArrowRight", 39);
      await browser.wait(`document.querySelector('[role=dialog]').textContent.includes('Racing frame 3')`);
      await escape(); await browser.wait(`!document.querySelector('[role=dialog]')`);
      assert.ok(await browser.evaluate(`document.activeElement===document.querySelector('article button')`));
      await visit("/events/98000", "document.querySelectorAll('article').length===3");
      assert.equal(await browser.evaluate(`document.querySelectorAll('.mobile-gallery-row').length`), 0);
      await fit();
      await visit("/media/98100", "document.body.textContent.includes('Copy credit')");
      await fit(); await capture(`detail-${width}`);
      await visit("/creator/98000", "!!document.querySelector('.mobile-gallery-row')");
      await fit(); await capture(`creator-${width}`);
      await touch(".mobile-gallery-row a", -160);
      await browser.wait(`document.querySelector('.mobile-gallery-row').scrollLeft>50`);
      assert.equal(await browser.evaluate("location.pathname"), "/creator/98000");
      await visit("/", "!!document.querySelector('.vco-mobile-bottom-nav') && !!document.querySelector('.mobile-gallery-row')");
      await browser.evaluate("scrollTo(0,document.documentElement.scrollHeight)");
      assert.ok(await browser.evaluate(`document.querySelector('footer').getBoundingClientRect().bottom<=document.querySelector('.vco-mobile-bottom-nav').getBoundingClientRect().top+1`));
    }
    if (!baseline) {
      await browser.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
      for (role of ["creator", "admin"]) {
        await visit("/", "!!document.querySelector('.vco-mobile-profile img')");
        await browser.evaluate(`document.querySelector('.vco-mobile-bottom-nav button').click()`);
        await browser.wait("!!document.querySelector('[role=dialog]')");
        assert.ok(await browser.evaluate(`!!document.querySelector('[role=dialog] a[href="/creator/dashboard"]')`));
        assert.equal(await browser.evaluate(`!!document.querySelector('[role=dialog] a[href="/admin/dashboard"]')`), role === "admin");
        assert.ok(await browser.evaluate(`!!document.querySelector('[role=dialog] a[href="/account"]')`));
        await escape();
      }
      role = "guest";
      await visit("/", "!!document.querySelector('section[aria-labelledby=\"top-shots-heading\"] .mobile-gallery-row')");
      await touch('section[aria-labelledby="top-shots-heading"] .mobile-gallery-card button');
      await browser.wait(`!!document.querySelector('[role=dialog]')`);
      await touch("[role=dialog] img", -110);
      await browser.wait(`document.querySelector('[role=dialog]').textContent.includes('Racing frame 2')`);
      await escape(); await browser.wait(`!document.querySelector('[role=dialog]')`);
      videoMode = true;
      await visit("/search", "document.querySelectorAll('article').length===3");
      await touch("article button"); await browser.wait(`!!document.querySelector('[role=dialog]')`);
      await touch("[role=dialog] img", -110);
      await browser.wait(`document.querySelector('[role=dialog]').textContent.includes('Racing frame 3')`);
      await key("ArrowLeft", "ArrowLeft", 37);
      await browser.wait(`document.querySelector('[role=dialog]').textContent.includes('Sign in to play this video')`);
      await touch("[role=dialog] img", -110);
      assert.match(await browser.evaluate(`document.querySelector('[role=dialog]').textContent`), /Racing frame 2/);
      await escape();
      count = 1;
      await visit("/", "!!document.querySelector('.mobile-gallery-row')");
      assert.equal(await browser.evaluate(`document.querySelector('button[aria-label="Next Recent events"]')`), null);
      count = 0; await visit("/", "document.body.textContent.includes('No recent event galleries')");
      assert.equal(await browser.evaluate(`document.querySelector('section[aria-labelledby="recent-heading"] .mobile-gallery-row')`), null);
      failed = true;
      await visit("/creator/98000", "document.body.textContent.includes('Published galleries are temporarily unavailable')");
      await fit();
      await visit("/", "document.body.textContent.includes('Top shots are temporarily unavailable') && document.body.textContent.includes('Popular creator media is temporarily unavailable')");
      await fit();
      failed = false; slow = true;
      await visit("/", "!!document.querySelector('[aria-label=\"Loading Top shots\"]')");
      assert.equal(await browser.evaluate(`!!document.querySelector('section[aria-labelledby="top-shots-heading"] button[aria-label^="Next"]')`), false);
      await browser.wait(`!!document.querySelector('section[aria-labelledby="top-shots-heading"] button[aria-label^="Next"]')`);
      assert.deepEqual(mockErrors, []); assert.deepEqual(browser.errors, []);
      await writeFile("generated-artifacts/mobile-navigation/layout-metrics.json", JSON.stringify(metrics, null, 2));
    }
  } finally { await browser.close(); }
});
