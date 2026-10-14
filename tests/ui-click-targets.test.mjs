import test from "node:test";
import assert from "node:assert/strict";
import { pageMetadata } from "../shared/pagination.ts";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const poster = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#20354a"/><text x="40" y="180" fill="white" font-size="32">Safe UI fixture</text></svg>');
const past = new Date(Date.now() - 86400000).toISOString();
const future = new Date(Date.now() + 7 * 86400000).toISOString();
const events = [
  { id: 64001, title: "Fixture recent race", date: past, description: "Browser fixture", creatorId: null },
  { id: 64002, title: "Fixture creator race", date: past, description: "Browser fixture", creatorId: 64001 },
  { id: 64003, title: "Fixture scheduled race", date: future, description: "Calendar fixture", creatorId: null },
];
const media = [
  { id: 64101, eventId: 64001, type: "image", caption: "Fixture race photo", thumbnail: poster, url: poster, tags: ["race"], photographer: "Fixture photographer", downloadCount: 12 },
  { id: 64102, eventId: 64002, type: "image", caption: "Fixture creator photo", thumbnail: poster, url: poster, tags: [], downloadCount: 7 },
  { id: 64103, eventId: 64001, type: "video", caption: "Fixture race video", thumbnail: poster, url: "/fixture-video.mp4", tags: ["race"], downloadCount: 4 },
];

test("click targets on desktop and touch with isolated API fixtures (no database writes)", { timeout: 120000 }, async () => {
  const browser = await uiBrowser();
  let role = "anonymous";
  const writes = [];
  const mockErrors = [];
  browser.listeners.add(event => {
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const path = new URL(request.url).pathname;
    let body = [];
    let status = 200;
    if (request.method !== "GET") writes.push(`${request.method} ${path}`);
    if (path === "/api/user") {
      status = role === "anonymous" ? 401 : 200;
      body = role === "anonymous" ? { message: "Not signed in" } : {
        id: 64001, username: "Fixture user", isAdmin: role === "admin",
        isCreator: role === "creator", creatorStatus: role === "approved" || role === "creator" ? "approved" : null,
      };
    } else if (path === "/api/events") body = events;
    else if (path === "/api/creator/events") body = [events[1]];
    else if (path === "/api/creator/usage") body = {bytes:120000,galleries:1,photos:1,unknown:0,adminExempt:false,
      limits:{bytes:500000000,galleries:5,photos:1000},eventStats:[{eventId:64002,photos:1,videos:0,downloads:7}]};
    else if (path === "/api/creator/recent-media") body = [media[1]];
    else if (path.startsWith("/api/community/")) body = {count:0,liked:false,saved:false};
    else if (path === "/api/media/top-shots") body = [media[0], media[2]];
    else if (path === "/api/media/creator-top") body = [media[1]];
    else if (path === "/api/media") {
      // Public search results are authoritative; the browser must not re-filter them.
      const params = new URL(request.url).searchParams;
      const terms = (params.get("q") || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
      body = media.filter(item => terms.every(term =>
        [item.caption, item.photographer, ...(item.tags || [])].some(value => value?.toLowerCase().includes(term))));
    }
    else if (/^\/api\/events\/\d+\/media$/.test(path)) body = media.filter(item => item.eventId === Number(path.split("/")[3]));
    else if (/^\/api\/events\/\d+$/.test(path)) body = events.find(item => item.id === Number(path.split("/")[3]));
    else if (/^\/api\/media\/\d+$/.test(path)) body = media.find(item => item.id === Number(path.split("/")[3]));
    else if (path.startsWith("/api/users/")) body = { username: "Fixture creator", id: 64001, isCreator: true };
    else if (path.endsWith("/analysis")) body = { status: "idle" };
    else if (path === "/api/credits") body = { credits: 0 };
    if (Array.isArray(body) && new URL(request.url).searchParams.get("pagination")==="true") body={...pageMetadata(body.length,1,48),items:body};
    browser.command("Fetch.fulfillRequest", {
      requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    }).catch(error => {
      // Page changes can cancel an intercepted request before it is fulfilled.
      if (!String(error).includes("Invalid InterceptionId")) mockErrors.push(String(error));
    });
  });
  await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
  const visit = async (path, ready) => {
    await browser.command("Page.navigate", { url: new URL(path, base).href });
    try { await browser.wait(ready); }
    catch (error) { throw new Error(`${error.message}\nRuntime errors: ${JSON.stringify(browser.errors)}`, { cause: error }); }
  };
  const escape = async () => {
    // Radix installs its document-level dismissal listener after the first paint.
    // A rendered menu alone is not evidence that it is ready for key input.
    await delay(100);
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  };
  const key = async (key, code, value) => {
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: value, ...(key === "Enter" && { text: "\r", unmodifiedText: "\r" }) });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: value });
  };
  let touch = false;
  const activate = async selector => {
    const point = await browser.evaluate(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Missing target: '+${JSON.stringify(selector)});
      el.scrollIntoView({block:'center'});
      const r=el.getBoundingClientRect();
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    })()`);
    if (touch) {
      await browser.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await browser.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    }
  };
  const focus = async selector => {
    await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await key("Tab", "Tab", 9);
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
    assert.equal(await browser.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(selector)}) && document.activeElement.matches(':focus-visible')`), true, `Keyboard focus: ${selector}`);
  };
  const viewport = async width => {
    touch = width < 600;
    await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    await browser.command("Emulation.setTouchEmulationEnabled", { enabled: width < 600 });
  };
  const layout = () => browser.evaluate(`({width:innerWidth, overflow:document.documentElement.scrollWidth > innerWidth + 1})`);
  try {
    for (const width of [1280, 390]) {
      console.log(`Checking preview, details, downloads and creator edit at ${width}px`);
      await viewport(width);
      await visit("/", `!!document.querySelector('section[aria-labelledby="creator-media-heading"] button')`);
      const state = await browser.evaluate(`({
        heroSearches:document.querySelector('main section').querySelectorAll('a[href="/search"]').length,
        nav:[...document.querySelectorAll('nav a')].map(a=>a.textContent),
        top:document.querySelector('section[aria-labelledby="top-shots-heading"] button').innerText,
        creator:document.querySelector('section[aria-labelledby="creator-media-heading"] button').innerText
      })`);
      assert.equal((await layout()).overflow, false);
      assert.equal((await layout()).width, width, "CSS viewport must match touch/desktop emulation");
        assert.equal(state.heroSearches, 1);
        assert.match(state.top, /Preview/i);
        assert.match(state.top, /12 downloads/);
        assert.match(state.creator, /Preview/i);
        assert.match(state.creator, /7 downloads/);
        assert.equal(await browser.evaluate(`document.querySelector('main section a[href="/search"]').textContent.includes('Search media')`), true);
      const highlighted = 'section[aria-labelledby="top-shots-heading"] button';
      await focus(highlighted);
      await activate(highlighted);
      await browser.wait(`!!document.querySelector('[role="dialog"]')`);
      assert.equal(await browser.evaluate("location.pathname"), "/");
      assert.match(await browser.evaluate(`document.querySelector('[role="dialog"]').innerText`), /Media preview/i);
      assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]').contains(document.activeElement)`), true);
      await activate('[role="dialog"] button[aria-haspopup="menu"]');
      await browser.wait(`!!document.querySelector('[role="menu"]')`);
      assert.match(await browser.evaluate(`document.querySelector('[role="menu"]').innerText`), /High-Res.*Sign in required/);
      await escape();
      await browser.wait(`!document.querySelector('[role="menu"]')`);
      await escape();
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.equal(await browser.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(highlighted)})`), true);
      await activate('section[aria-labelledby="creator-media-heading"] button');
      await browser.wait(`!!document.querySelector('[role="dialog"]')`);
      assert.match(await browser.evaluate(`document.querySelector('[role="dialog"]').innerText`), /Fixture creator photo/);
      await escape();
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      await activate('button[aria-label="Preview video: Fixture race video"]');
      await browser.wait(`!!document.querySelector('[role="dialog"]')`);
      assert.equal(await browser.evaluate(`!!document.querySelector('[role="dialog"] video')`), false);
      assert.match(await browser.evaluate(`document.querySelector('[role="dialog"]').innerText`), /Sign in to play this video/);
      await activate('[role="dialog"] button[aria-haspopup="menu"]');
      await browser.wait(`!!document.querySelector('[role="menu"]')`);
      assert.doesNotMatch(await browser.evaluate(`document.querySelector('[role="menu"]').innerText`), /Low-Res/);
      await escape();
      await browser.wait(`!document.querySelector('[role="menu"]')`);
      await escape();
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      await visit("/upcoming-events", `document.querySelector('main ol')?.textContent.includes('Fixture scheduled race')`);
      assert.match(await browser.evaluate("document.querySelector('main').innerText"), /Calendar information only/);
      assert.equal(await browser.evaluate(`document.querySelectorAll('main ol a, main ol button').length`), 0);
      await visit("/search?q=race", `document.querySelectorAll('article').length === 2`);
      const grid = await browser.evaluate(`({label:document.querySelector('article button').getAttribute('aria-label'),actions:document.querySelector('article').innerText})`);
        assert.match(grid.label, /Preview photo/);
        assert.match(grid.actions, /Media details/i);
        assert.match(grid.actions, /Download options/i);
      assert.equal(await browser.evaluate(`document.querySelectorAll('article [role="checkbox"], article button[aria-label="Edit media"]').length`), 0);
      await focus("article button");
      await key("Enter", "Enter", 13);
      await browser.wait(`!!document.querySelector('[role="dialog"]')`);
      assert.match(await browser.evaluate(`document.querySelector('[role="dialog"]').innerText`), /Media preview/i);
      await escape();
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.equal(await browser.evaluate(`document.activeElement === document.querySelector('article button')`), true);
      await activate('article button[aria-haspopup="menu"]');
      await browser.wait(`!!document.querySelector('[role="menu"]')`);
      assert.match(await browser.evaluate(`document.querySelector('[role="menu"]').innerText`), /Low-Res/);
      await escape();
      await browser.wait(`!document.querySelector('[role="menu"]')`);
      await activate('article a[href="/media/64101"]');
      await browser.wait(`location.pathname === '/media/64101' && !!document.querySelector('main h1')`);
      assert.equal(await browser.evaluate(`!!document.querySelector('[role="dialog"]')`), false);
      assert.match(await browser.evaluate(`document.querySelector('main h1').innerText`), /Fixture race photo/i);
      await visit("/creator/dashboard", `location.pathname === '/auth' && !!document.querySelector('#login-username')`);
      role = "creator";
      await visit("/creator/dashboard", `!!document.querySelector('nav[aria-label="Creator Studio sections"]')`);
      await browser.evaluate(`[...document.querySelectorAll('nav[aria-label="Creator Studio sections"] button')].find(button=>button.textContent==='My Galleries').click()`);
      await browser.wait(`!!document.querySelector('[role="tab"][data-state="active"]')`);
      // Keyboard activates Radix tabs and also verifies their keyboard reachability.
      await browser.evaluate(`document.querySelectorAll('[role="tab"]')[1].focus()`);
      await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await browser.wait(`!!document.querySelector('select')`);
      await browser.evaluate(`document.querySelector('select').value='64002'; document.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}))`);
      await browser.wait(`!!document.querySelector('img[alt="Fixture creator photo"]')`);
      const editState = await browser.evaluate(`(() => {
        const img=document.querySelector('img[alt="Fixture creator photo"]');
        const card=img.closest('.group');
        const button=card.querySelector('button');
        return {label:button.textContent.trim(),parentOpacity:getComputedStyle(button.parentElement).opacity,overflow:document.documentElement.scrollWidth > innerWidth + 1};
      })()`);
        assert.equal(editState.parentOpacity, "1");
        assert.equal(editState.overflow, false);
      const edit = 'button[aria-label="Edit media: Fixture creator photo"]';
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(edit)}).getBoundingClientRect().height >= 44`), true);
      await focus(edit);
      await key("Enter", "Enter", 13);
      await browser.wait(`!!document.querySelector('[role="dialog"] textarea')`);
      assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]').contains(document.activeElement)`), true);
      await focus("#recognition-session");
      await browser.command("Input.insertText", { text: "Race 1" });
      assert.equal(await browser.evaluate(`document.querySelector('#recognition-session').value`), "Race 1");
      await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='Add vehicle').setAttribute('data-test-target','add-vehicle')`);
      await activate('[data-test-target="add-vehicle"]');
      await browser.wait(`!!document.querySelector('#identification-0-number')`);
      await focus("#identification-0-number");
      await browser.command("Input.insertText", { text: "007" });
      assert.equal(await browser.evaluate(`document.querySelector('#identification-0-number').value`), "007");
      await escape();
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.equal(await browser.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(edit)})`), true);
      await activate(edit);
      await browser.wait(`!!document.querySelector('[role="dialog"] textarea')`);
      await escape();
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      await visit("/", `!!document.querySelector('button[aria-label="Preview video: Fixture race video"]') && !!document.querySelector('a[href="/creator/dashboard"]')`);
      await activate('button[aria-label="Preview video: Fixture race video"]');
      await browser.wait(`!!document.querySelector('[role="dialog"] video[controls]')`);
      await escape();
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      role = "anonymous";
    }
    // Only the changed navigation's density and role-specific destinations.
    for (const testRole of ["anonymous", "user", "creator", "approved", "admin"]) {
      role = testRole;
      for (const width of [320, 390, 1024, 1280, 1536, 1920]) {
        await viewport(width);
        await visit("/", `!!document.querySelector('section[aria-labelledby="creator-media-heading"] button')`);
        const hasMenu = await browser.evaluate(`document.querySelector('button[aria-label="Open navigation"]').getBoundingClientRect().width > 0`);
        if (hasMenu) await activate('button[aria-label="Open navigation"]');
        const navState = await browser.evaluate(`(() => {
          const nav=document.querySelector(${hasMenu ? "'#mobile-navigation'" : "'nav[aria-label=\"Main navigation\"]'"});
          const r=nav.getBoundingClientRect();
          return {text:nav.innerText,creator:!!nav.querySelector('a[href="/creator/dashboard"]'),
            admin:!!nav.querySelector('a[href="/admin/dashboard"]'),
            users:!!nav.querySelector('a[href="/admin/users"]'),
            clipped:nav.scrollWidth>nav.clientWidth+1 || r.right>innerWidth+1};
        })()`);
        assert.match(navState.text, /Recent events/i);
        assert.match(navState.text, /Creator events/i);
        assert.equal(navState.creator, ["creator", "approved", "admin"].includes(role));
        assert.equal(navState.admin, role === "admin");
        assert.equal(navState.users, role === "admin");
        assert.equal(navState.clipped, false, `${role} navigation at ${width}`);
        assert.equal((await layout()).overflow, false, `${role} page at ${width}`);
        if (hasMenu) {
          await activate('#mobile-navigation a[href="/current-events"]');
          await browser.wait(`location.pathname === '/current-events' && document.querySelector('main h1')?.textContent === 'Recent events'`);
          assert.equal(await browser.evaluate(`!!document.querySelector('#mobile-navigation')`), false);
        }
      }
    }
    role = "user";
    await visit("/creator/dashboard", `location.pathname === '/creator/apply'`);
    role = "creator";
    await visit("/admin/users", `location.pathname === '/' && !!document.querySelector('main')`);
    role = "admin";
    for (const width of [1280, 390]) {
      await viewport(width);
      await visit("/search?q=race", `!!document.querySelector('article [role="checkbox"]')`);
      await activate('article [role="checkbox"]');
      await browser.wait(`document.querySelector('article button').getAttribute('aria-label').startsWith('Deselect:')`);
      assert.equal(await browser.evaluate(`document.querySelector('article button').getAttribute('aria-pressed')`), "true");
      await activate('article:nth-child(2) button');
      await browser.wait(`document.querySelector('article:nth-child(2) button').getAttribute('aria-label').startsWith('Deselect:')`);
      assert.equal(await browser.evaluate(`!!document.querySelector('[role="dialog"]')`), false);
      await activate('article:nth-child(2) button');
      await browser.wait(`document.querySelector('article:nth-child(2) button').getAttribute('aria-label').startsWith('Select:')`);
      // The explicit Preview action is still preview even in selection mode.
      await browser.evaluate(`(() => { const buttons=[...document.querySelector('article').querySelectorAll('button')]; buttons.find(b=>b.textContent==='Preview').focus(); })()`);
      await key("Enter", "Enter", 13);
      await browser.wait(`!!document.querySelector('[role="dialog"]')`);
      await escape();
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      await activate('article [role="checkbox"]');
      await browser.wait(`document.querySelector('article button').getAttribute('aria-label').startsWith('Preview photo:')`);
      assert.equal((await layout()).overflow, false);
    }
    // Real, anonymous backend boundary checks: no fixture cookies or writes.
    for (const path of ["/api/creator/events", "/api/admin/users"]) {
      assert.equal((await fetch(new URL(path, base))).status, 401, `${path}: anonymous boundary`);
    }
    assert.deepEqual(writes, []);
    assert.deepEqual(mockErrors, []);
    assert.deepEqual(browser.errors, []);
  } finally {
    await browser.close();
  }
});
