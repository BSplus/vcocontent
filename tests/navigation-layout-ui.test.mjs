import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const events = Array.from({ length: 24 }, (_, i) => ({
  id: 65000 + i,
  title: `Navigation fixture ${i}`,
  date: i < 12 ? "2020-09-28T12:00:00Z" : new Date(Date.now() - 86400000).toISOString(),
  description: "A gallery for layout verification",
  creatorId: null,
  visibility: "published",
  safetyStatus: "legacy",
}));

test("desktop navigation keeps its alignment and resets new pages, not history or query changes", { timeout: 90000 }, async () => {
  const browser = await uiBrowser();
  const mockErrors = [];
  browser.listeners.add(event => {
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const path = new URL(request.url).pathname;
    const body = path === "/api/events" ? events : null;
    void browser.command("Fetch.fulfillRequest", {
      requestId, responseCode: path === "/api/user" ? 401 : 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body ?? [])).toString("base64"),
    }).catch(error => {
      if (!String(error).includes("Invalid InterceptionId")) mockErrors.push(String(error));
    });
  });
  const metrics = () => browser.evaluate(`(() => {
    const logo = document.querySelector('header a').getBoundingClientRect();
    return { x: logo.x, width: logo.width, y: scrollY, headerHeight: document.querySelector('header').getBoundingClientRect().height,
      bodyWidth: document.body.getBoundingClientRect().width, scrollHeight: document.documentElement.scrollHeight,
      headingY: document.querySelector('h1').getBoundingClientRect().y };
  })()`);
  const click = async path => {
    const selector = `nav[aria-label="Main navigation"] a[href="${path}"]`;
    await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await browser.wait(`location.pathname === ${JSON.stringify(path)} && !!document.querySelector('h1')`);
    await delay(150);
  };
  try {
    await browser.command("Network.enable");
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: `${base}/api/*` }] });
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1080, deviceScaleFactor: 1, mobile: false });
    await browser.command("Page.navigate", { url: `${base}/archive-events` });
    await browser.wait(`document.body.textContent.includes('Navigation fixture 0')`);
    await browser.evaluate("document.fonts.ready");
    const long = await metrics();
    assert.ok(long.scrollHeight > 1700);
    await browser.evaluate("scrollTo(0,650)");
    await click("/upcoming-events");
    await browser.wait(`document.body.textContent.includes('No events on the calendar')`);
    const short = await metrics();
    assert.ok(short.scrollHeight <= 1080, "fixture must exercise a page without a vertical scrollbar");
    assert.ok(Math.abs(long.x - short.x) < 0.5, "logo must not move when scrollbar disappears");
    assert.ok(Math.abs(long.bodyWidth - short.bodyWidth) < 0.5);
    assert.equal(short.y, 0);
    assert.equal(long.headerHeight, short.headerHeight);

    await browser.evaluate("history.back()");
    await browser.wait(`location.pathname === '/archive-events' && Math.abs(scrollY-650) < 2`);
    await browser.evaluate("history.forward()");
    await browser.wait(`location.pathname === '/upcoming-events' && scrollY === 0`);
    await click("/archive-events");
    await browser.evaluate("scrollTo(0,650)");
    await click("/current-events");
    assert.equal((await metrics()).y, 0, "new long pages must start at the top");
    assert.ok((await metrics()).headingY > 0, "new page title must be visible");

    await browser.evaluate(`scrollTo(0,450); history.replaceState(null,'',location.pathname+'?layout-test=1')`);
    await delay(100);
    assert.equal((await metrics()).y, 450, "query-only edits must not reset the page");
    await browser.evaluate(`(() => {
      const marker = document.createElement('div'); marker.id = 'scroll marker'; marker.style.height = '20px';
      document.querySelector('main').append(marker);
      history.pushState(null,'',location.pathname+'#scroll%20marker');
    })()`);
    await browser.wait("scrollY > 450");
    assert.ok(await browser.evaluate("document.getElementById('scroll marker').getBoundingClientRect().top >= 0"));
    assert.ok(await browser.evaluate("document.getElementById('scroll marker').getBoundingClientRect().top < innerHeight"));
    await click("/archive-events");
    assert.equal((await metrics()).y, 0);
    await browser.evaluate("scrollTo(0,400); history.pushState(null,'',location.pathname+'#invalid%zz')");
    await delay(100);
    assert.equal((await metrics()).y, 0, "invalid fragments must not throw or keep the previous page position");
    assert.deepEqual(mockErrors, []);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
