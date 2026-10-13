import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser } from "./helpers/ui-browser.mjs";
import { pageMetadata } from "../shared/pagination.ts";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const event = { id: 98101, title: "Event actions fixture", description: "Actions below this description.",
  date: "2026-10-13T12:00:00Z", creatorId: null, visibility: "published" };
const poster = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#20354a"/></svg>');
const photo = { id: 98102, eventId: event.id, type: "image", caption: "Actions photo", thumbnail: poster, url: poster, tags: [] };
const group = 'header [role="group"][aria-label="Community actions"]';
const like = `${group} button[aria-label*=" likes"]`;
const save = `${group} button[aria-label*=" favorites"]`;
const share = `${group} button[aria-label="Share"]`;

test("event header actions share a responsive row without changing media actions", { timeout: 120000 }, async () => {
  const browser = await uiBrowser();
  let signedIn = true, count = 2, liked = false, saved = false, readFails = false, writeFails = false;
  const writes = [], mockErrors = [];
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    let body = [], status = 200;
    if (path === "/api/user") {
      status = signedIn ? 200 : 401;
      body = signedIn ? { id: 98103, username: "fixture-user" } : { error: "Not signed in" };
    } else if (path.startsWith("/api/community/")) {
      if (request.method !== "GET") {
        writes.push(`${request.method} ${path}`);
        if (writeFails) status = 400;
        else if (path.endsWith("/like")) {
          const active = request.method === "PUT";
          count += active === liked ? 0 : active ? 1 : -1;
          liked = active;
        } else if (path.endsWith("/favorite")) saved = request.method === "PUT";
      } else if (readFails) status = 503;
      body = status === 200 ? { count, liked, saved } : { error: "Synthetic rejection" };
    } else if (path === `/api/events/${event.id}`) body = event;
    else if (path === `/api/events/${event.id}/media`) body = { ...pageMetadata(0, 1, 48), items: [] };
    else if (path === `/api/media/${photo.id}`) body = photo;
    void browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(error => {
      if (!String(error).includes("Invalid InterceptionId")) mockErrors.push(String(error));
    });
  });
  const visit = async path => {
    await browser.evaluate(`history.pushState(null,'','/privacy-policy')`);
    await browser.wait(`location.pathname==='/privacy-policy' && !document.querySelector(${JSON.stringify(group)})`);
    await browser.evaluate(`(async()=>{const {queryClient}=await import('/src/lib/queryClient.ts');await queryClient.resetQueries();history.pushState(null,'',${JSON.stringify(path)});})()`);
    await browser.wait(`!!document.querySelector(${JSON.stringify(share)}) && !!document.querySelector(${JSON.stringify(like + ":not(:disabled)")})`);
    await browser.wait(signedIn
      ? `!document.querySelector(${JSON.stringify(group)}).textContent.includes('Sign in to join in')`
      : `document.querySelector(${JSON.stringify(group)}).textContent.includes('Sign in to join in')`);
  };
  const press = async (key, code, value) => {
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: value, ...(key === "Enter" ? { text: "\r" } : {}) });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: value });
  };
  const geometry = async () => browser.evaluate(`(()=>{
    const row=document.querySelector(${JSON.stringify(group)}), r=row.getBoundingClientRect();
    const buttons=[${[like, save, share].map(s => `document.querySelector(${JSON.stringify(s)})`).join(",")}];
    return {width:innerWidth, overflow:document.documentElement.scrollWidth>innerWidth+1, left:r.left,
      buttons:buttons.map(b=>{const v=b.getBoundingClientRect();return {left:v.left,right:v.right,top:v.top,height:v.height,width:v.width};})};
  })()`);
  const assertRow = async () => {
    const layout = await geometry(), [a, b, c] = layout.buttons;
    assert.equal(layout.overflow, false, `${layout.width}px page overflow`);
    assert.equal(a.left, layout.left, "left aligned");
    assert.equal(a.top, b.top, "Like and Save on one row");
    assert.equal(b.top, c.top, "Share on same row");
    assert.equal(b.left - a.right, 8);
    assert.equal(c.left - b.right, 8);
    for (const button of layout.buttons) {
      assert.ok(button.height >= 44 && button.width >= 44, "touch targets retained");
      assert.ok(button.right <= layout.width, "button not clipped");
    }
  };
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    await browser.command("Page.navigate", { url: new URL("/privacy-policy", base).href });
    await browser.wait(`!!document.querySelector('#root main') && !document.querySelector('#app-startup')`);
    for (const width of [1280, 375, 320]) {
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      for (const guest of [false, true]) {
        signedIn = !guest;
        for (const initialCount of [2, 999999999]) {
          count = initialCount; liked = false; saved = false;
          await visit(`/events/${event.id}`);
          await assertRow();
        }
      }
    }
    signedIn = true; count = 999999999;
    await visit(`/events/${event.id}`);
    await browser.evaluate(`document.querySelector(${JSON.stringify(like)}).focus()`);
    await press("Enter", "Enter", 13);
    await browser.wait(`document.querySelector(${JSON.stringify(like + ":not(:disabled)")})?.getAttribute('aria-pressed')==='true'`);
    assert.equal(count, 1000000000);
    await press("Tab", "Tab", 9);
    assert.equal(await browser.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(save)})`), true);
    await press("Enter", "Enter", 13);
    await browser.wait(`document.querySelector(${JSON.stringify(save + ":not(:disabled)")})?.getAttribute('aria-pressed')==='true'`);
    await assertRow();
    await press("Tab", "Tab", 9);
    assert.equal(await browser.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(share)})`), true);
    await press("Enter", "Enter", 13);
    await browser.wait(`!!document.querySelector('[role="menu"]')`);
    assert.match(await browser.evaluate(`document.querySelector('[role="menu"]').textContent`), /Share on X.*Share on Facebook.*Share on LinkedIn.*Share on Instagram.*Copy Link/);
    await press("Escape", "Escape", 27);
    await browser.wait(`!document.querySelector('[role="menu"]')`);
    assert.equal(await browser.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(share)})`), true);
    // Also open through an actual pointer interaction.
    const { x, y } = await browser.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(share)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await browser.wait(`!!document.querySelector('[role="menu"]')`);
    await press("Escape", "Escape", 27);
    await browser.wait(`!document.querySelector('[role="menu"]')`);
    writeFails = true;
    await browser.evaluate(`document.querySelector(${JSON.stringify(like)}).click()`);
    await browser.wait(`!!document.querySelector(${JSON.stringify(group + ' [role="alert"]')}) && !!document.querySelector(${JSON.stringify(like + ":not(:disabled)")})`);
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(like)}).getAttribute('aria-pressed')`), "true");
    await assertRow();
    const errorFits = await browser.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(group + ' [role="alert"]')}).getBoundingClientRect();return r.right<=innerWidth;})()`);
    assert.equal(errorFits, true);
    writeFails = false; readFails = true; signedIn = false;
    await visit(`/events/${event.id}`);
    await browser.wait(`document.querySelector(${JSON.stringify(group)}).textContent.includes('Retry')`);
    await assertRow();
    readFails = false;
    await browser.evaluate(`[...document.querySelectorAll(${JSON.stringify(group + " button")})].find(b=>b.textContent==='Retry').click()`);
    await browser.wait(`!document.querySelector(${JSON.stringify(group)}).textContent.includes('Retry')`);
    const beforeGuestClick = writes.length;
    await browser.evaluate(`document.querySelector(${JSON.stringify(save)}).click()`);
    await browser.wait(`location.pathname==='/auth'`);
    assert.equal(await browser.evaluate(`new URLSearchParams(location.search).get('next')`), `/events/${event.id}`);
    assert.equal(writes.length, beforeGuestClick, "guest action never mutates");
    await visit(`/events/${event.id}`);
    // Exceptional container constraint: wrap, never clip or shrink the buttons.
    await browser.evaluate(`document.querySelector(${JSON.stringify(group)}).style.width='180px'`);
    const narrow = await geometry();
    assert.ok(narrow.buttons[2].top > narrow.buttons[0].top, "wrap under exceptional constraints");
    for (const b of narrow.buttons) assert.ok(b.right <= narrow.left + 180 && b.height >= 44 && b.width >= 44);
    assert.equal(narrow.overflow, false);
    // Shared components elsewhere retain their original layout and trigger sizing.
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    // Client navigation keeps synthetic IDs out of the real server's SEO lookup.
    await browser.evaluate(`history.pushState(null,'',${JSON.stringify(`/media/${photo.id}`)})`);
    await browser.wait(`!!document.querySelector('main [role="group"] button[aria-label*="Actions photo"]:not(:disabled)') && !!document.querySelector('main button[aria-label="Share"]')`);
    assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector('main [role="group"]')).flexWrap`), "nowrap");
    assert.equal(await browser.evaluate(`document.querySelector('main [role="group"]').contains(document.querySelector('main button[aria-label="Share"]'))`), false);
    assert.equal(await browser.evaluate(`document.querySelector('main button[aria-label="Share"]').classList.contains('w-10')`), true);
    assert.deepEqual(writes, [`PUT /api/community/event/${event.id}/like`, `PUT /api/community/event/${event.id}/favorite`, `DELETE /api/community/event/${event.id}/like`]);
    assert.deepEqual(mockErrors, []);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
