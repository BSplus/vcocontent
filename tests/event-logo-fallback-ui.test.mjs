import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const legacy = "/attached_assets/%2389_3.png";
const photo = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="blue"/></svg>');
const makeEvent = (id, changes = {}) => ({
  id, title: `Fallback fixture ${id}`, date: new Date(Date.now() - 86400000).toISOString(),
  isPremium: false, creatorId: null, seriesId: null,
  customThumbnail: null, coverImage: legacy, galleryThumbnail: null, ...changes,
});

test("empty event cards use VCO logo until real thumbnails are available", { timeout: 90000 }, async () => {
  const browser = await uiBrowser(), errors = [], requests = [];
  let galleryReady = false;
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    requests.push(path);
    let body = [], status = 200;
    if (path === "/api/user") { status = 401; body = {}; }
    else if (path === "/api/events") body = [
      makeEvent(98801, { galleryThumbnail: galleryReady ? photo : null }),
      makeEvent(98802, { customThumbnail: photo }),
      makeEvent(98803, { customThumbnail: legacy, coverImage: null }),
    ];
    else if (path.startsWith("/api/community/")) body = { count: 0, liked: false, saved: false };
    void browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    }).catch(error => { if (!/Invalid InterceptionId|closed|session/i.test(String(error))) errors.push(String(error)); });
  });
  const visit = async () => {
    await browser.evaluate("window.__previousFixture=true");
    await browser.command("Page.navigate", { url: new URL("/", base).href });
    await browser.wait(`!window.__previousFixture && document.querySelectorAll('section[aria-labelledby="recent-heading"] .mobile-gallery-card').length===3`);
  };
  const images = async () => browser.evaluate(`Array.from(document.querySelectorAll('section[aria-labelledby="recent-heading"] .mobile-gallery-card')).sort((a,b)=>Number(a.querySelector('a[href^="/events/"]').getAttribute('href').split('/').pop())-Number(b.querySelector('a[href^="/events/"]').getAttribute('href').split('/').pop())).map(c=>{
    const image=c.querySelector('a img'); return {src:image?.getAttribute('src'),fit:image&&getComputedStyle(image).objectFit};
  })`);
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, mobile: false, deviceScaleFactor: 1 });
    await visit();
    await browser.wait(`Array.from(document.querySelectorAll('section[aria-labelledby="recent-heading"] .mobile-gallery-card a img')).every(i=>i.naturalWidth>0)`);
    let result = await images();
    assert.deepEqual(result.map(i => i.src), ["/brand/vco-logo-white.png", photo, "/brand/vco-logo-white.png"]);
    assert.equal(result[0].fit, "contain");
    assert.equal(result[1].fit, "cover");
    galleryReady = true;
    await visit();
    result = await images();
    assert.equal(result[0].src, photo);
    assert.equal(result[0].fit, "cover");
    assert.ok(!requests.some(path => path.includes("card-preview")), "Explicit empty gallery state needs no extra request");
    assert.deepEqual(errors, []);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
