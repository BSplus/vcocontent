import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser } from "../../tests/helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const field = "document.getElementById('vehicle')";
const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
async function click(browser, expression) {
  await browser.wait(`!!(${expression})`);
  await browser.evaluate(`(${expression}).click()`);
}
async function input(browser, id, value) {
  await browser.evaluate(`(()=>{
    const el=document.getElementById(${JSON.stringify(id)});
    const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
}

test("event single-vehicle context creates, edits, clears, and resets after cancellation", { timeout: 90000 }, async () => {
  const browser = await uiBrowser();
  const writes = [], errors = [];
  let event = { id: 95701, title: "Vehicle context fixture", description: "Isolated fixture",
    date: "2026-10-11T00:00:00.000Z", creatorId: null, vehicle: "Existing make",
    platform: null, photoMatchingEnabled: false, isPremium: false, visibility: "draft" };
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params, path = new URL(request.url).pathname;
    let body = [], status = 200;
    if (path === "/api/user") body = { id: 95700, username: "vehicle-ui-fixture", isAdmin: true,
      isCreator: false, creatorStatus: "none", emailVerifiedAt: event.date };
    else if (["/api/events", "/api/admin/events", "/api/creator/events"].includes(path)) {
      if (request.method === "POST") {
        const payload = JSON.parse(request.postData);
        writes.push({ method: request.method, path, payload });
        event = { ...event, ...payload, id: 95702, vehicle: payload.vehicle ?? null };
        body = event; status = 201;
      } else body = [event];
    } else if (path === "/api/creator/usage") body = { bytes: 0, galleries: 1, photos: 0,
      limits: { bytes: 500000000, galleries: 5, photos: 1000, imageBytes: 5000000 } };
    else if (/^\/api\/events\/\d+$/.test(path)) {
      body = event;
      if (request.method === "PUT") {
        const payload = JSON.parse(request.postData);
        writes.push({ method: request.method, path, payload });
        event = { ...event, ...payload };
        body = { ...event, saveStatus: "saved" };
      }
    } else if (path.endsWith("/references")) body = { documents: [], seasonYear: 2026, canUseSeason: false };
    else if (path.endsWith("/thumbnail-options")) body = { page: 1, photos: [], hasMore: false };
    else if (path.endsWith("/sources")) body = { sources: [] };
    else if (path.endsWith("/photo-matching")) body = { enabled: false };
    else if (path === "/api/admin/safety") body = { media: [], events: [] };
    else if (path === "/api/admin/media-usage") body = { total: { bytes: "0", count: "0", legacy: "0" },
      byEvent: [], byCreator: [], cleanupCount: "0", policy: { eventBytes: 1000000, creatorBytes: 1000000,
        eventCount: 100, creatorCount: 100 }, warningFraction: 0.8 };
    void browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(error => errors.push(String(error)));
  });
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    await browser.command("Page.navigate", { url: new URL("/admin/dashboard", base).href });
    await click(browser, button("Edit Event"));
    await browser.wait(`${field}?.value===${JSON.stringify(event.vehicle)}`);
    const desktopField = await browser.evaluate(`(()=>{const r=${field}.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth};})()`);
    assert.ok(desktopField.left >= 0 && desktopField.right <= desktopField.width, "vehicle field fits desktop viewport");
    assert.match(await browser.evaluate(`document.querySelector('label[for="vehicle"]').textContent`), /Single vehicle or make/);
    assert.match(await browser.evaluate(`document.getElementById('vehicle-help').textContent`), /Leave empty for mixed-vehicle events.*event-wide caption context.*not evidence/);

    await input(browser, "vehicle", " Unsaved make ");
    await click(browser, button("Cancel"));
    await browser.wait(`!document.querySelector('[role="dialog"]')`);
    await click(browser, button("Edit Event"));
    await browser.wait(`${field}?.value===${JSON.stringify(event.vehicle)}`);
    assert.equal(await browser.evaluate(`${field}.value`), "Existing make", "cancel and reopen restores saved event value");

    await input(browser, "vehicle", "x".repeat(161));
    await click(browser, button("Update Event"));
    await browser.wait(`document.getElementById('vehicle-error')?.textContent.includes('160 characters')`);
    assert.equal(writes.length, 0, "overlong single-vehicle context is rejected before a write");

    await input(browser, "vehicle", "  Porsche 911 GT3 R  ");
    await click(browser, button("Update Event"));
    await browser.wait(`!document.querySelector('[role="dialog"]')`);
    assert.deepEqual(writes.at(-1), { method: "PUT", path: "/api/events/95701", payload: { vehicle: "Porsche 911 GT3 R" } });

    await click(browser, button("Edit Event"));
    await browser.wait(`${field}?.value===${JSON.stringify(event.vehicle)}`);
    await input(browser, "vehicle", "   ");
    await click(browser, button("Update Event"));
    await browser.wait(`!document.querySelector('[role="dialog"]')`);
    assert.deepEqual(writes.at(-1).payload, { vehicle: null }, "whitespace clears the event context");

    await click(browser, button("Create VCO Event"));
    await browser.wait(`!!${field}`);
    assert.equal(await browser.evaluate(`${field}.value`), "");
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const mobileField = await browser.evaluate(`(()=>{const r=${field}.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scrollWidth:document.documentElement.scrollWidth};})()`);
    assert.ok(mobileField.left >= 0 && mobileField.right <= mobileField.width, "vehicle field fits mobile viewport");
    assert.ok(mobileField.scrollWidth <= mobileField.width + 1, "dialog does not introduce horizontal overflow on mobile");
    await input(browser, "vehicle", "  Ferrari 296 GT3 ");
    await input(browser, "title", "Single make fixture");
    await input(browser, "description", "Synthetic test event");
    await click(browser, button("Create Event"));
    await browser.wait(`document.body.textContent.includes('Event created')`);
    assert.equal(writes.at(-1).path, "/api/events");
    assert.equal(writes.at(-1).payload.vehicle, "Ferrari 296 GT3");
    assert.deepEqual(errors, []);
    assert.deepEqual(browser.errors, []);
  } finally {
    await browser.close();
  }
});
