import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const photo = (await sharp({ create: { width: 120, height: 80, channels: 3,
  background: "#fe315b" } }).webp().toBuffer()).toString("base64");
const fallback = "/attached_assets/%2389_3.png";
const selectedPhoto = (await sharp({ create: { width: 80, height: 60, channels: 3,
  background: "#1188dd" } }).webp().toBuffer()).toString("base64");

const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
async function click(browser, expression) {
  await browser.wait(`!!(${expression})`);
  const point = await browser.evaluate(`(()=>{const el=${expression};el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}

for (const editing of [false, true]) test(`official ${editing ? "editing" : "creation"} keeps valid selection after rejected files and shows save errors`,
  { timeout: 90000 }, async () => {
    const browser = await uiBrowser(), writes = [], mockErrors = [];
    let reject = true;
    let event = { id: 95001, title: "Official image validation fixture", description: "Synthetic fixture",
      creatorId: null, date: new Date().toISOString(), customThumbnail: `data:image/webp;base64,${photo}`,
      coverImage: fallback, visibility: "published", isPremium: false };
    browser.listeners.add(message => {
      if (message.method !== "Fetch.requestPaused") return;
      const { requestId, request } = message.params;
      const path = new URL(request.url).pathname;
      let content = [], status = 200;
      if (path === "/api/user") content = { id: 99999, username: "synthetic-admin", isAdmin: true, isCreator: false };
      if (path === "/api/admin/events" || path === "/api/events") content = [event];
      if (path === "/api/events/95001") content = event;
      if (path === "/api/admin/safety") content = { media: [], events: [] };
      if (path === "/api/admin/media-usage") content = { total: { bytes: "0", count: "0", legacy: "0" },
        byEvent: [], byCreator: [], cleanupCount: "0", policy: { eventBytes: 100000000, creatorBytes: 100000000,
          eventCount: 1000, creatorCount: 1000 }, warningFraction: 0.8 };
      if (["POST", "PUT"].includes(request.method) && ["/api/events", "/api/events/95001"].includes(path)) {
        const body = JSON.parse(request.postData); writes.push({ method: request.method, ...body });
        if (reject) { status = 400; content = { error: "Event thumbnail: Image must not exceed 40 megapixels (all frames combined)." }; }
        else { event = { ...event, ...body }; content = event; status = editing ? 200 : 201; }
      }
      void browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(content)).toString("base64") }).catch(error => mockErrors.push(String(error)));
    });
    const select = async (bytes, type, name) => {
      await browser.evaluate(`(() => {
        const input=document.querySelector('input[aria-label="Choose event thumbnail"]');
        const data=new DataTransfer();
        data.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0))],
          ${JSON.stringify(name)},{type:${JSON.stringify(type)}}));
        input.files=data.files; input.dispatchEvent(new Event('change',{bubbles:true}));
      })()`);
      await browser.wait(`!document.querySelector('input[aria-label="Choose event thumbnail"]').disabled`);
    };
    const preview = `document.querySelector('img[alt="Thumbnail preview"]')?.getAttribute('src')`;
    try {
      await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
      await browser.command("Emulation.setDeviceMetricsOverride", { width: editing ? 1600 : 390,
        height: 1080, deviceScaleFactor: 1, mobile: !editing });
      await browser.command("Page.navigate", { url: new URL("/admin/dashboard", base).href });
      await click(browser, button(editing ? "Edit Event" : "Create VCO Event"));
      await browser.wait(`!!document.querySelector('input[aria-label="Choose event thumbnail"]')`);
      assert.equal(await browser.evaluate(`document.querySelector('input[type="file"][aria-label="Choose event thumbnail"]').accept.includes('image/*')`), false);
      assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]').textContent.includes('JPEG, PNG, WebP or GIF')`), true);
      if (!editing) {
        await browser.evaluate(`(() => {
          for(const [id,value] of [['title','New official fixture'],['description','Synthetic event description']]){
            const input=document.getElementById(id);
            const proto=id==='description'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);
            input.dispatchEvent(new Event('input',{bubbles:true}));
          }
        })()`);
      }
      await select(selectedPhoto, "image/webp", "valid.webp");
      const selected = await browser.evaluate(preview);
      assert.equal(selected, `data:image/webp;base64,${selectedPhoto}`);
      assert.equal(await browser.evaluate(`document.querySelector('img[alt="Thumbnail preview"]').naturalWidth>0`), true);
      for (const [bytes, type, name, error] of [
        [Buffer.from("<svg/>").toString("base64"), "image/svg+xml", "vector.svg", "Choose a JPEG"],
        [Buffer.from("broken").toString("base64"), "image/png", "broken.png", "damaged"],
        [Buffer.alloc(1048577).toString("base64"), "image/png", "large.png", "1 MiB"],
      ]) {
        await select(bytes, type, name);
        await browser.wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes(${JSON.stringify(error)})`);
        assert.equal(await browser.evaluate(preview), selected, "rejected file preserves valid selection");
        assert.equal(writes.length, 0, "file-picker rejection does not submit");
      }
      // Same file can be selected again after a failed attempt, and clears the inline error.
      await select(selectedPhoto, "image/webp", "valid.webp");
      assert.equal(await browser.evaluate(`!!document.querySelector('[role="dialog"] [role="alert"]')`), false);
      await click(browser, button(editing ? "Update Event" : "Create Event"));
      await browser.wait(`document.body.innerText.includes('all frames combined).') && !!${button(editing ? "Update Event" : "Create Event")}`);
      await browser.wait(`document.body.innerText.includes('Event thumbnail: Image must not exceed')`);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].customThumbnail, selected);
      assert.equal(await browser.evaluate(preview), selected);
      assert.equal(event.customThumbnail, `data:image/webp;base64,${photo}`, "rejected save leaves stored value unchanged");
      reject = false;
      await click(browser, button(editing ? "Update Event" : "Create Event"));
      await browser.wait(editing ? `!document.querySelector('[role="dialog"]')` : `!!${button("Done")}`);
      assert.equal(writes.length, 2);
      assert.equal(writes[1].customThumbnail, selected);
      assert.equal(writes[1].method, editing ? "PUT" : "POST");
      assert.deepEqual(mockErrors, []);
      assert.deepEqual(browser.errors, []);
    } finally { await browser.close(); }
  });

for (const width of [1600, 390]) test(`event thumbnails, error recovery and refreshed selection work at ${width}px`,
  { timeout: 90000 }, async () => {
    const browser = await uiBrowser();
    const requests = [];
    const mockErrors = [];
    let version = 1, failFallback = false;
    const fixture = (id, title, customThumbnail, coverImage = null) => ({
      id, title, customThumbnail, coverImage, date: new Date(Date.now() - 86400000).toISOString(),
      description: "Synthetic event fixture", creatorId: null, isPremium: false,
    });
    const events = () => [
      fixture(95001, "Chosen photo empty gallery", `/api/events/95001/thumbnail?v=${version}`),
      fixture(95002, "Broken selection gallery recovery", "/api/events/95002/thumbnail"),
      fixture(95003, "Broken photo generic recovery", "/api/events/95003/thumbnail"),
      fixture(95004, "Chosen cover only", null, "/api/events/95004/thumbnail?field=coverImage"),
    ];
    browser.listeners.add(event => {
      if (event.method !== "Fetch.requestPaused") return;
      const { requestId, request } = event.params;
      const path = new URL(request.url).pathname;
      requests.push(path);
      let status = 200, contentType = "application/json", content = [];
      if (path === "/api/user") status = 401;
      if (path === "/api/events") content = events();
      if (path === "/api/events/95002/media") content = [{ id: 42, type: "image",
        thumbnail: "/api/media/fixture-gallery.webp", isPremium: false }];
      if (path.endsWith("/thumbnail") || path === "/api/media/fixture-gallery.webp" || path === fallback) {
        contentType = "image/webp"; content = photo;
        if (["/api/events/95002/thumbnail", "/api/events/95003/thumbnail"].includes(path) ||
          (path === fallback && failFallback)) status = 404;
      }
      void browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: contentType }],
        body: status === 404 ? "" : contentType === "image/webp" ? content :
          Buffer.from(JSON.stringify(content)).toString("base64") }).catch(e => mockErrors.push(String(e)));
    });
    const image = id => `document.querySelector('a[aria-label="Open ${events().find(e => e.id === id).title} gallery"] img')`;
    try {
      await browser.command("Network.enable");
      await browser.command("Fetch.enable", { patterns: [
        { urlPattern: `${base}/api/*` }, { urlPattern: `${base}/attached_assets/%2389_3.png` },
      ] });
      await browser.command("Emulation.setDeviceMetricsOverride", {
        width, height: 1080, deviceScaleFactor: 1, mobile: width < 500 });
      await browser.command("Page.navigate", { url: `${base}/` });
      await browser.wait(`document.body.textContent.includes("Chosen photo empty gallery")`);
      for (const [id, expected] of [[95001, "?v=1"], [95002, "/api/media/fixture-gallery.webp"],
        [95003, fallback], [95004, "field=coverImage"]]) {
        await browser.evaluate(`${image(id)}.scrollIntoView({block:'center'})`);
        await browser.wait(`!!${image(id)} && ${image(id)}.src.includes(${JSON.stringify(expected)}) && ${image(id)}.naturalWidth > 0`);
      }
      assert.ok(!requests.includes("/api/events/95001/media"), "no gallery request for a selected cover");
      assert.ok(!requests.includes("/api/events/95004/media"), "coverImage has the same lazy behavior");
      version = 2;
      // The same invalidation used by successful event edits; card remains mounted.
      await browser.evaluate(`(async () => {
        const { queryClient } = await import('/src/lib/queryClient.ts');
        await queryClient.invalidateQueries({queryKey:['/api/events']});
      })()`);
      await browser.evaluate(`${image(95001)}.scrollIntoView({block:'center'})`);
      await browser.wait(`!!${image(95001)} && ${image(95001)}.src.includes('?v=2') && ${image(95001)}.naturalWidth > 0`);
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
      // If even the standard image fails, remove the broken img and stop retrying.
      failFallback = true;
      await browser.command("Page.reload", { ignoreCache: true });
      await browser.wait(`document.body.textContent.includes("Broken photo generic recovery")`);
      await browser.evaluate(`document.querySelector('a[aria-label="Open Broken photo generic recovery gallery"]').scrollIntoView()`);
      await browser.wait(`!${image(95003)}`);
      const count = requests.filter(path => path === fallback).length;
      await delay(300);
      assert.equal(requests.filter(path => path === fallback).length, count);
      assert.deepEqual(mockErrors, []);
    } finally { await browser.close(); }
  });
