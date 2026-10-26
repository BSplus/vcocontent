import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const root = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#0044ff" } }).png().toBuffer();
const button = text => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`;
const menu = text => `[...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
async function click(b, expression) {
  await b.wait(`!!(${expression})`);
  await b.wait(`(()=>{const el=${expression};return !!el && (el.closest('[role="menu"],[role="dialog"]')?.getAnimations() || []).every(a=>a.playState==='finished')})()`);
  const point = await b.evaluate(`(()=>{const el=${expression};el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await b.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await b.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
async function openSharing(b, instagram = false) {
  await click(b, `[...document.querySelectorAll('button[aria-label="Share"]')].at(-1)`);
  await click(b, menu(instagram ? "Share on Instagram" : "Share image…"));
  await b.wait(`!!document.querySelector('[role="dialog"] [role="status"]')`);
}

test("native image handoff: exact bytes, MIME, media/poster/gallery context, errors, cancellation and duplicate clicks", { timeout: 120000 }, async () => {
  const b = await uiBrowser();
  let failImage = false, badMime = false, oversized = false, invalidBytes = false, failDescriptor = false, descriptorDelay = 0, badAddress = false;
  const descriptors = [], imageRequests = [], requests = [];
  const item = id => ({ id, eventId: 8, type: id === 12 ? "video" : "image", caption: id === 12 ? "Video poster" : "Photo title",
    photographer: "Existing Author", thumbnail: `data:image/png;base64,${png.toString("base64")}`, url: "/unused-video",
    safetyStatus: "legacy", tags: [] });
  const event = { id: 8, title: "Gallery title", date: "2020-01-01", customThumbnail: "/chosen-outside-page" };
  b.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params, path = new URL(request.url).pathname;
    requests.push({ path, method: request.method });
    let status = 200, content = {}, type = "application/json", raw;
    if (path === "/api/user") { status = 401; }
    else if (path === "/api/events/8") content = event;
    else if (path === "/api/media/11" || path === "/api/media/12") content = item(Number(path.split("/").at(-1)));
    else if (path === "/api/events/8/media") content = { items: [item(11), item(12)], page: 1, totalPages: 1, totalItems: 2, hasMore: false };
    else if (/^\/api\/sharing\/(media|event)\/\d+$/.test(path)) {
      descriptors.push(path);
      content = { image: path.includes("/event/") ? "/api/events/8/thumbnail?field=customThumbnail&direct=1&public=1" :
        `${path}/image`, credit: path.includes("/event/") ? "Photo by Gallery Author" : path.includes("/12") ? "Video by Existing Author" : "Photo by Existing Author" };
      if (failDescriptor) status = 404;
      if (badAddress) content.image = "https://external.invalid/original.jpg";
    } else if (path.endsWith("/image") || path === "/api/events/8/thumbnail") {
      imageRequests.push(path); type = badMime ? "text/html" : "image/png";
      raw = invalidBytes ? Buffer.from("<html>not a photo</html>") : oversized ? Buffer.alloc(5 * 1024 * 1024 + 1) : png;
      if (failImage) status = 503;
    } else if (path === "/api/events") content = [event];
    else if (path === "/api/media/top-shots" || path === "/api/media/creator-top") content = [item(11), item(12)];
    else if (path.includes("/community/")) content = { count: 0, liked: false, saved: false };
    const reply = () => b.command("Fetch.fulfillRequest", { requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: type }],
      body: (raw || Buffer.from(JSON.stringify(content))).toString("base64") });
    if (descriptorDelay && /^\/api\/sharing\/(media|event)\/\d+$/.test(path)) setTimeout(() => void reply().catch(() => {}), descriptorDelay);
    else void reply();
  });
  try {
    await b.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    await b.command("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.shareCalls=[]; window.shareMode='success';window.fileSupported=true;window.actualFileSupported=true;
      window.canShareMock=data=>window.fileSupported&&data.files?.[0] instanceof File&&(window.actualFileSupported||data.files[0].size===4);
      Object.defineProperty(navigator,'canShare',{configurable:true,value:window.canShareMock});
      Object.defineProperty(navigator,'share',{configurable:true,value:data=>{
        window.shareCalls.push(data);
        if(window.shareMode==='abort')return Promise.reject(new DOMException('Cancelled','AbortError'));
        if(window.shareMode==='error')throw new Error('Share failed');
        if(window.shareMode==='pending')return new Promise(resolve=>window.finishShare=resolve);
        return Promise.resolve();
      }});
    ` });
    const navigate = async path => {
      await b.command("Page.navigate", { url: root + path });
      await b.wait(`!!document.querySelector('button[aria-label="Share"]')`);
    };
    const ready = async () => b.wait(`!!(${button("Share image…")})`);
    const close = async () => {
      await click(b, `[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent==='Close')`);
      await b.wait(`!document.querySelector('[role="dialog"] [role="status"]')`);
    };
    await navigate("/media/11");
    await openSharing(b); await ready();
    await b.evaluate("window.shareMode='pending'");
    await b.evaluate(`(()=>{const el=${button("Share image…")};el.click();el.click()})()`);
    assert.equal(await b.evaluate("shareCalls.length"), 1);
    const received = await b.evaluate(`(async()=>{const d=shareCalls[0],f=d.files[0];return {name:f.name,type:f.type,bytes:Array.from(new Uint8Array(await f.arrayBuffer())),text:d.text,url:d.url,title:d.title}})()`);
    assert.deepEqual(received.bytes, [...png]);
    assert.equal(received.type, "image/png"); assert.equal(received.name, "vco-media-11.png");
    assert.equal(received.title, "Photo title");
    assert.match(received.text, /Photo by Existing Author/);
    assert.ok(received.text.includes(`Source: ${root}/media/11`));
    assert.equal(received.url, root + "/media/11");
    await b.evaluate("finishShare()");
    await b.wait("document.body.innerText.includes('does not confirm a published post')");
    await close();

    // Abort is an ordinary outcome, no destructive toast and no success claim.
    await b.evaluate("window.shareMode='abort'");
    await openSharing(b); await ready(); await click(b, button("Share image…"));
    await b.wait("document.body.innerText.includes('Sharing cancelled')");
    assert.equal(await b.evaluate("!!document.querySelector('[data-variant=destructive]')"), false);
    await b.evaluate("window.shareMode='error'");
    await click(b, button("Share image…"));
    await b.wait("document.body.innerText.includes('could not be shared')");
    await close();

    for (const mode of ["unsupported", "missing", "actual-file", "load", "mime", "bytes", "size", "denied", "address"]) {
      failImage = mode === "load"; badMime = mode === "mime"; invalidBytes = mode === "bytes";
      oversized = mode === "size"; failDescriptor = mode === "denied"; badAddress = mode === "address";
      await b.evaluate(`window.fileSupported=${mode !== "unsupported"};window.actualFileSupported=${mode !== "actual-file"};
        Object.defineProperty(navigator,'canShare',{configurable:true,value:${mode === "missing" ? "undefined" : "window.canShareMock"}})`);
      const before = await b.evaluate("shareCalls.length");
      await openSharing(b);
      await b.wait(`!document.body.innerText.includes('Preparing public image preview…')`);
      assert.equal(await b.evaluate(`!!(${button("Share image…")})`), false);
      assert.equal(await b.evaluate("shareCalls.length"), before);
      await close();
    }
    failImage = badMime = invalidBytes = oversized = failDescriptor = badAddress = false;
    await b.evaluate("window.fileSupported=true;window.actualFileSupported=true;window.shareMode='success'");
    descriptorDelay = 350;
    const beforePrepare = descriptors.length;
    await openSharing(b);
    await b.evaluate(`document.querySelector('[role="dialog"] button[disabled]')?.click()`);
    await ready();
    assert.equal(descriptors.length, beforePrepare + 1);
    descriptorDelay = 0;
    await close();
    await navigate("/media/12");
    await openSharing(b, true); await ready(); await click(b, button("Share image…"));
    assert.match(await b.evaluate("shareCalls[0].text"), /Video by Existing Author/);
    assert.equal(await b.evaluate("shareCalls[0].files[0].name"), "vco-media-12.png");
    assert.ok(imageRequests.includes("/api/sharing/media/12/image"));
    await navigate("/events/8?page=2");
    await openSharing(b); await ready(); await click(b, button("Share image…"));
    assert.equal(await b.evaluate("shareCalls[0].files[0].name"), "vco-event-8.png");
    assert.match(await b.evaluate("shareCalls[0].text"), /Gallery Author/);
    assert.ok(imageRequests.includes("/api/events/8/thumbnail"));
    await close();

    // The shared grid's preview uses its selected media, not the gallery context.
    await click(b, `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Preview')`);
    await openSharing(b); await ready(); await click(b, button("Share image…"));
    assert.equal(await b.evaluate("shareCalls.at(-1).files[0].name"), "vco-media-11.png");
    assert.ok(descriptors.includes("/api/sharing/media/11"));
    // Home-page preview supplies its own selected-media context as well.
    await b.command("Page.navigate", { url: root + "/" });
    await click(b, `document.querySelector('button[aria-label="Preview photo: Photo title"]')`);
    await openSharing(b); await ready(); await click(b, button("Share image…"));
    assert.equal(await b.evaluate("shareCalls.at(-1).files[0].name"), "vco-media-11.png");
    await close();
    await click(b, `document.querySelector('button[aria-label="Next media item"]')`);
    await openSharing(b); await ready(); await click(b, button("Share image…"));
    assert.equal(await b.evaluate("shareCalls.at(-1).files[0].name"), "vco-media-12.png");
    assert.ok(requests.every(request => request.method === "GET"));
    // Download-size labels perform read-only /download-info requests on render.
    assert.ok(requests.every(request => !/\/download$/.test(request.path)));
    assert.deepEqual(b.errors.filter(e => /Uncaught|TypeError/.test(e)), []);
  } finally { await b.close(); }
});
