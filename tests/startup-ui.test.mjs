import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { serveStatic } from "../server/vite.ts";
import { searchData } from "../server/public-search-data.ts";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const preview = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const entryPatterns = ["*/src/main.tsx*", "*/assets/index-*.js"];
const cssPatterns = ["*/src/index.css*", "*/assets/index-*.css"];
const visible = selector => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  return !!el && getComputedStyle(el).visibility !== "hidden" &&
    getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
})()`;

// Use the real production HTML renderer and built bundle, without database
// mutations or publishing. Preview requests likewise use read-only UI fixtures.
async function production(run) {
  const original = searchData.events;
  searchData.events = async () => [];
  const app = express();
  app.get("/api/user", (_req, res) => res.status(401).json({}));
  app.get("/api/*", (_req, res) => res.json([]));
  serveStatic(app, path.resolve("dist/public"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally {
    searchData.events = original;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

async function browserAt(width) {
  const b = await uiBrowser();
  await b.command("Emulation.setDeviceMetricsOverride", {
    width, height: 844, deviceScaleFactor: 1, mobile: width < 600,
  });
  await b.command("Network.enable");
  await b.command("Network.setCacheDisabled", { cacheDisabled: true });
  return b;
}

async function intercept(b, patterns, handle) {
  b.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const request = message.params;
    const pathname = new URL(request.request.url).pathname;
    if (pathname.startsWith("/api/")) {
      void b.command("Fetch.fulfillRequest", {
        requestId: request.requestId, responseCode: pathname === "/api/user" ? 401 : 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(pathname === "/api/user" ? {} : [])).toString("base64"),
      });
    } else handle(request);
  });
  await b.command("Fetch.enable", { patterns: [...patterns, "*/api/*"].map(urlPattern => ({ urlPattern })) });
}

async function waitForHeld(held) {
  const deadline = Date.now() + 15000;
  while (!held.length && Date.now() < deadline) await delay(100);
  assert.ok(held.length, "the delayed resource must actually be intercepted");
}

async function assertShell(b) {
  await b.wait(visible("#app-startup"));
  assert.equal(await b.evaluate(visible("#root .public-html")), false);
  assert.equal(await b.evaluate(`getComputedStyle(document.body).backgroundColor`), "rgb(17, 21, 28)");
  assert.equal(await b.evaluate(`getComputedStyle(document.querySelector('#app-startup')).backgroundColor`), "rgb(17, 21, 28)");
  assert.ok(await b.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
  // Check actual painted pixels too, not merely styles on an unpainted DOM.
  let timer;
  const screenshot = b.command("Page.captureScreenshot", { format: "png" });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Startup shell did not paint while resources were held")), 5000);
  });
  const { data } = await Promise.race([screenshot, timeout]).finally(() => clearTimeout(timer));
  const image = await loadImage(Buffer.from(data, "base64"));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  assert.deepEqual([...context.getImageData(5, 5, 1, 1).data], [17, 21, 28, 255]);
}

test("preview: an error during the very first React render reveals the actual boundary", { timeout: 60000 }, async () => {
  const b = await browserAt(390);
  await intercept(b, ["*/src/pages/home-page.tsx*"], req => {
    void b.command("Fetch.fulfillRequest", {
      requestId: req.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "text/javascript" }],
      body: Buffer.from(`export default function Home() { throw new Error("Synthetic initial render failure"); }`).toString("base64"),
    });
  });
  try {
    await b.command("Page.navigate", { url: preview + "/" });
    await b.wait(`document.querySelector('#root h1')?.textContent === 'Something went wrong'`);
    assert.equal(await b.evaluate(visible("#root h1")), true);
    assert.equal(await b.evaluate("document.querySelector('#app-startup')"), null);
    assert.ok(await b.evaluate(`document.querySelector('#root button').textContent.includes('Reload')`));
  } finally { await b.close(); }
});

async function assertApp(b) {
  await b.wait(`!document.documentElement.hasAttribute('data-app-starting') && !document.querySelector('#root .public-html') && document.querySelector('#root main') !== null`);
  assert.equal(await b.evaluate(visible("#root main")), true);
  assert.equal(await b.evaluate("document.querySelector('#app-startup')"), null);
  assert.equal(await b.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--vco-app-styles').trim()`), "ready");
}

for (const mode of ["preview", "production"]) {
  const withBase = run => mode === "production" ? production(run) : run(preview);
  for (const width of [1280, 390]) {
    test(`${mode} ${width}: cold entry and hard reload never show public text; first commit reveals app`, { timeout: 90000 }, () => withBase(async base => {
      const b = await browserAt(width);
      const held = [];
      await intercept(b, entryPatterns, req => held.push(req.requestId));
      try {
        for (const route of ["/", "/archive-events"]) {
          await b.command("Page.navigate", { url: base + route });
          await waitForHeld(held);
          await b.wait("document.querySelector('#root .public-html h1') !== null");
          await assertShell(b);
          await delay(300);
          await assertShell(b);
          assert.ok(held.length, "entry request with cache-busting query must be held");
          await b.command("Fetch.continueRequest", { requestId: held.shift() });
          await assertApp(b);
          assert.deepEqual(b.errors, []);
        }
        await b.command("Page.reload", { ignoreCache: true });
        await waitForHeld(held);
        await b.wait("document.querySelector('#root .public-html h1') !== null");
        await assertShell(b);
        await b.command("Fetch.continueRequest", { requestId: held.shift() });
        await assertApp(b);
      } finally { await b.close(); }
    }));

    test(`${mode} ${width}: delayed app stylesheet cannot reveal unstyled React`, { timeout: 60000 }, () => withBase(async base => {
      const b = await browserAt(width);
      const held = [];
      await intercept(b, cssPatterns, req => held.push(req.requestId));
      try {
        await b.command("Page.navigate", { url: base + "/" });
        await waitForHeld(held);
        await b.wait("document.querySelector('#root .public-html h1') !== null");
        await assertShell(b);
        await delay(300);
        assert.ok(held.length, "app stylesheet must be intercepted");
        assert.notEqual(await b.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--vco-app-styles').trim()`), "ready");
        await assertShell(b);
        await b.command("Fetch.continueRequest", { requestId: held.shift() });
        await assertApp(b);
      } finally { await b.close(); }
    }));

    test(`${mode} ${width}: no-JS public HTML and links remain visible`, { timeout: 60000 }, () => withBase(async base => {
      const b = await browserAt(width);
      try {
        await b.command("Emulation.setScriptExecutionDisabled", { value: true });
        await b.command("Page.navigate", { url: base + "/" });
        await b.wait(visible(".public-html h1"));
        assert.equal(await b.evaluate(visible("#app-startup")), false);
        assert.ok(await b.evaluate(`document.querySelector('.public-html main').textContent.includes('not a reuse licence')`));
        const link = await b.evaluate(`document.querySelector('.public-html a[href="/archive-events"]').href`);
        await b.command("Page.navigate", { url: link });
        await b.wait(`document.querySelector('.public-html h1')?.textContent.includes('Event Archive')`);
        assert.equal(await b.evaluate(visible(".public-html main")), true);
        assert.equal(await b.evaluate(`document.querySelector('meta[name="vco-page-path"]').content`), "/archive-events");
        if (mode === "production") {
          await b.wait(`getComputedStyle(document.documentElement).getPropertyValue('--vco-app-styles').trim() === 'ready'`);
        }
      } finally { await b.close(); }
    }));
  }

  test(`${mode}: the first styled commit does not wait for APIs or images`, { timeout: 60000 }, () => withBase(async base => {
    const b = await browserAt(390);
    const held = [];
    b.listeners.add(message => {
      if (message.method !== "Fetch.requestPaused") return;
      const req = message.params;
      if (new URL(req.request.url).pathname.startsWith("/api/") || req.resourceType === "Image") {
        held.push(req.requestId);
      } else void b.command("Fetch.continueRequest", { requestId: req.requestId });
    });
    try {
      await b.command("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      await b.command("Page.navigate", { url: base + "/" });
      await assertApp(b);
      assert.ok(held.length, "data/media requests are still pending when the app becomes visible");
    } finally { await b.close(); }
  }));

  test(`${mode}: blocked module exposes English retry and reachable public fallback`, { timeout: 60000 }, () => withBase(async base => {
    const b = await browserAt(390);
    await intercept(b, entryPatterns, req => {
      void b.command("Fetch.failRequest", { requestId: req.requestId, errorReason: "Failed" });
    });
    try {
      await b.command("Page.navigate", { url: base + "/archive-events" });
      await b.wait(`document.querySelector('#app-startup[role="alert"]') !== null`);
      await assertShell(b);
      assert.equal(await b.evaluate(`document.querySelector('#startup-message').textContent`), "The application could not be loaded. Please try again.");
      assert.equal(await b.evaluate(visible("#startup-public")), true);
      await b.evaluate(`document.querySelector('#startup-public').click()`);
      assert.equal(await b.evaluate(visible(".public-html main")), true);
      assert.equal(await b.evaluate(visible("#app-startup")), false);
      await b.command("Fetch.disable");
      await b.command("Page.reload", { ignoreCache: true });
      await assertApp(b);
    } finally { await b.close(); }
  }));

  test(`${mode}: slow entry stays recoverable after 15 seconds, then renders without timer overwrite`, { timeout: 90000 }, () => withBase(async base => {
    const b = await browserAt(1280);
    const held = [];
    await intercept(b, entryPatterns, req => held.push(req.requestId));
    try {
      await b.command("Page.navigate", { url: base + "/" });
      await assertShell(b);
      await delay(15500);
      await b.wait(visible("#startup-actions"));
      assert.equal(await b.evaluate(`document.querySelector('#app-startup').getAttribute('role')`), "status");
      assert.match(await b.evaluate(`document.querySelector('#startup-message').textContent`), /keep waiting/);
      await b.evaluate(`document.querySelector('#startup-public').click()`);
      assert.equal(await b.evaluate(visible(".public-html h1")), true);
      await b.command("Fetch.continueRequest", { requestId: held.shift() });
      await assertApp(b);
      await b.evaluate(`window.dispatchEvent(new ErrorEvent('error', { message:'late error' }))`);
      assert.equal(await b.evaluate(visible("#root main")), true);
      assert.equal(await b.evaluate("document.querySelector('#app-startup')"), null);
    } finally { await b.close(); }
  }));

  test(`${mode}: failed stylesheet has retry; a committed React error boundary is not covered`, { timeout: 60000 }, () => withBase(async base => {
    const b = await browserAt(1280);
    await intercept(b, cssPatterns, req => {
      void b.command("Fetch.failRequest", { requestId: req.requestId, errorReason: "Failed" });
    });
    try {
      await b.command("Page.navigate", { url: base + "/" });
      await b.wait(`document.querySelector('#app-startup[role="alert"]') !== null`);
      assert.equal(await b.evaluate(visible("#startup-actions button")), true);
      await b.command("Fetch.disable");
      // Malformed read-only fixture deliberately exercises the real app boundary.
      await b.command("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
        const original = window.fetch.bind(window);
        window.fetch = (input, init) => input === '/api/events'
          ? Promise.resolve(new Response('{}', {headers:{'Content-Type':'application/json'}}))
          : original(input, init);
      })();` });
      await b.command("Page.reload", { ignoreCache: true });
      await b.wait(`document.querySelector('#root h1')?.textContent === 'Something went wrong'`);
      assert.equal(await b.evaluate(visible("#root h1")), true);
      assert.equal(await b.evaluate("document.querySelector('#app-startup')"), null);
      assert.ok(await b.evaluate(`document.querySelector('#root button').textContent.includes('Reload')`));
    } finally { await b.close(); }
  }));
}
