import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const poster = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="navy"/></svg>');
const items = Array.from({ length: 60 }, (_, i) => ({
  id: 70000 + i, eventId: 70000, type: i === 59 ? "video" : "image",
  caption: i >= 58 ? "MAHLE RACING TEAM" : `Unrelated fixture ${i}`,
  photographer: "Fixture photographer", tags: ["fixture"], identification: [],
  url: poster, thumbnail: poster, downloadCount: 0,
}));

test("typing searches beyond 48 items; URL, filters, paging, cancellation and errors stay consistent", { timeout: 120000 }, async () => {
  const browser = await uiBrowser();
  const requests = [], failures = [];
  const tasks = new Set();
  browser.listeners.add(event => {
    if (event.method !== "Fetch.requestPaused") return;
    const task = (async () => {
      const { requestId, request } = event.params;
      const url = new URL(request.url);
      let responseCode = 200, body = [];
      if (url.pathname === "/api/user") { responseCode = 401; body = { message: "Not signed in" }; }
      else if (url.pathname === "/api/media") {
        const q = url.searchParams.get("q") || "";
        const fields = url.searchParams.has("fields") ? url.searchParams.get("fields").split(",") : ["caption", "photographer", "tags", "identification"];
        const type = url.searchParams.get("type") || "all";
        const page = Number(url.searchParams.get("page") || 1);
        requests.push({ q, fields, type, page });
        const terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
        body = items.filter(item => (type === "all" || type === item.type)
          && terms.every(term => fields.some(field => String(item[field]).toLowerCase().includes(term))))
          .slice((page - 1) * 48, page * 48);
        if (q === "slow") { await delay(1100); body = [{ ...items[0], caption: "Obsolete slow response" }]; }
        if (q === "fresh") body = [{ ...items[0], caption: "Fresh response" }];
        if (q === "error") { responseCode = 500; body = { error: "Fixture API failure" }; }
        if (q === "loading") await delay(800);
      }
      await browser.command("Fetch.fulfillRequest", {
        requestId, responseCode,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64"),
      });
    })().catch(error => {
      if (!/Invalid InterceptionId|closed|session/i.test(String(error))) failures.push(String(error));
    });
    tasks.add(task); task.finally(() => tasks.delete(task));
  });
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    const ready = count => `document.querySelector('section[aria-label="Search results"]')?.getAttribute('aria-busy') === 'false' && document.querySelectorAll('article').length === ${count}`;
    const visit = async (path, count) => {
      await browser.command("Page.navigate", { url: new URL(path, base).href });
      await browser.wait(ready(count));
    };
    const type = async value => {
      await browser.evaluate(`(() => {
        const input=document.querySelector('#media-search');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
        input.dispatchEvent(new Event('input',{bubbles:true})); input.focus();
      })()`);
    };
    const submit = async () => browser.command("Input.dispatchKeyEvent", {
      type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r",
    });
    const settled = async (q, count) => browser.wait(`new URLSearchParams(location.search).get('q') === ${JSON.stringify(q)} && ${ready(count)}`);
    const clickButton = async text => browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
    const openFilters = async () => {
      await browser.evaluate(`document.querySelector('[aria-label="Open search filters"]').click()`);
      await browser.wait(`!!document.querySelector('[role="dialog"]')`);
    };
    const closeFilters = async () => {
      await delay(100);
      await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
    };

    await visit("/search?fields=caption", 48);
    assert.equal(await browser.evaluate(`!![...document.querySelectorAll('article')].find(a=>a.textContent.includes('MAHLE'))`), false);
    const historyLength = await browser.evaluate("history.length");
    await type("MAHLE"); // No Enter or button: the two caption-only items are beyond the initial page.
    await settled("MAHLE", 2);
    assert.equal(await browser.evaluate("history.length"), historyLength, "debounce replaces, not pushes history");
    assert.match(await browser.evaluate(`document.querySelector('section[aria-label="Search results"] [role="status"]').textContent`), /2 media items on page 1/);
    await type("mahle racing"); await settled("mahle racing", 2);
    await type("TEAM MAHLE"); await submit(); await settled("TEAM MAHLE", 2);
    const interactiveIds = await browser.evaluate(`[...document.querySelectorAll('article a[href^="/media/"]')].map(a=>a.getAttribute('href'))`);
    await visit("/search?q=TEAM+MAHLE&fields=caption", 2);
    assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('article a[href^="/media/"]')].map(a=>a.getAttribute('href'))`), interactiveIds);

    await openFilters();
    await browser.evaluate(`document.querySelector('#caption').click()`);
    await browser.wait(`new URLSearchParams(location.search).get('fields') === '' && ${ready(0)}`);
    await browser.evaluate(`document.querySelector('#caption').click(); document.querySelector('#video').click()`);
    await browser.wait(`new URLSearchParams(location.search).get('type') === 'video' && ${ready(1)}`);
    await closeFilters();
    assert.match(await browser.evaluate(`document.querySelector('article button').getAttribute('aria-label')`), /video/i);
    await openFilters();
    await browser.evaluate(`document.querySelector('#all').click()`);
    await browser.wait(ready(2)); await closeFilters();

    await type("fixture"); await clickButton("Search media"); await settled("fixture", 48);
    await clickButton("Next"); await browser.wait(`new URLSearchParams(location.search).get('page') === '2' && ${ready(10)}`);
    await type("MAHLE"); await settled("MAHLE", 2);
    assert.equal(await browser.evaluate(`new URLSearchParams(location.search).has('page')`), false);
    await type("loading");
    await browser.wait(`!!document.querySelector('section[aria-label="Search results"] [role="status"]') && document.querySelector('section[aria-label="Search results"] [role="status"]').textContent.includes('Searching')`);
    assert.equal(await browser.evaluate(`document.querySelectorAll('article').length`), 0, "no obsolete cards during search");
    assert.equal(await browser.evaluate(`document.querySelector('#media-search').disabled`), false);
    await settled("loading", 0);
    await type("slow");
    await browser.wait(`new URLSearchParams(location.search).get('q') === 'slow'`);
    await type("fresh"); await settled("fresh", 1);
    await delay(1300);
    assert.match(await browser.evaluate("document.querySelector('article').textContent"), /Fresh response/);
    assert.doesNotMatch(await browser.evaluate("document.body.innerText"), /Obsolete slow response/);
    await type("error"); await browser.wait(`!!document.querySelector('section[aria-label="Search results"] [role="alert"]')`);
    assert.doesNotMatch(await browser.evaluate(`document.querySelector('section[aria-label="Search results"]').textContent`), /No matching|0 media items/);
    await clickButton("Try again");
    await browser.wait(`!!document.querySelector('section[aria-label="Search results"] [role="alert"]')`);
    assert.ok(requests.filter(r => r.q === "error").length >= 2);
    await type("unfindable"); await settled("unfindable", 0);
    assert.match(await browser.evaluate("document.body.innerText"), /No matching media/);

    await visit("/search?q=fixture&fields=caption", 48);
    await clickButton("Next"); await browser.wait(ready(10));
    await browser.evaluate("history.back()"); await browser.wait(ready(48));
    await browser.evaluate("history.forward()"); await browser.wait(ready(10));
    assert.equal(await browser.evaluate(`document.querySelector('#media-search').value`), "fixture");
    assert.equal(await browser.evaluate(`new URLSearchParams(location.search).get('page')`), "2");
    assert.deepEqual(failures, []);
    assert.deepEqual(browser.errors, []);
  } finally {
    await Promise.allSettled([...tasks]);
    await browser.close();
  }
});
