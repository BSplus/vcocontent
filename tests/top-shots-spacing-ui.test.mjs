import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const poster = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="#225477"/></svg>');
const media = ["video", "image", "image"].map((type, index) => ({
  id: 98700 + index, eventId: 98700, type, thumbnail: poster, url: poster,
  caption: index === 0 ? "Kinetic_Move_of_the_Race_IMSA_R2_Sebring_16_9_" + "long_filename_".repeat(8) : "IMSA photo",
  downloadCount: 12, tags: [],
}));

test("Top Shots video and photo keep their card gap with long filenames", { timeout: 120000 }, async () => {
  const browser = await uiBrowser();
  const errors = [];
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    let body = [], status = 200;
    if (path === "/api/user") { body = {}; status = 401; }
    else if (path === "/api/media/top-shots") body = media;
    else if (path.startsWith("/api/community/")) body = { count: 0, liked: false, saved: false };
    void browser.command("Fetch.fulfillRequest", {
      requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    }).catch(error => { if (!/Invalid InterceptionId|closed|session/i.test(String(error))) errors.push(String(error)); });
  });
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    for (const width of [320, 390, 430, 768, 1600]) {
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await browser.command("Page.navigate", { url: new URL("/", base).href });
      await browser.wait(`document.querySelectorAll('section[aria-labelledby="top-shots-heading"] .mobile-gallery-card').length===3`);
      await browser.wait(`!document.documentElement.hasAttribute("data-app-starting")`);
      await browser.evaluate(`document.querySelector('section[aria-labelledby="top-shots-heading"]').scrollIntoView({block:"start"})`);
      const bounds = await browser.evaluate(`(() => {
        const row=document.querySelector('section[aria-labelledby="top-shots-heading"] .mobile-gallery-row');
        const cards=Array.from(row.children), buttons=cards.map(c=>c.firstElementChild.getBoundingClientRect());
        return {width:innerWidth, pageWidth:document.documentElement.scrollWidth, display:getComputedStyle(row).display,
          gap:buttons[1].left-buttons[0].right, sameTop:Math.abs(buttons[1].top-buttons[0].top),
          fits:cards.every((c,i)=>Math.abs(c.getBoundingClientRect().width-buttons[i].width)<1)};
      })()`);
      assert.equal(bounds.width, width);
      assert.ok(bounds.pageWidth <= width + 1, JSON.stringify(bounds));
      assert.ok(bounds.fits, JSON.stringify(bounds));
      assert.ok(bounds.sameTop < 1, JSON.stringify(bounds));
      assert.equal(bounds.display, width < 768 ? "flex" : "grid");
      assert.ok(Math.abs(bounds.gap - (width < 768 ? 12 : 16)) < 1, JSON.stringify(bounds));
      if (width === 390) {
        await mkdir("generated-artifacts/top-shots", { recursive: true });
        const capture = await browser.command("Page.captureScreenshot", { format: "png" });
        await writeFile("generated-artifacts/top-shots/mobile-spacing.png", Buffer.from(capture.data, "base64"));
        await browser.evaluate(`document.querySelector('button[aria-label="Next Top shots"]').click()`);
        await browser.wait(`document.querySelector('section[aria-labelledby="top-shots-heading"] .mobile-gallery-row').scrollLeft>100`);
        await browser.evaluate(`document.querySelector('section[aria-labelledby="top-shots-heading"] .mobile-gallery-card:nth-child(2) button').click()`);
        await browser.wait(`!!document.querySelector('[role="dialog"]')`);
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
