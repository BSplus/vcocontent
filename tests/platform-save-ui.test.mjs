import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";
import { pageMetadata } from "../shared/pagination.ts";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const platform = `document.getElementById('platform')`;
const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
async function click(browser, expression) {
  await browser.wait(`!!(${expression})`);
  await browser.evaluate(`(${expression}).click()`);
}
async function input(browser, value, id = "platform") {
  await browser.evaluate(`(()=>{
    const el=document.getElementById(${JSON.stringify(id)});
    Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
}
async function fixture(role = "admin") {
  const browser = await uiBrowser();
  let event = { id: 95601, title: "Platform fixture", description: "Isolated fixture",
    date: "2026-10-11T00:00:00.000Z", creatorId: role === "admin" ? null : 95600,
    platform: null, photoMatchingEnabled: false, contentVersion: 0, referenceRevision: 0,
    photoMatchingRevision: 0, isPremium: false, visibility: "draft" };
  const state = { mode: "saved", writes: [], patches: [], creates: [], errors: [], holdGet: false, held: [] };
  const settings = () => ({ id: event.id, enabled: event.photoMatchingEnabled, platform: event.platform,
    contentVersion: event.contentVersion, referenceRevision: event.referenceRevision,
    photoMatchingRevision: event.photoMatchingRevision });
  const fulfill = (requestId, body, status = 200, raw) => browser.command("Fetch.fulfillRequest", {
    requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    body: Buffer.from(raw ?? JSON.stringify(body)).toString("base64"),
  }).catch(e => { if (!/Invalid InterceptionId|closed|session/i.test(String(e))) state.errors.push(String(e)); });
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params, path = new URL(request.url).pathname;
    let body = [], status = 200, raw;
    if (path === "/api/user") body = { id: 95600, username: "platform-fixture", isAdmin: role === "admin",
      isCreator: role === "owner", creatorStatus: role === "owner" ? "approved" : "none", emailVerifiedAt: event.date };
    else if (["/api/events", "/api/admin/events", "/api/creator/events"].includes(path)) {
      if (request.method === "POST") {
        const payload = JSON.parse(request.postData); state.creates.push({ path, payload });
        if (state.mode === "rejected") { status = 400; body = { error: "Synthetic rejection" }; }
        else {
          event = { ...event, ...payload, id: 95603, platform: payload.platform?.trim() || null };
          body = event; status = 201;
          if (state.mode === "lost") { void browser.command("Fetch.failRequest", { requestId, errorReason: "ConnectionClosed" }); return; }
        }
      } else body = [event];
    } else if (path === "/api/creator/usage") body = { bytes: 0, galleries: 1, photos: 0, unknown: 0, pendingCleanup: 0,
      limits: { bytes: 500000000, galleries: 5, photos: 1000, imageBytes: 5000000 }, eventStats: [] };
    else if (/^\/api\/events\/\d+$/.test(path)) {
      body = event;
      if (request.method === "PUT") {
        const payload = JSON.parse(request.postData); state.writes.push(payload);
        if (state.mode === "rejected") { status = 400; body = { error: "Synthetic rejection" }; }
        else {
          event = { ...event, ...payload, contentVersion: event.contentVersion + 1 };
          body = { ...event, saveStatus: "saved" };
          if (state.mode === "invalid") raw = "{broken";
          if (state.mode === "lost") { void browser.command("Fetch.failRequest", { requestId, errorReason: "ConnectionClosed" }); return; }
        }
      } else if (state.mode === "read-failed") { status = 503; body = { error: "Synthetic read outage" }; }
    } else if (path.endsWith("/references")) body = { documents: [], seasonYear: 2026, canUseSeason: false };
    else if (path.endsWith("/thumbnail-options")) body = { page: 1, photos: [], hasMore: false };
    else if (path.endsWith("/sources")) body = { sources: [] };
    else if (path.endsWith("/photo-matching")) {
      if (request.method === "PATCH") {
        const patch = JSON.parse(request.postData); state.patches.push(patch);
        event.photoMatchingEnabled = patch.enabled; event.photoMatchingRevision++;
        body = { ...settings(), saveStatus: "saved" };
      } else {
        body = { ...pageMetadata(0, 1, 500), ...settings(), photos: [] };
        if (state.holdGet) { state.held.push(() => fulfill(requestId, body)); return; }
      }
    } else if (path === "/api/admin/safety") body = { media: [], events: [] };
    else if (path === "/api/admin/media-usage") body = { total: { bytes: "0", count: "0", legacy: "0" },
      byEvent: [], byCreator: [], cleanupCount: "0", policy: { eventBytes: 1000000, creatorBytes: 1000000,
        eventCount: 100, creatorCount: 100 }, warningFraction: 0.8 };
    void fulfill(requestId, body, status, raw);
  });
  await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await browser.command("Page.navigate", { url: new URL(role === "admin" ? "/admin/dashboard" : "/creator/dashboard", base).href });
  const open = async () => {
    if (role === "owner") {
      await browser.wait(`!!(${button("Edit Event")}) || !!(${button("Manage galleries")})`);
      if (!await browser.evaluate(`!!(${button("Edit Event")})`)) await click(browser, button("Manage galleries"));
    }
    await click(browser, button("Edit Event"));
    await browser.wait(`document.getElementById('title')?.value===${JSON.stringify(event.title)}`);
  };
  const close = async () => {
    await click(browser, `document.querySelector('[role="dialog"] button.absolute')`);
    await browser.wait(`!document.querySelector('[role="dialog"]')`);
  };
  const create = async () => {
    await click(browser, button(role === "admin" ? "Create VCO Event" : "Create New Event"));
    await browser.wait(`!!(${platform})`);
  };
  return { browser, state, open, close, create, saved: () => event, changeEvent: changes => { event = { ...event, ...changes }; } };
}

for (const role of ["admin", "owner"])
  test(`event platform ${role}: prefilled editing, save/reopen/reload, independent toggle, omitted field and clear`, { timeout: 90000 }, async () => {
    const f = await fixture(role), { browser, state } = f;
    try {
      f.changeEvent({ platform: "Existing platform" });
      await f.open();
      assert.equal(await browser.evaluate(`${platform}.value`), "Existing platform");
      assert.equal(await browser.evaluate(`!!document.querySelector('#photo-match-platform-95601')`), false);
      assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]').textContent.includes('Save platform')`), false);
      await input(browser, " iRacing "); await click(browser, button("Update Event"));
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.deepEqual(state.writes.at(-1), { platform: "iRacing" });
      await f.open(); assert.equal(await browser.evaluate(`${platform}.value`), "iRacing");
      await browser.command("Page.reload"); await f.open();
      assert.equal(await browser.evaluate(`${platform}.value`), "iRacing");
      await browser.wait(`!!document.querySelector('[aria-label="Refresh photo matching status"]')`);
      await input(browser, "unsaved draft");
      assert.equal(await browser.evaluate(`!!document.querySelector('#photo-match-enabled-95601')`),false);
      await click(browser, `document.querySelector('[aria-label="Refresh photo matching status"]')`);
      await browser.wait(`!document.querySelector('[aria-label="Refresh photo matching status"]').disabled`);
      assert.deepEqual(state.patches, []);
      assert.equal(f.saved().platform, "iRacing");
      assert.equal(await browser.evaluate(`${platform}.value`), "unsaved draft");
      await input(browser, " iRacing ");
      await input(browser, "Changed title", "title");
      await click(browser, button("Update Event")); await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.deepEqual(state.writes.at(-1), { title: "Changed title" });
      await f.open(); await input(browser, "   "); await click(browser, button("Update Event"));
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.deepEqual(state.writes.at(-1), { platform: null });
      await f.open(); assert.equal(await browser.evaluate(`${platform}.value`), "");
      const independent = await browser.evaluate(`(async()=>await (await fetch('/api/events/95601')).json())()`);
      assert.equal(independent.platform, null); assert.equal(independent.photoMatchingEnabled, false);
      assert.deepEqual(state.errors, []); assert.deepEqual(browser.errors, []);
    } finally { await browser.close(); }
  });

for (const role of ["admin", "owner"])
  test(`event platform ${role}: creation, blank defaults after editing, limit validation and keyboard on mobile`, { timeout: 90000 }, async () => {
    const f = await fixture(role), { browser, state } = f;
    try {
      await browser.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      f.changeEvent({ platform: "Old saved platform" });
      await f.open(); await input(browser, "Old draft"); await f.close(); await f.create();
      assert.equal(await browser.evaluate(`${platform}.value`), "");
      assert.equal(await browser.evaluate(`${platform}.placeholder`), "e.g. iRacing");
      await input(browser, "New platform event", "title"); await input(browser, "Fixture description", "description");
      await input(browser, "x".repeat(121)); await click(browser, button("Create Event"));
      await browser.wait(`document.getElementById('platform-error')?.textContent.includes('120 characters')`);
      assert.equal(state.creates.length, 0); assert.equal(await browser.evaluate(`${platform}.value.length`), 121);
      await input(browser, "");
      await browser.evaluate(`${platform}.scrollIntoView({block:'center'});${platform}.focus()`);
      const geometry = await browser.evaluate(`(()=>{const r=${platform}.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,focused:document.activeElement.id};})()`);
      assert.ok(geometry.left >= 0 && geometry.right <= geometry.width); assert.equal(geometry.focused, "platform");
      await browser.command("Input.insertText", { text: "  iRacing  " });
      await click(browser, button("Create Event")); await browser.wait(`document.body.textContent.includes('Event created')`);
      assert.equal(state.creates.length, 1);
      assert.equal(state.creates[0].path, role === "admin" ? "/api/events" : "/api/creator/events");
      assert.equal(state.creates[0].payload.platform, "iRacing");
      assert.equal(f.saved().photoMatchingEnabled, false);
      await f.close(); await f.open(); assert.equal(await browser.evaluate(`${platform}.value`), "iRacing");
      assert.deepEqual(state.errors, []); assert.deepEqual(browser.errors, []);
    } finally { await browser.close(); }
  });

test("event switch and late matching read cannot replace event-bound platform drafts", { timeout: 60000 }, async () => {
  const f = await fixture(), { browser, state } = f;
  try {
    await f.open(); state.holdGet = true;
    await browser.wait(`!!document.querySelector('[aria-label="Refresh photo matching status"]')`);
    await click(browser, `document.querySelector('[aria-label="Refresh photo matching status"]')`);
    await browser.wait(`document.querySelector('[aria-label="Refresh photo matching status"]').disabled`);
    await f.close(); state.holdGet = false;
    f.changeEvent({ id: 95602, title: "Second platform fixture", platform: "ACC" });
    await browser.evaluate(`(async()=>{const {queryClient}=await import('/src/lib/queryClient.ts');await queryClient.invalidateQueries({queryKey:['/api/admin/events']});})()`);
    await browser.wait(`document.body.textContent.includes('Second platform fixture')`);
    await f.open(); assert.equal(await browser.evaluate(`${platform}.value`), "ACC");
    await input(browser, "Second draft");
    for (const release of state.held.splice(0)) await release();
    await delay(200); assert.equal(await browser.evaluate(`${platform}.value`), "Second draft");
    assert.deepEqual(state.errors, []); assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});

for (const mode of ["rejected", "invalid", "lost"])
  test(`event platform ${mode}: preserves draft, single write and explicit recovery`, { timeout: 60000 }, async () => {
    const f = await fixture(), { browser, state } = f;
    try {
      await f.open(); state.mode = mode; await input(browser, "iRacing"); await click(browser, button("Update Event"));
      await browser.wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes(${JSON.stringify(mode === "rejected" ? "Changes rejected" : "Save status unknown")})`);
      assert.equal(await browser.evaluate(`${platform}.value`), "iRacing");
      assert.equal(state.writes.length, 1);
      assert.equal(await browser.evaluate(`document.body.textContent.includes('Event saved')`), false);
      if (mode !== "rejected") {
        assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Update Event').disabled`), true);
        state.mode = "read-failed"; await click(browser, button("Check saved event"));
        await browser.wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('could not be loaded')`);
        assert.equal(await browser.evaluate(`${platform}.value`), "iRacing");
        state.mode = "saved";
        if (mode === "invalid") f.changeEvent({ platform: "Concurrent value" });
        await click(browser, button("Check saved event"));
        await browser.wait(`document.body.textContent.includes(${JSON.stringify(mode === "invalid" ? "Saved values differ for: platform" : "matches your submitted changes")})`);
        assert.equal(await browser.evaluate(`${platform}.value`), "iRacing");
        assert.equal(state.writes.length, 1);
        if (mode === "lost") {
          await click(browser, button("Update Event")); await browser.wait(`!document.querySelector('[role="dialog"]')`);
          assert.equal(state.writes.length, 1, "recovered normalized platform is a no-op");
        }
      }
      assert.deepEqual(state.errors, []); assert.deepEqual(browser.errors, []);
    } finally { await browser.close(); }
  });

for (const mode of ["rejected", "lost"])
  test(`event creation platform ${mode}: draft retained and no automatic replay`, { timeout: 60000 }, async () => {
    const f = await fixture(), { browser, state } = f;
    try {
      await f.create(); await input(browser, "New event", "title"); await input(browser, "Fixture", "description");
      await input(browser, "ACC"); state.mode = mode; await click(browser, button("Create Event"));
      await browser.wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('Your inputs are preserved')`);
      assert.equal(await browser.evaluate(`${platform}.value`), "ACC");
      assert.equal(state.creates.length, 1);
      if (mode === "lost") assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Create Event').disabled`), true);
      assert.deepEqual(browser.errors, []);
    } finally { await browser.close(); }
  });
