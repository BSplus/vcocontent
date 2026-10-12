import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const source = path => readFile(path, "utf8");
const gameSources = [
  ["iRacing", "https://www.iracing.com/terms-use-eula/", "Terms of Use and EULA"],
  ["iRacing", "https://www.iracing.com/eu-terms-use-eula/", "Supplemental EU Terms"],
  ["iRacing", "https://www.iracing.com/broadcast-policy/", "Broadcast Policy"],
  ["Le Mans Ultimate", "https://store.steampowered.com/eula/2399420_eula_1", "End User Access and License Agreement"],
  ["RaceRoom", "https://game.raceroom.com/en/about/eula/", "End-User Licence Agreement"],
  ["Gran Turismo 7", "https://www.playstation.com/en-gb/legal/software-eula/", "PlayStation Software Application End User Licence Agreement"],
  ["Gran Turismo 7", "https://www.playstation.com/en-gb/legal/psn-terms-of-service/", "PlayStation Terms of Service"],
  ["Assetto Corsa Competizione", "https://store.steampowered.com/eula/805550_eula_0", "End-User License Agreement"],
];

test("game-provider notice uses reviewed official sources without granting rights or binding visitors", async () => {
  const [imprint, draft, report] = await Promise.all([
    "client/src/pages/imprint.tsx", "docs/gallery-creator-terms-review.md",
    "docs/legal-change-and-gap-report.md",
  ].map(source));
  for (const [game, url, label] of gameSources) {
    assert.ok(imprint.includes(`<strong>${game}:</strong>`), game);
    assert.ok(imprint.includes(`<a href="${url}">${label}</a>`), url);
    assert.ok(report.includes(url), `source report: ${url}`);
    assert.ok(draft.includes(game), `review draft: ${game}`);
  }
  for (const document of [imprint, draft]) {
    const text = document.replace(/\s+/g, " ");
    assert.match(text, /in addition to the photographer’s rights/);
    assert.match(text, /[Cc]reation, upload, publication and reuse/);
    assert.match(text, /applicable media or content policies/);
    assert.match(text, /do not replace any required\s+third-party rights or permissions/);
    assert.match(text, /Statutorily permitted uses and mandatory rights remain unaffected/);
    assert.match(text, /[Nn]on-exhaustive/);
    assert.match(text, /do not incorporate\s+third-party terms into a contract with VCO/);
    assert.match(text, /partnership with or endorsement by the named providers/);
    assert.doesNotMatch(text, /you (?:must|shall) accept|indemnify|hold harmless|private use (?:is )?permitted/i);
  }
  assert.match(imprint, /does not require visitors to accept third-party terms merely to browse/);
  assert.match(imprint, /not a general photo-reuse licence/);
  assert.match(imprint, /UK pages with regional provisions/);
  assert.match(imprint, /console\/platform terms may differ/);
  for (const section of [3, 5]) {
    const part = draft.split(`## ${section}.`)[1].split("## ")[0];
    assert.match(part, /third-party rights/);
  }
  assert.match(draft, /^# Gallery & Creator Terms — REVIEW DRAFT, NOT IN FORCE/);
  assert.match(report, /geprüft am 12\. Oktober 2026/);
  assert.match(report, /Offene juristische Prüfung/);
});

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
      assert.ok(html.includes(`<title data-vco-seo="true">${title} | VCO Media Database</title>`));
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
       if (path === "/imprint") {
         assert.match(state.text, /DE331164657/);
         const games = await browser.evaluate(`(() => {
           const section = document.querySelector('section[aria-labelledby="game-content-conditions"]');
           return { text:section.innerText, links:[...section.querySelectorAll('a')].map(a=>({
             href:a.getAttribute('href'), label:a.textContent, game:a.closest('li').querySelector('strong').textContent
           })), overflow:[...section.querySelectorAll('a,li,p,h2')].some(el=>el.getBoundingClientRect().right>innerWidth+1),
           checkboxes:document.querySelectorAll('input[type=checkbox]').length };
         })()`);
         assert.equal(games.links.length, gameSources.length);
         for (const [game, href, label] of gameSources) {
           assert.ok(games.links.some(link => link.game === `${game}:` && link.href === href && link.label === label), href);
         }
         assert.equal(games.overflow, false);
         assert.equal(games.checkboxes, 0);
         assert.match(games.text, /do not replace any required third-party rights or permissions/);
         assert.match(games.text, /Statutorily permitted uses and mandatory rights remain unaffected/);
         assert.match(games.text, /do not incorporate third-party terms into a contract with VCO/);
       }
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
