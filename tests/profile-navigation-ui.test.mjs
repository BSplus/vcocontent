import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const image = color => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="${color}"/></svg>`);
const oldAvatar = image("#349876"), oldCover = image("#456789");

test("saved avatars and public access work for all roles at desktop and narrow widths", { timeout: 120000 }, async () => {
  const browser = await uiBrowser();
  let account, rejectSave = false, profileReads = 0, followWrites = 0;
  const publicProfile = () => ({
    id: account.id, username: account.username, displayName: "Public fixture",
    bio: account.bio, profileImage: account.profileImagePublic ? account.profileImage : null,
    coverImage: account.profileCoverPublic ? account.profileCoverImage : null,
    publicContactEmail: null, followerCount: 0, following: false,
  });
  browser.listeners.add(event => {
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const path = new URL(request.url).pathname;
    let body = [], status = 200;
    if (path === "/api/user") { body = account; status = account ? 200 : 401; }
    else if (path.startsWith("/api/users/")) { body = publicProfile(); profileReads++; }
    else if (path === "/api/account/profile") {
      if (rejectSave) { status = 400; body = { code: "safety_blocked" }; }
      else {
        const update = JSON.parse(request.postData);
        const { coverImage, ...fields } = update;
        Object.assign(account, fields);
        if ("coverImage" in update) account.profileCoverImage = coverImage;
        body = account;
      }
    } else if (/\/follow$/.test(path)) { followWrites++; body = {}; }
    else if (path === "/api/creator/usage") body = {
      bytes: 0, galleries: 1, photos: 0, eventStats: [], adminExempt: true,
      limits: { bytes: 500000000, galleries: 5, photos: 1000, imageBytes: 5000000 },
    };
    else if (path.startsWith("/api/account/")) body = { items: [], page: 1, totalPages: 1, hasMore: false };
    void browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    }).catch(() => {});
  });
  await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  const visit = async (path, ready) => {
    await browser.command("Page.navigate", { url: new URL(path, base).href });
    await browser.wait(ready);
  };
  const visibleAccount = `[...document.querySelectorAll('header a[href="/account"]')].some(a=>a.getAttribute('aria-label')?.includes('My account')&&a.getBoundingClientRect().width>0)`;
  const avatarSrc = `(()=>{const a=[...document.querySelectorAll('header a[href="/account"]')].find(a=>a.getBoundingClientRect().width>0&&a.querySelector('img'));return a?.querySelector('img').getAttribute('src')??null;})()`;
  const publicLinks = `[...document.querySelectorAll('a')].filter(a=>a.textContent.includes('View public profile'))`;
  const clickLink = async href => browser.evaluate(`(()=>{const a=[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')===${JSON.stringify(href)}&&a.getBoundingClientRect().width>0);if(!a)throw Error('Missing visible link');a.click();})()`);
  const save = async () => {
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save profile').click()`);
    await browser.wait(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Save profile'&&!b.disabled) && !!document.querySelector('[role="${rejectSave ? "alert" : "status"}"]')`);
  };
  try {
    for (const width of [1600, 390, 320]) {
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: false });
      for (const role of [
        { isAdmin: true, creatorStatus: "none" },
        { isAdmin: false, creatorStatus: "approved" },
        { isAdmin: false, creatorStatus: "none" },
        { isAdmin: false, creatorStatus: "pending" },
        { isAdmin: true, creatorStatus: "rejected" },
        { isAdmin: false, creatorStatus: "approved", suspended: true },
      ]) {
        account = { id: 64300, username: "FixtureAccount", email: "private@example.invalid",
          isCreator: false, bio: "Public biography", profileImage: oldAvatar, profileCoverImage: oldCover,
          profileImagePublic: true, profileCoverPublic: true, emailVerifiedAt: "2026-10-01", ...role };
        const eligible = !role.suspended && role.creatorStatus !== "rejected" && (role.isAdmin || role.creatorStatus === "approved");
        await visit("/account?tab=settings", `!!document.querySelector('#profile-bio')`);
        await browser.wait(visibleAccount);
        assert.equal(await browser.evaluate(avatarSrc), oldAvatar);
        assert.equal(await browser.evaluate(`${publicLinks}.length>0`), eligible);
        assert.ok(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth+1`));
        const bounds = await browser.evaluate(`(()=>{const actions=[...document.querySelectorAll('header a,header button')].filter(e=>e.getBoundingClientRect().width>0);return actions.filter(e=>['Search media','Open navigation'].includes(e.getAttribute('aria-label'))||e.getAttribute('href')==='/account').map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});})()`);
        assert.ok(bounds.every(r => r.w >= 44 && r.h >= 44 && r.x >= 0 && r.x + r.w <= width));
        if (eligible) {
          assert.ok(await browser.evaluate(`document.body.innerText.includes('saved public')`));
          await visit("/creator/dashboard", `document.querySelector('h1')?.textContent==='Creator Studio'`);
          assert.ok(await browser.evaluate(`${publicLinks}.some(a=>a.getAttribute('href')==='/creator/64300')`));
          await clickLink("/creator/64300");
          await browser.wait(`document.querySelector('h1')?.textContent==='Public fixture'`);
          assert.equal(await browser.evaluate(`document.body.innerText.includes('private@example.invalid')`), false);
          assert.ok(await browser.evaluate(`[...document.querySelectorAll('img')].some(i=>i.getAttribute('src')===${JSON.stringify(oldCover)})`));
          assert.ok(await browser.evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Your profile'&&b.disabled)`));
          assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Follow'&&!b.disabled)`), false);
        }
      }
      for (const source of [null, "/missing-avatar-fixture.png"]) {
        account = { id: 64300, username: "FixtureAccount", isCreator: false, creatorStatus: "none", profileImage: source };
        await visit("/account?tab=settings", `!!document.querySelector('#profile-bio')`);
        await browser.wait(visibleAccount);
        await browser.wait(`${avatarSrc}===null`);
        assert.ok(await browser.evaluate(`[...document.querySelectorAll('header a[href="/account"]')].some(a=>a.getBoundingClientRect().width>0&&a.getAttribute('aria-label')?.includes('My account'))`));
      }
      account = null;
      await visit("/", `document.querySelector('h1')?.textContent.toLowerCase().includes('every race') && !!document.querySelector('header a[href="/auth"]') && !document.querySelector('header a[href="/account"]')`);
      if (width < 1536) await browser.evaluate(`document.querySelector('button[aria-label="Open navigation"]').click()`);
      await browser.wait(`[...document.querySelectorAll('a[href="/auth"]')].some(a=>a.getBoundingClientRect().width>0)`);
    }
    // Cache the public page, then navigate client-side: a full reload would hide stale-cache bugs.
    account = { id: 64300, username: "FixtureAccount", isAdmin: true, isCreator: false,
      creatorStatus: "none", bio: "", email: "private@example.invalid", emailVerifiedAt: "2026-10-01",
      profileImage: oldAvatar, profileCoverImage: oldCover, profileImagePublic: true, profileCoverPublic: true };
    await visit("/creator/64300", `document.querySelector('h1')?.textContent==='Public fixture'`);
    await clickLink("/account");
    await browser.wait(`document.querySelector('h1')?.textContent==='My account'`);
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Settings').click()`);
    await browser.wait(`!!document.querySelector('#profile-bio')`);
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Remove photo').click();[...document.querySelectorAll('button')].find(b=>b.textContent==='Remove cover').click()`);
    assert.equal(await browser.evaluate(avatarSrc), oldAvatar);
    rejectSave = true; await save();
    assert.equal(await browser.evaluate(avatarSrc), oldAvatar);
    const readsBeforeFailure = profileReads;
    await clickLink("/creator/64300");
    await browser.wait(`document.querySelector('h1')?.textContent==='Public fixture'`);
    assert.equal(profileReads, readsBeforeFailure);
    assert.ok(await browser.evaluate(`[...document.querySelectorAll('img')].some(i=>i.getAttribute('src')===${JSON.stringify(oldCover)})`));
    await clickLink("/account");
    await browser.wait(`document.querySelector('h1')?.textContent==='My account'`);
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Settings').click()`);
    await browser.wait(`!!document.querySelector('#profile-bio')`);
    // Select valid small PNG files for both assets, returning normalized saved images from the fixture.
    for (const id of ["profile-image", "profile-cover"]) await browser.evaluate(`(()=>{
      const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
      const dt=new DataTransfer();dt.items.add(new File([bytes],'fixture.png',{type:'image/png'}));
      const input=document.getElementById('${id}');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.wait(`document.body.innerText.includes('Selected image changes included')`);
    assert.equal(await browser.evaluate(avatarSrc), oldAvatar);
    // The mock saves selected sources; record their exact confirmed values, not editor-only state.
    rejectSave = false; await save();
    await browser.wait(`${avatarSrc}===${JSON.stringify(account.profileImage)}`);
    assert.notEqual(account.profileImage, oldAvatar);
    const confirmedAvatar = account.profileImage, confirmedCover = account.profileCoverImage;
    const reads = profileReads;
    await clickLink("/creator/64300");
    await browser.wait(`document.querySelector('h1')?.textContent==='Public fixture'`);
    assert.ok(profileReads > reads);
    assert.ok(await browser.evaluate(`[...document.querySelectorAll('img')].some(i=>i.getAttribute('src')===${JSON.stringify(confirmedCover)})`));
    assert.ok(await browser.evaluate(`[...document.querySelectorAll('img')].some(i=>i.getAttribute('src')===${JSON.stringify(confirmedAvatar)}&&i.complete&&i.naturalWidth>0)`));
    assert.equal(followWrites, 0);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
