import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "../../../tests/helpers/ui-browser.mjs";
import { pageMetadata } from "../../../shared/pagination.ts";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const eventId = 95601;
const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;

async function click(browser, expression) {
  await browser.wait(`!!(${expression})`);
  const point = await browser.evaluate(`(()=>{const el=${expression};el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}

test("event photo matching settings, preserved replacement consent, protected items, confirmed process and polling", { timeout: 120000 }, async () => {
  const browser = await uiBrowser();
  const patches = [], processRequests = [], apiReads = [];
  let pollCount = 0;
  let settings = { id: eventId, enabled: false, platform: null, contentVersion: 0, referenceRevision: 0, photoMatchingRevision: 0 };
  const event = { id: eventId, title: "Photo matching fixture", description: "Fixture event",
    creatorId: null, date: "2026-10-10T12:00:00Z", visibility: "published", isPremium: false };
  const photoRows = () => [
    { id: 95611, caption: "Preserved historical caption", captionSource: "preserved",
      identificationManual: false, status: pollCount < 3 ? "queued" : "completed", error: null, matchStatus: null },
    { id: 95612, caption: "Manual identification fixture", captionSource: "manual",
      identificationManual: true, status: "idle", error: null, matchStatus: null },
    { id: 95613, caption: "Manual caption fixture", captionSource: "manual",
      identificationManual: false, status: "idle", error: null, matchStatus: null },
  ];
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    let status = 200, body = [];
    if (path === "/api/user") body = { id: 95600, username: "photo-fixture", isAdmin: true, isCreator: false };
    else if (path === "/api/admin/events" || path === "/api/events") body = [event];
    else if (path === `/api/events/${eventId}`) body = event;
    else if (path === `/api/events/${eventId}/entries`) body = [];
    else if (path === `/api/events/${eventId}/references`) body = { documents: [], seriesId: null, seasonYear: 2026, canUseSeason: false };
    else if (path === `/api/events/${eventId}/photo-matching` && request.method === "GET") {
      apiReads.push("GET");
      pollCount++;
      body = { ...pageMetadata(3,1,500), ...settings, photos: photoRows() };
    } else if (path === `/api/events/${eventId}/photo-matching` && request.method === "PATCH") {
      const payload = JSON.parse(request.postData); patches.push(payload);
      settings = { ...settings, ...payload, contentVersion: settings.contentVersion + 1 };
      body = { ...settings, saveStatus: "saved" };
    } else if (path === `/api/events/${eventId}/photo-matching/process` && request.method === "POST") {
      pollCount=0;
      processRequests.push(JSON.parse(request.postData));
      body = { results: processRequests.at(-1).mediaIds.map(id => ({ id, status: "completed" })) };
    } else if (path === "/api/admin/safety") body = { media: [], events: [] };
    else if (path === "/api/admin/media-usage") body = { total: { bytes: "0", count: "0", legacy: "0" },
      byEvent: [], byCreator: [], cleanupCount: "0", policy: { eventBytes: 100000000, creatorBytes: 100000000,
        eventCount: 1000, creatorCount: 1000 }, warningFraction: 0.8 };
    else if (/\/media(?:\?|$)/.test(path)) body = [];
    void browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64") });
  });
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    await browser.command("Page.navigate", { url: new URL("/admin/dashboard", base).href });
    await click(browser, button("Edit Event"));
    await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Photo matching')`);

    const platform = `document.querySelector('[aria-label="Sim-racing platform (optional)"]')`;
    await browser.wait(`!!(${platform})`);
    assert.equal(await browser.evaluate(`${platform}.value`), "", "platform must not be guessed");
    assert.equal(await browser.evaluate(`!!document.querySelector('#photo-match-platform-${eventId}')`), false);
    assert.equal(await browser.evaluate(`document.body.textContent.includes('Save platform')`), false);

    await click(browser, `document.querySelector('#photo-match-enabled-${eventId}')`);
    await browser.wait(`document.querySelector('#photo-match-enabled-${eventId}')?.getAttribute('aria-checked')==='true'`);
    await browser.wait("document.body.innerText.includes('Enabled for new uploads')");
    await delay(200);
    assert.equal(patches.at(-1).enabled, true);
    assert.deepEqual(patches.at(-1), { enabled: true });

    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Select photo 95612"]').disabled`), true,
      "manual identification cannot be selected");
    assert.equal(await browser.evaluate(`document.body.innerText.includes('Manual caption is protected from automatic replacement')`), true,
      "manual captions are visibly protected");
    await click(browser, `document.querySelector('[aria-label="Select photo 95611"]')`);
    await click(browser, `[...document.querySelectorAll('[role="checkbox"]')].find(el=>el.closest('label')?.textContent.includes('Replace this explicitly preserved historical caption'))`);
    await browser.wait(`document.body.innerText.includes('Replace this explicitly preserved historical caption')`);
    await click(browser, `[...document.querySelectorAll('[role="checkbox"]')].find(el=>el.closest('label')?.textContent.includes('I explicitly confirm'))`);
    await click(browser, button("Process 1 selected photo"));
    await browser.wait("document.body.innerText.includes('Complete')");
    assert.deepEqual(processRequests[0], { mediaIds: [95611], confirmed: true, replacePreservedIds: [95611] });
    await delay(4300);
    assert.ok(apiReads.length >= 3, "queued/running matching is polled until complete");
    assert.deepEqual(browser.errors, []);
  } finally {
    await browser.close();
  }
});
