import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const date = "2026-10-10T12:00:00Z";
const creator = { id: 83101, username: "Alice fixture", email: "fixture@example.test",
  isCreator: true, isAdmin: false, creatorStatus: "approved", suspended: false, emailVerifiedAt: date };
const official = { id: 83111, title: "Official race fixture", date, creatorId: null,
  description: "Official race content", visibility: "published", safetyStatus: "legacy", isPremium: false };
const other = { ...official, id: 83112, title: "Second official fixture" };
const own = { ...official, id: 83121, title: "Alice gallery fixture", creatorId: creator.id };
const bob = { ...own, id: 83122, title: "Bob gallery fixture", creatorId: 83102 };
const poster = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#24343a"/></svg>');
const photo = { id: 83131, eventId: official.id, type: "image", thumbnail: poster,
  url: poster, caption: "Official photo fixture", tags: [], downloadCount: 0, isPremium: false };

async function click(browser, expression) {
  await browser.wait(`!!(${expression})`);
  const point = await browser.evaluate(`(()=>{const el=${expression};el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
async function select(browser, title, index = 0) {
  await browser.wait(`document.querySelectorAll('[aria-label="Associate gallery with an official event"]').length>${index}`);
  await click(browser, `document.querySelectorAll('[aria-label="Associate gallery with an official event"]')[${index}]`);
  await click(browser, `[...document.querySelectorAll('[role="option"]')].find(o=>o.textContent.includes(${JSON.stringify(title)}))`);
  await browser.wait(`document.querySelectorAll('[aria-label="Associate gallery with an official event"]')[${index}]?.disabled===false`);
}
function mock(browser, handler) {
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    const { body = [], status = 200 } = handler(path, request) || {};
    void browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64") });
  });
}

test("creator can create a gallery then assign, change, remove and recover from rejected/unavailable associations on mobile", { timeout: 120000 }, async () => {
  const browser = await uiBrowser(), owned = [own], writes = [];
  let links = [], reject = false;
  mock(browser, (path, request) => {
    if (path === "/api/user") return { body: creator };
    if (path === "/api/creator/official-events") return { body: [official, other] };
    if (path === "/api/creator/event-associations") return { body: links };
    if (/\/official-event$/.test(path)) {
      const data = JSON.parse(request.postData); writes.push({ path, ...data });
      if (reject) return { status: 404, body: { error: "Official event is not available." } };
      const galleryId = Number(path.split("/")[4]);
      links = links.filter(row => row.galleryId !== galleryId);
      if (data.officialEventId !== null) links.push({ galleryId, ...data, unavailable: false });
      return { body: { galleryId, ...data } };
    }
    if (path === "/api/creator/events" && request.method === "POST") {
      const created = { ...own, ...JSON.parse(request.postData), id: 83123, visibility: "draft" };
      owned.push(created); return { body: created };
    }
    if (path === "/api/creator/events" || path === "/api/events") return { body: owned };
    if (path === "/api/creator/usage") return { body: { bytes: 0, galleries: owned.length, photos: 0,
      limits: { bytes: 500000000, galleries: 5, photos: 1000, imageBytes: 5000000 }, eventStats: [] } };
    return { body: [] };
  });
  try {
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    await browser.command("Page.navigate", { url: new URL("/creator/dashboard", base).href });
    await click(browser, button("My Galleries"));
    await browser.wait("document.body.textContent.includes('Alice gallery fixture')");
    await select(browser, "Official race fixture");
    assert.equal(writes.at(-1).officialEventId, official.id);
    await browser.wait("document.querySelector('[aria-label=\"Associate gallery with an official event\"]').textContent.includes('Official race fixture')");
    await select(browser, "Second official fixture");
    assert.equal(writes.at(-1).officialEventId, other.id);
    await select(browser, "No association");
    assert.equal(writes.at(-1).officialEventId, null);
    assert.equal(writes.at(-1).path, `/api/creator/events/${own.id}/official-event`);
    reject = true;
    await select(browser, "Official race fixture");
    await browser.wait("document.body.innerText.includes('Official event is not available.')");
    assert.equal(links.length, 0);
    reject = false;
    await select(browser, "Second official fixture");
    await browser.wait("!document.body.innerText.includes('Official event is not available.')");

    // Newly created galleries expose the same association control, no second model.
    await click(browser, button("Create New Event"));
    await browser.wait("!!document.querySelector('[role=dialog] form')");
    await browser.evaluate(`for(const [name,value] of [['title','New associated fixture'],['description','Synthetic gallery'],['date','2026-10-11']]){
      const el=document.querySelector('[role=dialog] [name="'+name+'"]');
      const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
    }document.querySelector('[role=dialog] form').requestSubmit();`);
    await click(browser, button("Done"));
    await browser.wait("!document.querySelector('[role=dialog]') && document.querySelectorAll('[aria-label=\"Associate gallery with an official event\"]').length===2");
    await select(browser, "Official race fixture", 0);
    assert.equal(writes.at(-1).path, "/api/creator/events/83123/official-event");

    links = [{ galleryId: own.id, officialEventId: null, unavailable: true }];
    await browser.command("Page.navigate", { url: new URL("/creator/dashboard", base).href });
    await click(browser, button("My Galleries"));
    await browser.wait("document.body.innerText.includes('Linked event unavailable')");
    assert.equal(await browser.evaluate("document.body.innerText.includes('Second official fixture')"), false);
    await select(browser, "No association", 1);
    assert.equal(writes.at(-1).officialEventId, null);
    await browser.wait("!document.body.innerText.includes('Linked event unavailable')");
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});

test("official media has priority; multiple attributed community galleries retain original links and errors retry explicitly", { timeout: 90000 }, async () => {
  const browser = await uiBrowser();
  let fail = false, empty = false, communityRequests = 0;
  mock(browser, (path) => {
    if (path === "/api/user") return { status: 401, body: { error: "Signed out" } };
    if (path === `/api/events/${official.id}`) return { body: official };
    if (path === `/api/events/${own.id}`) return { body: own };
    if (path === `/api/events/${official.id}/media`) return { body: [photo] };
    if (path === `/api/events/${official.id}/community-galleries`) {
      communityRequests++;
      return fail ? { status: 500, body: { error: "Synthetic failure" } } : { body: empty ? [] :
        [ { ...own, creatorName: "Alice fixture" }, { ...bob, creatorName: "Bob fixture" } ] };
    }
    if (path.startsWith("/api/community/")) return { body: { count: 0, liked: false, saved: false } };
    if (path === `/api/users/${creator.id}`) return { body: creator };
    return { body: [] };
  });
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    await browser.command("Page.navigate", { url: new URL(`/events/${official.id}`, base).href });
    await browser.wait("document.body.innerText.includes('Bob gallery fixture')");
    assert.equal(await browser.evaluate(`(()=>{const section=document.querySelector('[aria-labelledby="community-galleries-heading"]');
      const media=document.querySelector('main img');return !!(media.compareDocumentPosition(section)&Node.DOCUMENT_POSITION_FOLLOWING);})()`), true);
    for (const [gallery, name] of [[own, "Alice fixture"], [bob, "Bob fixture"]]) {
      assert.equal(await browser.evaluate(`!!document.querySelector('[aria-labelledby="community-galleries-heading"] a[href="/events/${gallery.id}"]')`), true);
      assert.equal(await browser.evaluate(`document.querySelector('[aria-labelledby="community-galleries-heading"]').textContent.includes(${JSON.stringify(name)})`), true);
    }
    assert.equal(await browser.evaluate("document.querySelectorAll('[aria-labelledby=\"community-galleries-heading\"] [aria-label*=\"Like\"]').length"), 0);
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
    fail = true;
    await browser.command("Page.navigate", { url: new URL(`/events/${official.id}`, base).href });
    await browser.wait("document.body.innerText.includes('Community galleries could not be loaded.')");
    assert.equal(await browser.evaluate("!!document.querySelector('main img')"), true, "official content stays usable on community failure");
    fail = false; empty = true;
    await click(browser, button("Retry"));
    await browser.wait("document.body.innerText.includes('No creator galleries are linked to this event yet.')");
    const count = communityRequests;
    await browser.command("Page.navigate", { url: new URL(`/events/${own.id}`, base).href });
    await browser.wait("document.body.textContent.includes('Alice gallery fixture') && document.body.innerText.includes('By Alice fixture')");
    await delay(150);
    assert.equal(communityRequests, count, "creator pages never fetch official community lists");
    assert.equal(await browser.evaluate("document.body.innerText.includes('Community galleries')"), false);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
