import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;

test("homepage FAQ is visible and media credit copies only available details plus canonical source", async () => {
  const browser = await uiBrowser();
  try {
    await browser.command("Page.navigate", { url: base });
    await browser.wait(`document.querySelector('#archive-faq-heading')?.textContent === 'Archive FAQ'`);
    const faq = await browser.evaluate(`document.querySelector('[aria-labelledby="archive-faq-heading"]')?.innerText`);
    assert.match(faq, /Public event galleries and creator galleries/);
    assert.match(faq, /Original downloads require you to register or sign in/);
    assert.match(faq, /Download availability is not a reuse licence/);

    await browser.command("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : input.url;
          if (url === "/api/media/424") return Promise.resolve(new Response(JSON.stringify({
            id: 424, eventId: 12, type: "image", caption: "Turn one at dusk",
            photographer: "R. Vale", thumbnail: "/missing-test-image.jpg", url: "/original.jpg",
            isPremium: false, tags: [], downloadCount: 0
          }), { status: 200, headers: { "Content-Type": "application/json" } }));
          return originalFetch(input, init);
        };
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
          writeText: async (value) => { window.__copiedMediaCredit = value; }
        }});
      })();`,
    });
    await browser.command("Page.navigate", { url: `${base}/media/424?tracking=ignore#fragment` });
    await browser.wait(`[...document.querySelectorAll('button')].some(button => button.textContent.toLowerCase().includes('copy credit'))`);
    await browser.evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.toLowerCase().includes('copy credit'))?.click()`);
    await browser.wait(`window.__copiedMediaCredit !== undefined`);
    const copied = await browser.evaluate(`window.__copiedMediaCredit`);
    assert.equal(copied, `Photographer: R. Vale\nTurn one at dusk\nSource: ${new URL(base).origin}/media/424`);
    assert.ok(!copied.includes("tracking") && !copied.includes("#fragment"));
    await delay(100);
    assert.deepEqual(browser.errors, []);
  } finally {
    await browser.close();
  }
});

test("mobile credit copying omits unknown names, reports permission errors and preserves guest downloads", { timeout: 60000 }, async () => {
  const browser = await uiBrowser();
  try {
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.command("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (input === "/api/media/424") return Promise.resolve(new Response(JSON.stringify({
          id:424,eventId:12,type:"image",caption:null,photographer:null,
          thumbnail:"/missing-test.jpg",url:"/original.jpg",isPremium:false
        }), { status:200,headers:{"Content-Type":"application/json"} }));
        if (input === "/api/user") return Promise.resolve(new Response("{}",{status:401}));
        return original(input,init);
      };
      Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{
        if (window.__denyCopy) throw new Error("Permission denied");
        window.__creditText=text;
      }}});
    })();` });
    await browser.command("Page.navigate", { url: `${base}/media/424?utm_source=mobile` });
    await browser.wait(`Array.from(document.querySelectorAll('button')).some(el=>el.textContent.includes('Copy credit'))`);
    const copy = `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.includes('Copy credit')).click()`;
    await browser.evaluate(copy);
    await browser.wait("window.__creditText !== undefined");
    assert.equal(await browser.evaluate("window.__creditText"), `Source: ${new URL(base).origin}/media/424`);
    assert.ok(await browser.evaluate(`Array.from(document.querySelectorAll('a')).some(el=>el.textContent.includes('Register or sign in'))`));
    assert.ok(await browser.evaluate(`Array.from(document.querySelectorAll('button')).some(el=>el.textContent.includes('Low'))`));
    assert.ok(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"));
    await browser.evaluate("window.__denyCopy=true");
    await browser.evaluate(copy);
    await browser.wait("document.body.textContent.includes('Could not copy credit and source')");
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});

test("public homepage remains readable with JavaScript disabled and preview indexing stays disabled", { timeout: 60000 }, async () => {
  const browser = await uiBrowser();
  try {
    await browser.command("Emulation.setScriptExecutionDisabled", { value: true });
    await browser.command("Page.navigate", { url: base });
    // CDP evaluation works despite disabling page-script execution.
    await browser.wait(`document.querySelector('.public-html h1')?.textContent.includes('Every race')`);
    assert.ok(await browser.evaluate(`document.querySelector('.public-html nav a[href="/archive-events"]') !== null`));
    assert.ok(await browser.evaluate(`document.querySelector('.public-html main').textContent.includes('not a reuse licence')`));
    assert.equal(await browser.evaluate(`document.querySelector('meta[name="robots"]').content`), "noindex,follow");
    assert.equal(await browser.evaluate(`document.querySelector('link[rel="canonical"]')`), null);
  } finally { await browser.close(); }
});
