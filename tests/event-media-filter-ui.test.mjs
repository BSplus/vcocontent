import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";
import { pageMetadata } from "../shared/pagination.ts";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const date = "2026-10-01T12:00:00Z";
const poster = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="navy"/></svg>');
const user = { id: 97500, username: "Filter fixture", isCreator: true, creatorStatus: "approved", emailVerifiedAt: date };
const official = { id: 97501, title: "Official filter fixture", creatorId: null, description: "A mixed event gallery for photos and videos.", date, isPremium: false };
const creator = { ...official, id: 97502, creatorId: user.id, title: "Creator filter fixture" };
const source = Array.from({ length: 101 }, (_, i) => ({
  id: i + 1, eventId: official.id, type: i < 50 ? "image" : "video",
  caption: `${i < 50 ? "Photo" : "Video"} ${i + 1}`, thumbnail: poster, url: poster, tags: [],
})).reverse();

test("shared event gallery type, URL/history, loading/error, community, preview and responsive controls", { timeout: 180000 }, async () => {
  const browser = await uiBrowser();
  let signedIn = false, fail = false, pause = 0, emptyVideos = false;
  let community = { count: 2, liked: false, saved: false };
  const requests = [], writes = [], mockErrors = [];
  browser.listeners.add(event => {
    if (event.method !== "Fetch.requestPaused") return;
    void (async () => {
      const { requestId, request } = event.params, url = new URL(request.url), path = url.pathname;
      let body = [], status = 200;
      if (path === "/api/user") body = signedIn ? user : null;
      else if (path === `/api/users/${user.id}`) body = { ...user, displayName: "Fixture Creator" };
      else if (path === `/api/events/${official.id}`) body = official;
      else if (path === `/api/events/${creator.id}`) body = creator;
      else if (path.endsWith("/community-galleries")) body = [{
        id: creator.id, creatorId: user.id, creatorName: user.username, title: "Linked community gallery",
        date, photoCount: 50, thumbnail: poster,
      }];
      else if (/\/api\/community\/(event|media)\/\d+/.test(path)) {
        if (request.method !== "GET") {
          writes.push(path);
          if (path.endsWith("/like")) community = { ...community, liked: request.method === "PUT", count: request.method === "PUT" ? 3 : 2 };
          if (path.endsWith("/favorite")) community = { ...community, saved: request.method === "PUT" };
        }
        body = community;
      } else if (/\/api\/events\/\d+\/media$/.test(path)) {
        const type = url.searchParams.get("type") || "all";
        const page = Number(url.searchParams.get("page") || 1);
        const selected = source.filter(item => (type === "all" || item.type === type) && !(emptyVideos && item.type === "video"));
        const meta = pageMetadata(selected.length, page, 48);
        body = { ...meta, items: selected.slice((meta.page - 1) * 48, meta.page * 48) };
        requests.push({ path, type, page });
        // Capture response at request time to test obsolete requests cannot replace a new filter.
        const shouldFail = fail;
        if (pause) await delay(pause);
        if (shouldFail) { status = 503; body = { error: "Synthetic gallery failure" }; }
      }
      await browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
    })().catch(error => { if (!/Invalid InterceptionId|closed|session/i.test(String(error))) mockErrors.push(String(error)); });
  });
  const filter = `document.querySelector('[aria-label="Filter gallery media"]')`;
  const media = `document.querySelector('section[aria-label="Event media"]')`;
  const actions = `document.querySelector('header [aria-label="Community actions"]')`;
  const click = async (text, root = "document") => {
    const expression = `[...${root}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`;
    await browser.wait(`!!(${expression})`);
    await browser.evaluate(`(${expression}).click()`);
  };
  const settled = async (type, count, page = 1, pages = 3) => {
    await browser.wait(`${media}?.getAttribute('aria-busy')==='false' && ${media}.querySelectorAll('article').length===${count} &&
      ${filter}?.querySelector('button[aria-pressed="true"]')?.textContent.trim()===${JSON.stringify(type)}`);
    if (count) await browser.wait(`document.querySelector('main h2').textContent.includes('PAGE ${page} OF ${pages}')`);
  };
  const visit = async path => browser.command("Page.navigate", { url: new URL(path, base).href });
  const screenshot = async name => {
    if (!process.env.GALLERY_FILTER_SCREENSHOTS) return;
    await mkdir("generated-artifacts/gallery-filter", { recursive: true });
    const result = await browser.command("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile(`generated-artifacts/gallery-filter/${name}.jpg`, Buffer.from(result.data, "base64"));
  };
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    for (const width of [1280, 390, 320]) {
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      for (const album of [official, creator]) {
        await visit(`/events/${album.id}?extra=keep&page=3#gallery-context`);
        await settled("All", 5, 3, 3);
        assert.equal(await browser.evaluate(`${filter}.closest('[aria-label="Community actions"]')!==null`), true);
        // Query-only filter changes preserve reading position and unrelated query/hash information.
        await browser.evaluate("window.scrollTo(0,100)");
        const scrollBefore = await browser.evaluate("scrollY");
        const offset = requests.length;
        await click("Photos", filter);
        await settled("Photos", 48, 1, 2);
        assert.deepEqual(requests.slice(offset).map(({type,page}) => ({type,page})), [{ type: "image", page: 1 }], "no intermediate request for old page");
        assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('extra')"), "keep");
        assert.equal(await browser.evaluate("new URLSearchParams(location.search).has('page')"), false);
        assert.equal(await browser.evaluate("location.hash"), "#gallery-context");
        assert.equal(await browser.evaluate("scrollY"), scrollBefore);
        assert.equal(await browser.evaluate(`${media}.querySelectorAll('button[aria-label^="Preview photo:"]').length`), 48);
        assert.equal(await browser.evaluate(`${media}.querySelectorAll('button[aria-label^="Preview video:"]').length`), 0);
        await click("Next", media);
        await settled("Photos", 2, 2, 2);
        await browser.evaluate("history.back()");
        await settled("Photos", 48, 1, 2);
        await browser.evaluate("history.back()");
        await settled("All", 5, 3, 3);
        await browser.evaluate("history.forward()");
        await settled("Photos", 48, 1, 2);
        await browser.command("Page.reload");
        await settled("Photos", 48, 1, 2);
        // Keyboard activation and preview arrows must stay within the filtered list.
        await browser.evaluate(`${filter}.querySelectorAll('button')[2].focus()`);
        await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
        await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        await settled("Videos", 48, 1, 2);
        await browser.evaluate(`${media}.querySelector('button[aria-label^="Preview video:"]').click()`);
        await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Video 101')`);
        await browser.evaluate(`document.querySelector('button[aria-label="Next media item"]').click()`);
        await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Video 100')`);
        await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
        assert.equal(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), true, `${width} ${album.title} overflow`);
        assert.equal(await browser.evaluate(`${filter}.querySelectorAll('button').length`), 3);
        assert.equal(await browser.evaluate(`[...${filter}.querySelectorAll('button')].every(b=>b.getBoundingClientRect().height>=44 && b.getBoundingClientRect().right<=innerWidth)`), true);
        if (album === official) {
          assert.equal(await browser.evaluate(`document.querySelector('#community-galleries-heading').parentElement.parentElement.parentElement.textContent.includes('Linked community gallery')`), true);
        } else assert.equal(await browser.evaluate(`!!document.querySelector('#community-galleries-heading')`), false);
        await browser.evaluate("window.scrollTo(0,0)");
        await screenshot(`${album === official ? "official" : "creator"}-${width}`);
      }
    }
    signedIn = true;
    await visit(`/events/${official.id}?type=image`);
    await settled("Photos", 48, 1, 2);
    pause = 1400;
    await click("Videos", filter);
    await browser.wait(`${media}.getAttribute('aria-busy')==='true'`);
    assert.equal(await browser.evaluate(`!!document.querySelector('header h1') && ${media}.textContent.includes('Loading media')`), true);
    await browser.wait(`!!${actions}.querySelector('button[aria-label^="Like"]:not(:disabled)')`);
    await browser.evaluate(`${actions}.querySelector('button[aria-label^="Like"]').click()`);
    await browser.wait(`!!${actions}.querySelector('button[aria-label^="Unlike"]:not(:disabled)')`);
    await browser.evaluate(`${actions}.querySelector('button[aria-label^="Save to"]').click()`);
    await browser.wait(`!!${actions}.querySelector('button[aria-label^="Remove from"]:not(:disabled)')`);
    assert.equal(community.liked, true);
    assert.equal(community.saved, true);
    const requestCount = requests.length;
    await click("All", filter);
    await settled("All", 48, 1, 3);
    await delay(1600);
    assert.equal(await browser.evaluate(`${filter}.querySelector('[aria-pressed="true"]').textContent.trim()`), "All", "late videos cannot replace All");
    assert.equal(requests.length, requestCount + 1);
    // Share remains independent from media loading and community mutations.
    await browser.evaluate(`${actions}.querySelector('button[aria-label="Share"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse',ctrlKey:false}))`);
    await browser.wait(`!!document.querySelector('[role="menu"]')`);
    assert.match(await browser.evaluate(`document.querySelector('[role="menu"]').textContent`), /Copy Link/);
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await browser.wait(`!document.querySelector('[role="menu"]')`);
    pause = 0; fail = true;
    await click("Photos", filter);
    // Photos were cached: invalidate to exercise a failing refresh too.
    await browser.evaluate(`import('/src/lib/queryClient.ts').then(m=>m.queryClient.invalidateQueries({predicate:q=>String(q.queryKey[0]).includes('/events/${official.id}/media')}))`);
    await browser.wait(`${media}.textContent.includes('Could not load event media')`);
    assert.equal(await browser.evaluate(`${media}.textContent.includes('No photos') || ${media}.querySelectorAll('article').length>0`), false);
    fail = false;
    await click("Try again", media);
    await settled("Photos", 48, 1, 2);
    emptyVideos = true;
    await click("Videos", filter);
    await browser.wait(`${media}.textContent.includes('No videos available')`);
    await click("Show all media", media);
    await settled("All", 48, 1, 2);
    // Signed-out auth return path keeps the chosen media type.
    signedIn = false;
    await visit(`/events/${creator.id}?type=video`);
    await browser.wait(`${media}?.textContent.includes('No videos available')`);
    await click("Sign in to join in", actions);
    await browser.wait(`location.pathname==='/auth'`);
    assert.equal(await browser.evaluate(`new URLSearchParams(location.search).get('next')`), `/events/${creator.id}?type=video`);
    assert.equal(writes.length, 2);
    assert.deepEqual(mockErrors, []);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
