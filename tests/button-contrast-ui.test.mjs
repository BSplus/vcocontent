import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { pageMetadata } from "../shared/pagination.ts";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const preview = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
// A bright cover exposes translucent controls that only work over dark photos.
const whiteImage = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="white"/></svg>');
const creator = { id: 67001, username: "contrast-creator", displayName: "Contrast creator",
  isCreator: true, followerCount: 0, coverImage: whiteImage, bio: "Browser fixture" };
const events = [
  { id: 67011, title: "Contrast official race", creatorId: null },
  { id: 67012, title: "Contrast creator race", creatorId: creator.id },
].map(event => ({ ...event, date: new Date(Date.now() - 86400000).toISOString(),
  galleryThumbnail: whiteImage, visibility: "published", safetyStatus: "legacy" }));
const media = [0, 1, 2].map(i => ({ id: 67021 + i, eventId: 67011, type: "image",
  caption: `Contrast photo ${i}`, thumbnail: whiteImage, url: whiteImage, tags: [], downloadCount: 0 }));

function rgb(css) {
  const values = css.match(/[\d.]+/g)?.map(Number);
  assert.ok(values?.length >= 3, `Unsupported computed color: ${css}`);
  return [...values.slice(0, 3), values[3] ?? 1];
}
function composite(foreground, background) {
  return foreground.slice(0, 3).map((channel, i) => channel * foreground[3] + background[i] * (1 - foreground[3]));
}
function luminance(color) {
  return color.map(value => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(foreground, background) {
  const a = luminance(composite(foreground, background)), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function checkPage(base) {
  const browser = await uiBrowser();
  let role = "anonymous";
  const writes = [], mockErrors = [], failures = [];
  browser.listeners.add(event => {
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const url = new URL(request.url), p = url.pathname;
    if (request.method !== "GET") writes.push(`${request.method} ${p}`);
    let body = [], status = 200;
    if (p === "/api/user") {
      status = role === "anonymous" ? 401 : 200;
      body = role === "anonymous" ? {} : { id: creator.id, username: "Contrast user",
        isAdmin: role === "admin", isCreator: false, creatorStatus: null };
    } else if (p === "/api/events") body = events;
    else if (p === `/api/users/${creator.id}`) body = creator;
    else if (p === `/api/events/creator/${creator.id}`) body = [events[1]];
    else if (p === `/api/media/top/creator/${creator.id}`) body = [];
    else if (p === "/api/media/top-shots" || p === "/api/media") body = media;
    else if (p === "/api/media/creator-top") body = [media[0]];
    else if (p.startsWith("/api/community/")) body = { count: 0, liked: false, saved: false };
    if (Array.isArray(body) && url.searchParams.get("pagination") === "true") {
      body = { ...pageMetadata(body.length, 1, 48), items: body };
    }
    void browser.command("Fetch.fulfillRequest", {
      requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    }).catch(error => {
      if (!String(error).includes("Invalid InterceptionId")) mockErrors.push(String(error));
    });
  });
  const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, modifiers,
      ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers });
  };
  const visit = async (route, ready) => {
    // A header shared with the previous page can satisfy readiness before a
    // full navigation commits. Clear it first, particularly on the fast build.
    await browser.command("Page.navigate", { url: "about:blank" });
    await browser.wait(`location.href === 'about:blank' && document.readyState === 'complete'`);
    await browser.command("Page.navigate", { url: new URL(route, base).href });
    await browser.wait(ready);
    await browser.evaluate("document.fonts.ready");
  };
  const point = selector => browser.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error('Missing control: ' + ${JSON.stringify(selector)});
    el.scrollIntoView({block:'center'});
    const r = el.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  })()`);
  const click = async selector => {
    const p = await point(selector);
    await browser.wait(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.visibility === 'visible' && s.pointerEvents !== 'none' &&
        el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
    })()`);
    await browser.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
    await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
    await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
  };
  const measure = async (selector, state, label) => {
    // Wait past the longest color transition, not just until :hover matches.
    await delay(350);
    const computed = await browser.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)}), s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {color:s.color,background:s.backgroundColor,
        icons:[...el.querySelectorAll('svg')].map(svg=>({color:getComputedStyle(svg).color,stroke:getComputedStyle(svg).stroke})),
        hover:el.matches(':hover'),focus:el.matches(':focus-visible'),shadow:s.boxShadow,outline:s.outlineStyle,
        x:r.x,y:r.y,width:r.width,height:r.height, viewport:innerWidth,
        unobstructed:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
    })()`);
    assert.ok(computed.width > 0 && computed.height > 0 && computed.unobstructed, `${label} must be visible and reachable`);
    assert.ok(computed.x >= 0 && computed.x + computed.width <= computed.viewport, `${label} must not be clipped`);
    if (state === "hover") assert.equal(computed.hover, true, `${label}: real pointer hover`);
    if (state === "focus") {
      assert.equal(computed.focus, true, `${label}: keyboard focus`);
      assert.ok(computed.shadow !== "none" || computed.outline !== "none", `${label}: visible focus indicator`);
    }
    // Sample empty interior corners, not text, borders or the focus ring. These
    // pixels include real ancestor backgrounds, gradients, images and overlays.
    const { data } = await browser.command("Page.captureScreenshot", { format: "png" });
    if (process.env.BUTTON_CONTRAST_SCREENSHOTS && state === "hover") {
      await mkdir("generated-artifacts/button-contrast", { recursive: true });
      await writeFile(`generated-artifacts/button-contrast/${base === preview ? "preview" : "built"}-${label.replace(/[^a-z0-9]+/gi, "-")}.png`, Buffer.from(data, "base64"));
    }
    const image = await loadImage(Buffer.from(data, "base64"));
    const canvas = createCanvas(image.width, image.height), ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const samples = [[4, 4], [computed.width - 5, 4], [4, computed.height - 5], [computed.width - 5, computed.height - 5]]
      .map(([dx, dy]) => [...ctx.getImageData(Math.floor(computed.x + dx), Math.floor(computed.y + dy), 1, 1).data].slice(0, 3));
    const colors = [computed.color, ...computed.icons.map(icon => icon.stroke === "none" ? icon.color : icon.stroke)];
    const minimum = Math.min(...colors.flatMap(color => samples.map(bg => contrast(rgb(color), bg))));
    console.log(`${label} ${state}: ${minimum.toFixed(2)}:1, text ${computed.color}, CSS background ${computed.background}, painted ${JSON.stringify(samples[0])}`);
    if (minimum < 4.5) failures.push(`${label} ${state}: ${minimum.toFixed(2)}:1`);
  };
  const states = async (selector, label) => {
    await point(selector);
    await browser.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
    await browser.evaluate("document.activeElement?.blur()");
    await measure(selector, "normal", label);
    await browser.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...await point(selector) });
    await measure(selector, "hover", label);
    await browser.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
    await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await key("Tab", "Tab", 9);
    await key("Tab", "Tab", 9, 8);
    await measure(selector, "focus", label);
  };
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    for (const width of [1920, 390]) {
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      role = "anonymous";
      await visit("/", `!!document.querySelector('section[aria-labelledby="creator-heading"] a')`);
      const hero = 'main > section a[href="/current-events"]';
      await states(hero, `${width} hero outline`);
      await states('section[aria-labelledby="recent-heading"] > div a', `${width} primary-text ghost`);
      await states('section[aria-labelledby="creator-heading"] > div a', `${width} accent-text ghost`);
      await states('main > section a[href="/search"]', `${width} primary filled (unchanged)`);
      await states('section[aria-labelledby="upcoming-heading"] a', `${width} standard accent-hover outline (unchanged)`);
      await states('section[aria-labelledby="top-shots-heading"] > div a', `${width} standard accent-hover ghost (unchanged)`);
      await states('a[href="/events/67011"].vco-button', `${width} gallery link (unchanged)`);
      if (width >= 1536) await states('nav[aria-label="Main navigation"] a[href="/current-events"]', `${width} nav link (unchanged)`);
      await states(hero, `${width} hero keyboard activation`);
      await key("Enter", "Enter", 13);
      await browser.wait(`location.pathname === '/current-events' && !!document.querySelector('h1')`);
      assert.equal(await browser.evaluate("innerWidth"), width);
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth > innerWidth + 1"), false);
      role = "user";
      await visit("/", `!!document.querySelector('a[href="/creator/apply"]')`);
      if (width >= 1536) await states('header a[href="/creator/apply"]', `${width} creator navigation outline`);
      else {
        await click('button[aria-controls="vco-mobile-more-dialog"]');
        await browser.wait(`!!document.querySelector('[role="dialog"] a[href="/creator/apply"]')`);
        await states('[role="dialog"] a[href="/creator/apply"]', `${width} mobile creator link (unchanged)`);
        await states('button[aria-label="Close More menu"]', `${width} mobile close icon (unchanged)`);
        await key("Escape", "Escape", 27);
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
        // Verify the narrow-view navigation is still operable by a touch tap.
        await browser.command("Emulation.setTouchEmulationEnabled", { enabled: true });
        const p = await point('nav[aria-label="Mobile quick navigation"] a[href="/current-events"]');
        await browser.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
        await browser.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await browser.wait(`location.pathname === '/current-events'`);
        await browser.command("Emulation.setTouchEmulationEnabled", { enabled: false });
      }
      role = "admin";
      await visit("/", `!!document.querySelector('a[href="/events/67011?tab=media"]')`);
      await states('a[href="/events/67011?tab=media"]', `${width} manage-media outline`);
      role = "anonymous";
      await visit(`/creator/${creator.id}`, `!!document.querySelector('main h1')`);
      await browser.wait(`document.querySelector('main img')?.complete === true`);
      await states('main a[href="/"]', `${width} archive over bright cover`);
      await visit("/search", `document.querySelectorAll('article').length === 3`);
      await click('article button[aria-label="Preview photo: Contrast photo 1"]');
      await browser.wait(`!!document.querySelector('[role="dialog"] button[aria-label="Previous media item"]')`);
      await browser.wait(`document.querySelector('[role="dialog"] img')?.complete === true`);
      for (const direction of ["Previous", "Next"]) {
        await states(`[role="dialog"] button[aria-label="${direction} media item"]`, `${width} preview ${direction} icon`);
      }
      await key("Enter", "Enter", 13);
      await browser.wait(`!document.querySelector('[role="dialog"] button[aria-label="Next media item"]')`);
      await key("Escape", "Escape", 27);
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth > innerWidth + 1"), false);
    }
    assert.deepEqual(writes, [], "All API requests must be read-only and intercepted");
    assert.deepEqual(mockErrors, []);
    assert.deepEqual(browser.errors, []);
    assert.deepEqual(failures, [], "Text and icons must reach 4.5:1 in all three states");
  } finally { await browser.close(); }
}

test("button contrast in preview: actual hover, keyboard focus and painted backgrounds", { timeout: 180000 }, async () => {
  await checkPage(preview);
});

test("button contrast in built frontend: identical desktop and narrow-view behavior", { timeout: 180000 }, async () => {
  // Serve the actual production bundle locally, never publish or touch the DB.
  const app = express();
  app.use("/attached_assets", express.static(path.resolve("attached_assets")));
  app.use(express.static(path.resolve("dist/public")));
  app.get("*", (_req, res) => res.sendFile(path.resolve("dist/public/index.html")));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try { await checkPage(`http://127.0.0.1:${server.address().port}`); }
  finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
