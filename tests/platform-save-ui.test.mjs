import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";
import { pageMetadata } from "../shared/pagination.ts";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const platform = `document.querySelector('[aria-label="Sim-racing platform (optional)"]')`;
const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
async function click(browser, expression) {
  await browser.wait(`!!(${expression})`);
  await browser.evaluate(`(${expression}).click()`);
}
async function input(browser, value) {
  await browser.evaluate(`(()=>{
    const el=${platform};
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
}
async function fixture(role = "admin") {
  const browser = await uiBrowser();
  let event = { id: 95601, title: "Platform fixture", description: "Isolated fixture",
    date: "2026-10-11T00:00:00.000Z", creatorId: role === "admin" ? null : 95600,
    platform: null, photoMatchingEnabled: false, contentVersion: 0, referenceRevision: 0,
    photoMatchingRevision: 0, isPremium: false, visibility: "draft" };
  const state = { mode: "saved", patches: [], errors: [], held: [], heldPatches: [], holdGet: false, holdPatch: false, stale: false };
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
      isCreator: role === "owner", creatorStatus: "approved", emailVerifiedAt: event.date };
    else if (["/api/events", "/api/admin/events", "/api/creator/events"].includes(path)) body = [event];
    else if (path === "/api/creator/usage") body = { bytes: 0, galleries: 1, photos: 0, unknown: 0, pendingCleanup: 0,
      limits: { bytes: 500000000, galleries: 5, photos: 1000, imageBytes: 5000000 }, eventStats: [] };
    else if (path === `/api/events/${event.id}`) {
      if (request.method === "PUT") event = { ...event, ...JSON.parse(request.postData) };
      body = request.method === "PUT" ? { ...event, saveStatus: "saved" } : event;
    } else if (path.endsWith("/references")) body = { documents: [], seasonYear: 2026, canUseSeason: false };
    else if (path.endsWith("/thumbnail-options")) body = { page: 1, photos: [], hasMore: false };
    else if (path.endsWith("/sources")) body = { sources: [] };
    else if (path.endsWith("/photo-matching")) {
      if (request.method === "PATCH") {
        const patch = JSON.parse(request.postData); state.patches.push(patch);
        if (state.mode === "rejected") { status = 400; body = { error: "Synthetic rejection", saveStatus: "rejected" }; }
        else {
          if ("platform" in patch) { event.platform = patch.platform?.trim() || null; event.referenceRevision++; }
          if (state.mode === "authoritative") event.platform = "Server-confirmed platform";
          if ("enabled" in patch) { event.photoMatchingEnabled = patch.enabled; event.photoMatchingRevision++; }
          event.contentVersion++;
          body = { ...settings(), saveStatus: "saved" };
          if (state.holdPatch) { state.heldPatches.push(() => fulfill(requestId, body)); return; }
          if (state.mode === "invalid") raw = "{broken";
          if (state.mode === "lost") {
            void browser.command("Fetch.failRequest", { requestId, errorReason: "ConnectionClosed" });
            return;
          }
        }
      } else {
        body = { ...pageMetadata(0, 1, 500), ...settings(), photos: [] };
        if (state.stale) body = { ...body, platform: null, enabled: false, contentVersion: 0, referenceRevision: 0, photoMatchingRevision: 0 };
        if (state.holdGet) { state.held.push(() => fulfill(requestId, body)); return; }
        if (state.mode === "read-failed") { status = 503; body = { error: "Synthetic read outage" }; }
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
    await browser.wait(`!!(${platform})`);
  };
  const close = async () => {
    await click(browser, `document.querySelector('[role="dialog"] button.absolute')`);
    await browser.wait(`!document.querySelector('[role="dialog"]')`);
  };
  return { browser, state, open, close, saved: () => event, changeEvent: changes => { event = { ...event, ...changes }; } };
}

for (const role of ["admin", "owner"])
  test(`platform ${role}: save, close, reopen, reload, toggle, other fields and clear`, { timeout: 90000 }, async () => {
    const f = await fixture(role), { browser, state } = f;
    try {
      await f.open(); await input(browser, " iRacing "); await click(browser, button("Save platform"));
      await browser.wait(`!document.body.textContent.includes('Saving settings')`);
      await f.close(); await f.open();
      assert.equal(await browser.evaluate(`${platform}.value`), "iRacing");
      await browser.command("Page.reload"); await f.open();
      assert.equal(await browser.evaluate(`${platform}.value`), "iRacing");
      // A stale GET after a confirmed PATCH must never become the next toggle's write value.
      state.stale = true;
      await click(browser, `document.querySelector('[aria-label="Refresh photo matching status"]')`);
      await delay(200);
      await click(browser, `document.querySelector('#photo-match-enabled-95601')`);
      await delay(300);
      assert.equal(f.saved().platform, "iRacing", "a stale read followed by the matching toggle must not erase the stored platform");
      await browser.wait(`document.querySelector('#photo-match-enabled-95601')?.getAttribute('aria-checked')==='true'`);
      assert.deepEqual(state.patches.at(-1), { enabled: true });
      assert.equal(f.saved().platform, "iRacing");
      await input(browser, "unsaved draft");
      await browser.evaluate("window.confirm=()=>true");
      await click(browser, `document.querySelector('#photo-match-enabled-95601')`);
      await browser.wait(`document.querySelector('#photo-match-enabled-95601')?.getAttribute('aria-checked')==='false'`);
      assert.equal(await browser.evaluate(`${platform}.value`), "unsaved draft");
      state.stale = false;
      await browser.evaluate(`(()=>{
        const el=document.getElementById('title');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Changed fixture');
        el.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await click(browser, button("Update Event")); await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.equal(f.saved().platform, "iRacing");
      await f.open(); await input(browser, ""); await click(browser, button("Save platform"));
      await browser.wait(`document.body.textContent.includes('Platform saved')`);
      await f.close(); await f.open();
      assert.equal(await browser.evaluate(`${platform}.value`), "");
      const independent = await browser.evaluate(`(async()=>await (await fetch('/api/events/95601')).json())()`);
      assert.equal(independent.platform, null); assert.equal(independent.photoMatchingEnabled, false);
      assert.deepEqual(state.errors, []); assert.deepEqual(browser.errors, []);
    } finally { await browser.close(); }
  });

test("slow GET crossing PATCH and late old-event PATCH cannot change confirmed values or another draft", { timeout: 90000 }, async () => {
  const f = await fixture(), { browser, state } = f;
  try {
    await f.open(); await input(browser, "iRacing");
    state.holdGet = true;
    await click(browser, `document.querySelector('[aria-label="Refresh photo matching status"]')`);
    while (!state.held.length) await delay(20);
    await click(browser, button("Save platform"));
    await browser.wait(`document.body.textContent.includes('Platform saved')`);
    await input(browser, "Unsaved ACC draft");
    await delay(4500); // One poll interval: neither poll nor old read may replace this draft.
    state.holdGet = false;
    for (const release of state.held.splice(0)) await release();
    await delay(200);
    assert.equal(await browser.evaluate(`${platform}.value`), "Unsaved ACC draft");
    assert.equal(await browser.evaluate(`document.querySelector('#photo-match-enabled-95601').getAttribute('aria-checked')`), "false");
    assert.equal(f.saved().platform, "iRacing");
    state.holdPatch = true;
    await click(browser, button("Save platform"));
    while (!state.heldPatches.length) await delay(20);
    await f.close();
    f.changeEvent({ id: 95602, title: "Second platform fixture", platform: "Second saved platform" });
    await browser.evaluate(`(async()=>{
      const {queryClient}=await import('/src/lib/queryClient.ts');
      await queryClient.invalidateQueries({queryKey:['/api/admin/events']});
    })()`);
    await browser.wait(`document.body.textContent.includes('Second platform fixture')`);
    await f.open();
    assert.equal(await browser.evaluate(`${platform}.value`), "Second saved platform");
    await input(browser, "Second unsaved draft");
    for (const release of state.heldPatches.splice(0)) await release();
    await delay(300);
    assert.equal(await browser.evaluate(`${platform}.value`), "Second unsaved draft");
    assert.equal(await browser.evaluate("document.body.textContent.includes('Platform saved')"), false);
    assert.equal(state.patches.length, 2);
    assert.deepEqual(state.errors, []); assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});

test("late GET from a closed event cannot initialize another event", { timeout: 60000 }, async () => {
  const f = await fixture(), { browser, state } = f;
  try {
    await f.open(); state.holdGet = true;
    await click(browser, `document.querySelector('[aria-label="Refresh photo matching status"]')`);
    while (!state.held.length) await delay(20);
    await f.close(); state.holdGet = false;
    f.changeEvent({ id: 95602, title: "Second platform fixture", platform: "ACC" });
    await browser.evaluate(`(async()=>{
      const {queryClient}=await import('/src/lib/queryClient.ts');
      await queryClient.invalidateQueries({queryKey:['/api/admin/events']});
    })()`);
    await browser.wait(`document.body.textContent.includes('Second platform fixture')`);
    await f.open(); await input(browser, "Second event draft");
    for (const release of state.held.splice(0)) await release();
    await delay(200);
    assert.equal(await browser.evaluate(`${platform}.value`), "Second event draft");
    assert.deepEqual(state.errors, []); assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});

for (const mode of ["rejected", "invalid", "lost"])
  test(`platform ${mode}: preserves draft and never falsely confirms`, { timeout: 60000 }, async () => {
    const f = await fixture(), { browser, state } = f;
    try {
      await f.open(); state.mode = mode;
      await input(browser, "iRacing"); await click(browser, button("Save platform"));
      await browser.wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes(${JSON.stringify(mode === "rejected" ? "Changes rejected" : "Save status unknown")})`);
      assert.equal(await browser.evaluate(`${platform}.value`), "iRacing");
      assert.equal(await browser.evaluate("document.body.textContent.includes('Platform saved')"), false);
      assert.equal(state.patches.length, 1);
      if (mode !== "rejected") {
        state.mode = "read-failed";
        await click(browser, button("Check saved settings"));
        await browser.wait(`document.body.textContent.includes('Synthetic read outage')`);
        assert.equal(await browser.evaluate(`${platform}.value`), "iRacing");
        state.mode = "saved";
        if (mode === "invalid") f.changeEvent({ platform: "Concurrent saved value", contentVersion: 2, referenceRevision: 2 });
        await click(browser, button("Check saved settings"));
        await browser.wait(`document.body.textContent.includes('Current saved settings loaded')`);
        assert.equal(await browser.evaluate(`${platform}.value`), "iRacing", "checking must keep the unsaved input even if stored settings differ");
        assert.equal(state.patches.length, 1);
      }
      assert.equal(f.saved().platform, mode === "rejected" ? null : mode === "invalid" ? "Concurrent saved value" : "iRacing");
    } finally { await browser.close(); }
  });

test("authoritative PATCH values survive a failed later GET without a false rejection", { timeout: 60000 }, async () => {
  const f = await fixture(), { browser, state } = f;
  try {
    await f.open(); state.mode = "authoritative";
    await input(browser, "Submitted platform"); await click(browser, button("Save platform"));
    await browser.wait(`${platform}?.value==='Server-confirmed platform'`);
    await browser.wait(`document.body.textContent.includes('Platform saved')`);
    state.mode = "read-failed";
    await click(browser, `document.querySelector('[aria-label="Refresh photo matching status"]')`);
    await browser.wait(`document.body.textContent.includes('Synthetic read outage')`);
    assert.equal(await browser.evaluate(`${platform}.value`), "Server-confirmed platform");
    assert.equal(await browser.evaluate("document.body.textContent.includes('Save status unknown')||document.body.textContent.includes('Changes rejected')"), false);
    assert.equal(await browser.evaluate("document.body.textContent.includes('Platform saved')"), true);
    assert.equal(state.patches.length, 1);
  } finally { await browser.close(); }
});
