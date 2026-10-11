import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;

test("admin Nextcloud form shows the VCO example and supported public instances", { timeout: 60000 }, async () => {
  const browser = await uiBrowser();
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    const previewFailure = path === "/api/admin/nextcloud/preview";
    const data = previewFailure
      ? { error: "Access to the Nextcloud folder denied. Check the share password or account." }
      : path === "/api/user"
      ? { id: 880001, username: "Synthetic admin", isAdmin: true, isCreator: true }
      : path === "/api/admin/safety" ? { media: [], events: [] }
      : path === "/api/admin/media-usage" ? null : [];
    void browser.command("Fetch.fulfillRequest", {
      requestId, responseCode: previewFailure ? 400 : 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(data)).toString("base64"),
    });
  });
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    await browser.command("Page.navigate", { url: new URL("/admin/dashboard", base).href });
    await browser.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Create VCO Event'))");
    await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Create VCO Event')).click()");
    await browser.wait("!!document.querySelector('#image-source')");
    await browser.evaluate("document.querySelector('#image-source').focus()");
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await browser.wait("!!document.querySelector('[role=option]')");
    const option = await browser.evaluate(`(() => {
      const node = [...document.querySelectorAll('[role=option]')].find(n => n.textContent.includes('Import a Nextcloud folder'));
      node.scrollIntoView({block:'center'});
      const rect = node.getBoundingClientRect();
      return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    })()`);
    await browser.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...option });
    await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...option });
    await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...option });
    await browser.wait("!!document.querySelector('#nc-link-0')");
    const state = await browser.evaluate("({placeholder:document.querySelector('#nc-link-0').placeholder,text:document.querySelector('[role=dialog]').innerText})");
    assert.equal(state.placeholder, "https://nextcloud.vco-motorsports.com/index.php/s/TOKEN");
    for (const text of ["nextcloud.vco-motorsports.com", "nextcloud.bs-plus.de", "/s/TOKEN", "/index.php/s/TOKEN", "separately configured instance"]) {
      assert.ok(state.text.includes(text), text);
    }
    assert.ok(state.text.includes("Gallery media source"));
    await browser.evaluate(`(() => {
      const input = document.querySelector('#nc-link-0');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input,
        'https://nextcloud.vco-motorsports.com/s/SYNTHETIC_ONLY');
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await browser.evaluate("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.includes('Check access and media')).click()");
    await browser.wait("document.body.innerText.includes('Nextcloud access failed') && document.body.innerText.includes('Access to the Nextcloud folder denied. Check the share password or account.')");
    await browser.command("Fetch.disable");
    await browser.command("Page.navigate", { url: new URL("/privacy-policy", base).href });
    await browser.wait("!!document.querySelector('article') && document.querySelector('article').innerText.includes('nextcloud.vco-motorsports.com')");
    assert.match(await browser.evaluate("document.querySelector('article').innerText"), /nextcloud\.bs-plus\.de/);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
