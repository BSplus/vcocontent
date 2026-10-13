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

test("edit dialog reloads two saved sources, preserves passwords and separates save from non-destructive updates", { timeout: 60000 }, async () => {
  const browser = await uiBrowser();
  const event = { id: 880026, title: "Synthetic saved-source gallery", description: "Synthetic only",
    date: "2026-10-11T00:00:00Z", creatorId: null, seriesId: null, isPremium: false, coverImage: "" };
  let saved = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", link: "https://nextcloud.vco-motorsports.com/s/SYNTHETIC_ONE", hasPassword: true },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", link: "https://nextcloud.vco-motorsports.com/s/SYNTHETIC_TWO", hasPassword: false },
  ];
  let saves = 0, updates = 0, lastEdits;
  let run = { found: 0, existing: 0, imported: 0, skipped: 1, failed: 0 };
  const progress = () => ({ status: "completed", run, total: 4, imported: 4, importedImages: 4,
    importedVideos: 0, failed: 0, skipped: 1, warnings: 0, analysisPending: 0, analysisCompleted: 4, files: [] });
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    let data = [], code = 200;
    if (path === "/api/user") data = { id: 880001, username: "Synthetic admin", isAdmin: true, isCreator: true };
    else if (path === "/api/admin/events" || path === "/api/events") data = [event];
    else if (path === `/api/events/${event.id}`) data = event;
    else if (path === "/api/admin/safety") data = { media: [], events: [] };
    else if (path === "/api/admin/media-usage") data = null;
    else if (path.endsWith("/nextcloud/sources")) {
      if (request.method === "POST") {
        saves++;
        lastEdits = JSON.parse(request.postData).sources;
        saved = lastEdits.map(edit => ({ id: edit.id, link: edit.link, photographer: (edit.photographer || "").trim(),
          hasPassword: edit.removePassword ? false : !!edit.password || saved.find(s => s.id === edit.id)?.hasPassword || false }));
      }
      data = { sources: saved };
    } else if (path.endsWith("/nextcloud/update")) { updates++; data = progress(); code = 202; }
    else if (path.endsWith("/nextcloud")) data = progress();
    else if (path.endsWith("/nextcloud/preview")) data = { count: 0, images: 0, videos: 0, skipped: 1 };
    void browser.command("Fetch.fulfillRequest", { requestId, responseCode: code,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(data)).toString("base64") });
  });
  const click = text => browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
  const open = async () => {
    await browser.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Edit Event')");
    await click("Edit Event");
    await browser.wait("!!document.querySelector('#nc-link-1')");
  };
  const setInput = (selector, value) => browser.evaluate(`(() => {
    const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    await browser.command("Page.navigate", { url: new URL("/admin/dashboard", base).href });
    await open();
    assert.equal(await browser.evaluate("document.querySelector('#nc-link-0').value"), saved[0].link);
    assert.equal(await browser.evaluate("document.querySelector('#nc-credit-0').value"), "");
    assert.match(await browser.evaluate("document.querySelector('#nc-credit-help-0').textContent"), /only to newly imported files/);
    assert.equal(await browser.evaluate("document.querySelector('input[type=password]').value"), "");
    assert.match(await browser.evaluate("document.querySelector('input[type=password]').placeholder"), /Saved password kept/);
    assert.match(await browser.evaluate("document.querySelector('[role=dialog]').innerText"), /never deletes gallery media, tags or captions/);
    assert.match(await browser.evaluate("document.querySelector('[role=dialog]').innerText"), /No supported media found/);
    await click("Cancel"); await browser.wait("!document.querySelector('[role=dialog]')");
    await open();
    assert.equal(await browser.evaluate("document.querySelector('#nc-link-1').value"), saved[1].link);
    await setInput("#nc-credit-0", "Zoë 李");
    await setInput("#nc-credit-1", "José & Studio");
    await setInput("#nc-link-1", saved[1].link + "?path=%2FSubfolder");
    assert.equal(await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Update gallery').disabled"), true);
    await click("Save sources");
    await browser.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Update gallery'&&!b.disabled)");
    assert.equal(saves, 1); assert.equal(updates, 0);
    assert.equal(lastEdits[0].password, undefined);
    assert.equal(lastEdits[0].removePassword, undefined);
    assert.equal(lastEdits[0].photographer, "Zoë 李");
    assert.equal(lastEdits[1].photographer, "José & Studio");
    await browser.command("Page.reload");
    await open();
    assert.equal(await browser.evaluate("document.querySelector('#nc-link-1').value"), saved[1].link);
    assert.equal(await browser.evaluate("document.querySelector('#nc-credit-0').value"), "Zoë 李");
    assert.equal(await browser.evaluate("document.querySelector('#nc-credit-1').value"), "José & Studio");
    run = { found: 4, existing: 4, imported: 0, skipped: 0, failed: 0 };
    await click("Update gallery");
    await browser.wait("document.querySelector('[role=dialog]').innerText.includes('All supported media already present')");
    assert.equal(updates, 1);
    await click("Remove saved password"); await click("Save sources");
    await browser.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Update gallery'&&!b.disabled)");
    assert.equal(lastEdits[0].removePassword, true);
    assert.equal(saved[0].hasPassword, false);
    // Removing every source is supported and leaves historical media totals intact.
    await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Remove link').click()");
    await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Remove link').click()");
    await click("Save sources");
    await browser.wait("document.querySelector('[role=dialog]').innerText.includes('No saved sources')");
    assert.equal(saved.length, 0);
    assert.match(await browser.evaluate("document.querySelector('[role=dialog]').innerText"), /Historical links cannot be recovered/);
    assert.match(await browser.evaluate("document.querySelector('[role=dialog]').innerText"), /Historical totals: 4\/4/);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
