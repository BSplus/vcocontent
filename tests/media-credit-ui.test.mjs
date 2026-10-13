import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const poster = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const event = { id: 64321, title: "Credit fixture", date: "2026-10-01", creatorId: null, isPremium: false };

test("local upload and editing labels, public video credits, sharing and clipboard use videographer", { timeout: 60000 }, async () => {
  const browser = await uiBrowser();
  let edited;
  const item = { id: 64322, eventId: event.id, type: "video", caption: "Fixture video", photographer: "Zoë 李", thumbnail: poster,
    url: "/fixture.mp4", tags: [], identification: [], downloadCount: 0, isPremium: false };
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const url = new URL(request.url);
    const path = url.pathname;
    let data = [];
    if (path === "/api/user") data = { id: 880001, username: "Uploader is not the author", isAdmin: true, isCreator: true };
    else if (path === "/api/admin/events" || path === "/api/events") data = [event];
    else if (path === "/api/admin/safety") data = { media: [], events: [] };
    else if (path === "/api/admin/media-usage") data = null;
    else if (path === "/api/media/policy") data = { community: false, imageBytes: 5_000_000, videoBytes: 20_000_000 };
    else if (path.endsWith("/analysis")) data = { status: "idle", tags: [], identification: [] };
    else if (path === `/api/media/${item.id}`) {
      if (request.method === "PUT") { edited = JSON.parse(request.postData); Object.assign(item, edited); }
      data = item;
    }
    else if (path === "/api/media" || path === "/api/media/top-shots") data = [item];
    else if (path === `/api/events/${event.id}/media`) data = url.searchParams.has("pagination")
      ? { items: [item], page: 1, totalPages: 1, total: 1 } : [item];
    else if (path === `/api/events/${event.id}`) data = event;
    void browser.command("Fetch.fulfillRequest", { requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(data)).toString("base64") });
  });
  const click = text => browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
  const label = () => browser.evaluate("document.querySelector('label[for=photographer]').textContent");
  const selectFile = (type, name) => browser.evaluate(`(() => {
    const input=document.querySelector('[role=dialog] input[type=file]');
    const data=new DataTransfer(); data.items.add(new File(['fixture'],${JSON.stringify(name)},{type:${JSON.stringify(type)}}));
    input.files=data.files; input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    await browser.command("Page.addScriptToEvaluateOnNewDocument", { source:
      `Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__credit=text;}}});` });
    await browser.command("Page.navigate", { url: new URL("/admin/dashboard", base).href });
    await browser.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Upload Media')");
    await click("Upload Media");
    await browser.wait("!!document.querySelector('#photographer')");
    assert.equal(await label(), "Photographer / Videographer");
    assert.match(await browser.evaluate("document.querySelector('#upload-credit-help').textContent"), /all files in this upload/);
    await selectFile("image/jpeg", "fixture.jpg");
    await browser.wait("document.querySelector('label[for=photographer]').textContent==='Photographer'");
    // Switch to video; Radix select requires a real pointer activation.
    const point = await browser.evaluate(`(()=>{const r=document.querySelector('[role=dialog] [role=combobox]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    await browser.wait("!!document.querySelector('[role=option]')");
    const videoPoint = await browser.evaluate(`(()=>{const r=[...document.querySelectorAll('[role=option]')].find(e=>e.textContent==='Video').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", ...videoPoint, button: "left", clickCount: 1 });
    await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...videoPoint, button: "left", clickCount: 1 });
    await browser.wait("document.querySelector('label[for=photographer]').textContent==='Photographer / Videographer'");
    await selectFile("video/mp4", "fixture.mp4");
    await browser.wait("document.querySelector('label[for=photographer]').textContent==='Videographer'");
    await click("Cancel");
    await browser.wait("!document.querySelector('[role=dialog]')");
    await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Manage Media').click()");
    await browser.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Edit Media')");
    await click("Edit Media");
    await browser.wait("!!document.querySelector('#photographer')");
    assert.equal(await label(), "Videographer");
    await browser.evaluate(`(()=>{const e=document.querySelector('#photographer');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'  José 李  ');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click("Update Media");
    await browser.wait("!document.querySelector('[role=dialog]')");
    assert.equal(edited.photographer, "José 李");
    await browser.command("Page.navigate", { url: new URL(`/media/${item.id}`, base).href });
    await browser.wait("document.body.innerText.includes('Videographer: José 李')");
    await click("Copy credit & source");
    await browser.wait("!!window.__credit");
    assert.equal(await browser.evaluate("window.__credit"), `Videographer: José 李\nFixture video\nSource: ${new URL(base).origin}/media/${item.id}`);
    await browser.evaluate("window.open=url=>{window.__shareUrl=url;};document.querySelector('button[aria-label=Share]').focus()");
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await browser.wait("[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.includes('Share on X'))");
    await browser.evaluate("[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.includes('Share on X')).click()");
    await browser.wait("!!window.__shareUrl");
    assert.equal(new URL(await browser.evaluate("window.__shareUrl")).searchParams.get("text"), "Fixture video\nVideo by José 李");
    await browser.command("Page.navigate", { url: base });
    await browser.wait("!!document.querySelector('button[aria-label=\"Preview video: Fixture video\"]')");
    await browser.evaluate("document.querySelector('button[aria-label=\"Preview video: Fixture video\"]').click()");
    await browser.wait("document.querySelector('[role=dialog]')?.innerText.includes('Videographer: José 李')");
    assert.ok(!(await browser.evaluate("document.querySelector('[role=dialog]').innerText")).includes("Photographer:"));
    item.type = "image";
    await browser.command("Page.navigate", { url: new URL(`/media/${item.id}`, base).href });
    await browser.wait("document.body.innerText.includes('Photographer: José 李')");
    await click("Copy credit & source");
    await browser.wait("!!window.__credit");
    assert.equal(await browser.evaluate("window.__credit"), `Photographer: José 李\nFixture video\nSource: ${new URL(base).origin}/media/${item.id}`);
  } finally { await browser.close(); }
});
