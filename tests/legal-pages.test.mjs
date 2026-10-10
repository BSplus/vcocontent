import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const source = path => readFile(path, "utf8");

test("legal integration reserves rights and leaves unapproved terms out of the app", async () => {
  const [app, imprint, privacy, footer, auth, apply, dashboard, upload, reference, detail, grid, notice, draft, report] = await Promise.all([
    "client/src/App.tsx", "client/src/pages/imprint.tsx", "client/src/pages/privacy-policy.tsx",
    "client/src/components/footer.tsx", "client/src/pages/auth-page.tsx", "client/src/pages/creator/apply.tsx",
    "client/src/pages/creator/dashboard.tsx", "client/src/components/media-upload-modal.tsx",
    "client/src/components/upload-modal.tsx", "client/src/pages/media-detail.tsx",
    "client/src/components/media-grid.tsx", "client/src/components/media-rights-notice.tsx",
    "docs/gallery-creator-terms-review.md", "docs/legal-change-and-gap-report.md",
  ].map(source));
  assert.match(app, /<Route path="\/privacy-policy" component={PrivacyPolicy}/);
  assert.doesNotMatch(imprint, /TMG|143\/190\/4186|private use only|href="\/contact"/);
  for (const fact of ["§ 5 DDG", "DE331164657", "HRB 255920", "§ 18 (2) MStV", "Andreas Pavelic"]) assert.ok(imprint.includes(fact));
  assert.doesNotMatch(privacy, /Clerk|Instagram|YouTube|Google Analytics|Meta advertising/);
  for (const fact of ["vco.sid", "24 hours", "Resend", "Replit-managed OpenAI", "sampled video frames",
    "Article 14", "Article 22", "Article 35", "BayLDA", "dataprotection@vco-esports.com", "§ 25 (1) TDDDG"]) assert.ok(privacy.includes(fact), fact);
  for (const layout of [footer, auth, apply, dashboard, upload, reference]) assert.match(layout, /<LegalLinks/);
  for (const context of [footer, apply, detail, grid, imprint]) assert.match(context, /<MediaRightsNotice/);
  assert.match(notice, /does not grant a licence/);
  assert.match(notice, /statutory permissions/);
  assert.match(auth, /not a consent requirement/);
  assert.doesNotMatch(auth, /Checkbox|type="checkbox"|agree.*Privacy/i);
  assert.match(draft, /NOT IN FORCE/);
  assert.match(draft, /NOT GRANTED/);
  assert.match(report, /Art\. 16/);
  assert.match(report, /Art\. 17/);
  assert.doesNotMatch(app, /gallery-creator-terms-review|path="\/terms"/);
});

test("legal pages load without login with mobile-readable text, working navigation and titles", { timeout: 60000 }, async () => {
  const browser = await uiBrowser();
  try {
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    for (const [path, title] of [["/imprint", "Imprint"], ["/privacy-policy", "Privacy Policy"]]) {
      const response = await fetch(new URL(path, base));
      assert.equal(response.status, 200, path);
      const html = await response.text();
      assert.ok(html.includes(`<title>${title} | VCO Media Database</title>`));
      await browser.command("Page.navigate", { url: new URL(path, base).href });
      await browser.wait(`!!document.querySelector('article') && document.title===${JSON.stringify(`${title} | VCO Media Database`)}`);
      const state = await browser.evaluate(`({
        path:location.pathname, text:document.querySelector('article').innerText,
        width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
        font:parseFloat(getComputedStyle(document.querySelector('article')).fontSize),
        line:parseFloat(getComputedStyle(document.querySelector('article')).lineHeight),
        links:[...document.querySelectorAll('nav[aria-label="Legal information"] a')].map(a=>a.getAttribute('href')),
        lang:document.querySelector('article').lang,
        cookies:document.cookie
      })`);
      assert.equal(state.path, path);
      assert.ok(state.scrollWidth <= state.width + 1, JSON.stringify(state));
      assert.ok(state.font >= 16 && state.line >= 24);
      assert.equal(state.lang, "en");
      for (const link of ["/imprint", "/privacy-policy", "mailto:info@vco-esports.com"]) assert.ok(state.links.includes(link));
      assert.doesNotMatch(state.cookies, /sidebar:state/);
      if (path === "/imprint") assert.match(state.text, /DE331164657/);
      else {
        assert.match(state.text, /no automatic account-expiry/i);
        assert.match(state.text, /does not constitute blanket consent/);
        assert.match(state.text, /outside the EU\/EEA/);
      }
    }
    await browser.evaluate("document.querySelector('nav[aria-label=\"Legal information\"] a[href=\"/imprint\"]').click()");
    await browser.wait("location.pathname==='/imprint' && document.title==='Imprint | VCO Media Database'");
    await browser.command("Page.navigate", { url: new URL("/auth", base).href });
    await browser.wait("!!document.querySelector('#login-username') && !!document.querySelector('a[href=\"/privacy-policy\"]')");
    assert.equal(await browser.evaluate("document.querySelectorAll('input[type=checkbox]').length"), 0);
    assert.match(await browser.evaluate("document.body.innerText"), /information, not a consent requirement/);
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});

test("creator information and legal links remain available before and after verification", { timeout: 45000 }, async () => {
  const browser = await uiBrowser();
  let verified = false;
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    const data = path === "/api/user" ? {
      id: 880001, username: "Legal fixture", email: "fixture@example.test", isAdmin: false,
      isCreator: false, creatorStatus: "none", suspended: false,
      emailVerifiedAt: verified ? "2026-10-10T12:00:00Z" : null,
    } : [];
    void browser.command("Fetch.fulfillRequest", { requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(data)).toString("base64") });
  });
  try {
    await browser.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    for (const isVerified of [false, true]) {
      verified = isVerified;
      await browser.command("Page.navigate", { url: new URL("/creator/apply", base).href });
      await browser.wait(isVerified
        ? "document.body.innerText.toLowerCase().includes('activate creator access')"
        : "document.body.innerText.toLowerCase().includes('verify your email first')");
      assert.equal(await browser.evaluate("!!document.querySelector('a[href=\"/imprint\"]') && !!document.querySelector('a[href=\"/privacy-policy\"]')"), true);
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
      if (isVerified) {
        const text = await browser.evaluate("document.body.innerText");
        assert.match(text, /does not grant a licence/);
        assert.match(text, /automated safety checks/);
        assert.equal(await browser.evaluate("document.querySelectorAll('input[type=checkbox]').length"), 0);
      }
    }
    assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
