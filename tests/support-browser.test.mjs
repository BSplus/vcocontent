import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";
import { readFile } from "node:fs/promises";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;

test("general contacts use support while legal, privacy and creator addresses remain", async () => {
  for (const path of ["client/src/components/legal-links.tsx", "client/src/components/media-rights-notice.tsx"]) {
    const source = await readFile(path, "utf8");
    assert.match(source, /href="\/support"/);
    assert.doesNotMatch(source, /mailto:/);
  }
  const privacy = await readFile("client/src/pages/privacy-policy.tsx", "utf8");
  assert.match(privacy, /restriction affects you, contact <Link href="\/support"/);
  assert.match(privacy, /mailto:info@vco-esports\.com/);
  assert.match(privacy, /mailto:dataprotection@vco-esports\.com/);
  assert.match(await readFile("client/src/pages/imprint.tsx", "utf8"), /mailto:info@vco-esports\.com/);
  assert.match(await readFile("client/src/pages/creator-profile.tsx", "utf8"), /mailto:\$\{creator.publicContactEmail\}/);
});

test("public support form supports mobile/keyboard, preserves drafts and never retries ambiguous sends", { timeout: 120000 }, async () => {
  const browser = await uiBrowser();
  let mode = "accepted", sends = [], release;
  const tasks = new Set(), errors = [];
  browser.listeners.add(event => {
    if (event.method !== "Fetch.requestPaused") return;
    const task = (async () => {
      const { requestId, request } = event.params;
      const path = new URL(request.url).pathname;
      let responseCode = 200, body = [];
      if (path === "/api/user") { responseCode = 401; body = { message: "Not signed in" }; }
      if (path === "/api/support") {
        sends.push(JSON.parse(request.postData));
        if (mode === "hold") await new Promise(resolve => { release = resolve; });
        if (mode === "lost") {
          await browser.command("Fetch.failRequest", { requestId, errorReason: "ConnectionClosed" }); return;
        }
        body = mode === "malformed" ? {} : {
          status: mode === "hold" ? "accepted" : mode,
          ...(mode === "validation" ? { errors: { email: "Review your email." } } : {}),
        };
        responseCode = ["accepted", "hold", "malformed"].includes(mode) ? 200 : mode === "rate_limited" ? 429 : 503;
      }
      await browser.command("Fetch.fulfillRequest", { requestId, responseCode,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64") });
    })().catch(error => errors.push(String(error)));
    tasks.add(task); task.finally(() => tasks.delete(task));
  });
  const visit = async () => {
    await browser.command("Page.navigate", { url: new URL("/support", base).href });
    await browser.wait("!!document.querySelector('form') && !!document.querySelector('#message')");
  };
  const fill = async () => browser.evaluate(`(() => {
    for (const [id,value] of Object.entries({name:'Visitor',email:'visitor@example.test',subject:'Rights question',message:'A private support draft'})) {
      const element=document.getElementById(id);
      Object.getOwnPropertyDescriptor(id==='message'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(element,value);
      element.dispatchEvent(new Event('input',{bubbles:true}));
    }
  })()`);
  const submit = async () => browser.evaluate("document.querySelector('form').requestSubmit()");
  const sendButton = "document.querySelector('button[type=submit]')";
  try {
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    for (const width of [320, 390, 1280]) {
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      await visit();
      await browser.wait("document.title==='Contact VCO Support | VCO Media Database'");
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth+1"), true);
      assert.equal(await browser.evaluate("!!document.querySelector('a[href=\"/privacy-policy\"]')"), true);
      assert.equal(await browser.evaluate("document.querySelector('#website').tabIndex"), -1);
      assert.equal(await browser.evaluate("document.querySelectorAll('label[for=name],label[for=email],label[for=subject],label[for=message]').length"), 4);
      await submit();
      await browser.wait("document.activeElement.id==='name' && document.querySelector('#name').getAttribute('aria-invalid')==='true'");
      assert.equal(sends.length, 0);
    }
    await fill();
    await browser.evaluate("document.querySelector('#name').focus()");
    for (const id of ["email", "subject", "message"]) {
      await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      assert.equal(await browser.evaluate("document.activeElement.id"), id);
    }
    mode = "hold";
    await browser.evaluate(`${sendButton}.focus()`);
    await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await browser.wait(`${sendButton}.disabled && ${sendButton}.getAttribute('aria-busy')==='true'`);
    await browser.evaluate("document.querySelector('form').requestSubmit();document.querySelector('form').requestSubmit()");
    await delay(300);
    assert.equal(sends.length, 1);
    assert.equal(await browser.evaluate("document.querySelector('#message').readOnly"), true);
    release(); await browser.wait("document.querySelector('[role=status]')?.textContent.includes('accepted by our mail provider')");
    await submit(); await delay(200); assert.equal(sends.length, 1);
    for (const state of ["validation", "unavailable", "rate_limited", "rejected", "uncertain", "lost", "malformed"]) {
      mode = state; const before = sends.length;
      await visit(); await fill(); await submit();
      await browser.wait("!!document.querySelector('[role=status]') && document.querySelector('button[type=submit]').getAttribute('aria-busy')==='false'");
      assert.equal(sends.length, before + 1, state);
      assert.equal(await browser.evaluate("document.querySelector('#message').value"), "A private support draft", state);
      const uncertain = ["uncertain", "lost", "malformed"].includes(state);
      assert.equal(await browser.evaluate(`${sendButton}.disabled`), uncertain, state);
      if (uncertain) {
        await submit(); await delay(250); assert.equal(sends.length, before + 1, state);
        assert.match(await browser.evaluate("document.querySelector('[role=status]').textContent"), /check with VCO/i);
      } else {
        mode = "accepted"; await submit();
        await browser.wait("document.querySelector('[role=status]')?.textContent.includes('accepted by our mail provider')");
        assert.equal(sends.length, before + 2);
        assert.notEqual(sends[before].requestId, sends[before + 1].requestId);
      }
    }
    await browser.evaluate("document.querySelector('nav[aria-label=\"Legal information\"] a[href=\"/imprint\"]').click()");
    await browser.wait("location.pathname==='/imprint' && !!document.querySelector('article')");
    assert.equal(await browser.evaluate("!!document.querySelector('a[href=\"mailto:info@vco-esports.com\"]')"), true);
    await browser.evaluate("document.querySelector('nav[aria-label=\"Legal information\"] a[href=\"/support\"]').click()");
    await browser.wait("location.pathname==='/support' && !!document.querySelector('#message')");
    assert.deepEqual(errors, []); assert.deepEqual(browser.errors, []);
  } finally { await Promise.allSettled([...tasks]); await browser.close(); }
});
