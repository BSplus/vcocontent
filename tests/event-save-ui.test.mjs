import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
async function click(browser, expression) {
  await browser.wait(`!!(${expression})`);
  await browser.evaluate(`(${expression}).click()`);
}
const input = async (browser, value) => browser.evaluate(`(()=>{
  const el=document.getElementById('title');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
  el.dispatchEvent(new Event('input',{bubbles:true}));
})()`);

for (const mode of ["unchanged", "saved", "rejected", "lost", "invalid", "list-failed"])
  test(`event edit ${mode}: confirmation, preserved inputs and independent reads`, { timeout: 60000 }, async () => {
    const browser = await uiBrowser(), requests = [], mockErrors = [];
    let writes = 0, readFails = false;
    let event = { id: 95601, title: "Event save fixture", description: "Isolated fixture",
      date: "2026-10-11T00:00:00.000Z", creatorId: null, customThumbnail: null,
      coverImage: "/attached_assets/%2389_3.png", isPremium: false, visibility: "draft" };
    browser.listeners.add(message => {
      if (message.method !== "Fetch.requestPaused") return;
      const { requestId, request } = message.params;
      const path = new URL(request.url).pathname;
      requests.push({ path, method: request.method });
      let content = [], status = 200, raw;
      if (path === "/api/user") content = { id: 99999, username: "synthetic-admin", isAdmin: true };
      if (path === "/api/admin/events" || path === "/api/events") {
        content = [event];
        if (mode === "list-failed" && writes) { status = 503; content = { error: "Synthetic list outage" }; }
      }
      if (path === "/api/events/95601") {
        content = event;
        if (request.method === "GET" && readFails) { status = 503; content = { error: "Synthetic read outage" }; }
      }
      if (path === "/api/events/95601/thumbnail-options") content = { page: 1, photos: [], hasMore: false };
      if (path === "/api/admin/events/95601/nextcloud/sources") content = { sources: [] };
      if (path === "/api/admin/safety") content = { media: [], events: [] };
      if (path === "/api/admin/media-usage") content = { total: { bytes: "0", count: "0", legacy: "0" },
        byEvent: [], byCreator: [], cleanupCount: "0", policy: { eventBytes: 1000000, creatorBytes: 1000000,
          eventCount: 100, creatorCount: 100 }, warningFraction: 0.8 };
      if (request.method === "PUT" && path === "/api/events/95601") {
        writes++;
        if (mode === "rejected") { status = 400; content = { error: "Synthetic validation rejection" }; }
        else {
          event = { ...event, ...JSON.parse(request.postData) };
          content = { id: event.id, saveStatus: "saved" };
          if (mode === "invalid") raw = "{broken JSON";
          if (mode === "lost") {
            void browser.command("Fetch.failRequest", { requestId, errorReason: "ConnectionClosed" })
              .catch(e => mockErrors.push(String(e)));
            return;
          }
        }
      }
      void browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(raw ?? JSON.stringify(content)).toString("base64") }).catch(e => mockErrors.push(String(e)));
    });
    try {
      await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
      await browser.command("Page.navigate", { url: new URL("/admin/dashboard", base).href });
      await click(browser, button("Edit Event"));
      await browser.wait(`document.getElementById('title')?.value==='Event save fixture'`);
      if (mode !== "unchanged") await input(browser, "Changed event fixture");
      // A background read must not reset unsaved inputs.
      await browser.evaluate(`(async()=>{
        const {queryClient}=await import('/src/lib/queryClient.ts');
        await queryClient.invalidateQueries({queryKey:['/api/events/95601']});
      })()`);
      assert.equal(await browser.evaluate("document.getElementById('title').value"),
        mode === "unchanged" ? "Event save fixture" : "Changed event fixture");
      await click(browser, button("Update Event"));
      if (["unchanged", "saved", "list-failed"].includes(mode)) {
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
        await browser.wait(`document.body.textContent.includes(${JSON.stringify(mode === "unchanged" ? "No changes" : "Event saved")})`);
        assert.equal(writes, mode === "unchanged" ? 0 : 1);
        if (mode === "list-failed") {
          await browser.wait(`document.body.textContent.includes('Try again')`);
          assert.equal(await browser.evaluate("document.body.textContent.includes('Changes rejected')||document.body.textContent.includes('Save status unknown')"), false);
        }
      } else {
        await browser.wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes(${JSON.stringify(mode === "rejected" ? "Changes rejected" : "Save status unknown")})`);
        assert.equal(await browser.evaluate("document.getElementById('title').value"), "Changed event fixture");
        assert.equal(writes, 1);
        assert.equal(await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] [role="alert"]')].filter(el=>el.textContent.includes(${JSON.stringify(mode === "rejected" ? "Changes rejected" : "Save status unknown")})).length`), 1);
        assert.equal(await browser.evaluate(`document.body.textContent.split('Synthetic validation rejection').length-1`), mode === "rejected" ? 1 : 0);
        if (mode !== "rejected") {
          assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Update Event').disabled`), true);
          readFails = true;
          await click(browser, button("Check saved event"));
          await browser.wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('could not be loaded')`);
          assert.equal(await browser.evaluate("document.getElementById('title').value"), "Changed event fixture");
          readFails = false;
          if (mode === "invalid") event.title = "Concurrent different value";
          await click(browser, button("Check saved event"));
          await browser.wait(`document.querySelector('[role="dialog"] [role="status"]')?.textContent.includes(${JSON.stringify(mode === "invalid" ? "Saved values differ for: title" : "matches your submitted changes")})`);
          assert.equal(await browser.evaluate("document.getElementById('title').value"), "Changed event fixture");
          assert.equal(writes, 1, "checking never repeats mutation");
          if (mode === "lost") {
            await click(browser, button("Update Event"));
            await browser.wait(`!document.querySelector('[role="dialog"]')`);
            assert.equal(writes, 1, "matching recovered values make the next save a no-op");
          }
        }
      }
      // Independent GET verifies stored fixture instead of trusting the write response.
      const saved = await browser.evaluate(`(async()=>await (await fetch('/api/events/95601')).json())()`);
      assert.equal(saved.title, ["unchanged", "rejected"].includes(mode) ? "Event save fixture" :
        mode === "invalid" ? "Concurrent different value" : "Changed event fixture");
      await delay(100);
      assert.deepEqual(mockErrors, []); assert.deepEqual(browser.errors, []);
      assert.equal(requests.filter(r => r.method === "PUT").length, writes);
    } finally { await browser.close(); }
  });
