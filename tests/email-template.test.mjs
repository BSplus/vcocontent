import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { verificationEmail } from "../server/email-templates/verification.ts";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const origin = "https://email-preview.example.test";
const url = `${origin}/auth#verify=${"a".repeat(64)}`;

test("verification template preserves copy, direct links and a useful text alternative", () => {
  const email = verificationEmail(origin, url);
  assert.equal(email.subject, "Verify your email | VCO");
  assert.match(email.html, /ONE CLICK\.<br>YOU’RE IN\./);
  assert.match(email.text, /ONE CLICK\.\nYOU’RE IN\./);
  assert.match(email.html, />VERIFY EMAIL</);
  assert.doesNotMatch(email.subject, /\[TEST\]/);
  assert.doesNotMatch(email.html, /VCO&nbsp; \/ &nbsp;ACCOUNT|VERIFY EMAIL ADDRESS/);
  assert.match(email.html, /Verify your email address to activate your account and get started\./);
  assert.match(email.text, /Verify your email address to activate your account and get started\./);
  for (const content of [email.html, email.text]) {
    assert.equal((content.match(/Virtual Competition Organisation/g) || []).length, 1);
    assert.match(content, /© Virtual Competition Organisation \(VCO\) GmbH/);
    assert.doesNotMatch(content, /© VCO/);
  }
  assert.match(email.html, /cid:vco-logo/);
  assert.ok(email.html.includes(url));
  assert.ok(email.text.includes(url));
  assert.match(email.text, /60 minutes/);
  assert.match(email.text, /once/i);
  assert.match(email.text, /ignore/i);
  assert.doesNotMatch(email.html, /<script|<iframe|<form|fonts\.google|utm_|tracking|onload=/i);
});

test("verification URL validation rejects foreign, malformed and unsafe links", () => {
  for (const candidate of [
    `https://foreign.example/auth#verify=${"a".repeat(64)}`,
    `${origin}/auth?verify=${"a".repeat(64)}`,
    `${origin}/auth#verify=short`,
    `javascript:alert(1)`,
    `${origin}/auth#verify=${"a".repeat(64)}"><script>`,
  ]) assert.throws(() => verificationEmail(origin, candidate));
  assert.throws(() => verificationEmail("http://email-preview.example.test", url));
});

for (const width of [1280, 390, 320]) {
  for (const scheme of ["light", "dark"]) {
    test(`email browser rendering ${width}px / ${scheme}`, async () => {
      const browser = await uiBrowser();
      try {
        await browser.command("Page.enable");
        await browser.command("Emulation.setDeviceMetricsOverride", {
          width, height: 1050, deviceScaleFactor: 1, mobile: width < 500,
        });
        await browser.command("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-color-scheme", value: scheme }],
        });
        const logo = (await readFile("attached_assets/VCO_2021_reg_White_Trans.png")).toString("base64");
        const html = verificationEmail(origin, url).html.replaceAll("cid:vco-logo", `data:image/png;base64,${logo}`);
        await browser.command("Page.navigate", { url: "about:blank" });
        const { frameTree } = await browser.command("Page.getFrameTree");
        await browser.command("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
        await browser.wait("document.images.length > 0 && [...document.images].every(i => i.complete && i.naturalWidth > 0)");
        const state = await browser.evaluate(`(() => {
          const a = [...document.querySelectorAll('a')].find(a => a.textContent.trim()==='VERIFY EMAIL');
          const r = a?.getBoundingClientRect();
          return {width:innerWidth, fits:document.documentElement.scrollWidth<=innerWidth,
            ctaVisible:!!r && r.width>0 && r.height>=40 && r.left>=0 && r.right<=innerWidth,
            ctaHeight:r?.height,ctaTop:r?.top,
            headlineSize:parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
            target:a?.getAttribute('href'), background:getComputedStyle(document.body).backgroundColor};
        })()`);
        assert.equal(state.width, width);
        assert.equal(state.fits, true);
        assert.equal(state.ctaVisible, true);
        assert.equal(state.target, url);
        assert.ok(state.ctaHeight >= 44 && state.ctaHeight <= 48);
        if (width < 500) {
          assert.equal(state.headlineSize, 29);
          assert.ok(state.ctaTop < 500);
        }
        assert.notEqual(state.background, "rgba(0, 0, 0, 0)");
        const image = await browser.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
        await writeFile(`/tmp/vco-email-${width}-${scheme}.png`, Buffer.from(image.data, "base64"));
      } finally {
        await browser.close();
      }
    });
  }
}
