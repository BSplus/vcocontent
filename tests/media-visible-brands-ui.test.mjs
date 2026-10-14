import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import { pageMetadata } from "../shared/pagination.ts";
import { serveStatic } from "../server/vite.ts";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const poster = color => "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${color}"/></svg>`);
const items = [
  { id: 64301, type: "image", caption: "Brand fixture photo", thumbnail: poster("#b34b38"),
    tags: ["Brand: FERRARI", "pit lane"] },
  { id: 64302, type: "video", caption: "Brand fixture video", thumbnail: poster("#263a4b"),
    tags: ["Brand: FERRARI", "night race"], url: null },
  { id: 64303, type: "image", caption: "Scene-only fixture", thumbnail: poster("#536b54"),
    tags: ["rain", "track"] },
].map(item => ({ ...item, eventId: 64300, downloadCount: 0 }));

async function fixtureServer() {
  const app = express();
  app.get("/api/user", (_req, res) => res.status(401).json({ message: "Fixture signed out" }));
  app.get("/api/media", (_req, res) => res.json({
    ...pageMetadata(items.length, 1, 48),
    items,
  }));
  serveStatic(app, path.resolve("dist/public"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function pressEnter(browser) {
  await browser.command("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r",
  });
  await browser.command("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13,
  });
}

test("visible brands in shared photo/video preview navigate to tag-only search by keyboard", { timeout: 60000 }, async () => {
  const fixture = await fixtureServer();
  const browser = await uiBrowser();
  try {
    const visit = async () => {
      await browser.command("Page.navigate", { url: `${fixture.url}/search?q=fixture` });
      await browser.wait(`document.querySelectorAll("article").length === ${items.length}`);
    };
    const preview = async (label, hasBrand = true) => {
      await browser.evaluate(`document.querySelector(${JSON.stringify(label)}).click()`);
      await browser.wait(`!!document.querySelector('[role="dialog"]')`);
      if (hasBrand) {
        await browser.wait(`document.querySelector('[role="dialog"] a[aria-label="Search media tagged with FERRARI"]') !== null`);
      }
    };

    await visit();
    await preview('button[aria-label="Preview photo: Brand fixture photo"]');
    assert.equal(await browser.evaluate(`document.querySelectorAll('[role="dialog"] section[aria-labelledby="visible-brands-heading"]').length`), 1);
    assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"] h3#visible-brands-heading')?.textContent.trim()`), "Visible brands");
    assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"] a[aria-label="Search media tagged with FERRARI"]')?.textContent.trim()`), "FERRARI");
    assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]').innerText.includes("Brand: FERRARI")`), false,
      "the stored brand tag must not also appear among ordinary scene tags");
    assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]').innerText.includes("pit lane")`), true);

    await browser.evaluate(`document.querySelector('[role="dialog"] a[aria-label="Search media tagged with FERRARI"]').focus()`);
    assert.equal(await browser.evaluate(`document.activeElement?.tagName`), "A", "brand link must accept keyboard focus");
    await pressEnter(browser);
    await browser.wait(`location.pathname === "/search" && location.search.includes("fields=tags") && !document.querySelector('[role="dialog"]')`);
    assert.equal(await browser.evaluate(`new URLSearchParams(location.search).get("q")`), "FERRARI");
    assert.equal(await browser.evaluate(`new URLSearchParams(location.search).get("fields")`), "tags");

    await visit();
    await preview('button[aria-label="Preview video: Brand fixture video"]');
    assert.equal(await browser.evaluate(`!!document.querySelector('[role="dialog"] video')`), false,
      "signed-out fixture keeps video playback unavailable while rendering its preview tags");
    assert.equal(await browser.evaluate(`document.querySelectorAll('[role="dialog"] section[aria-labelledby="visible-brands-heading"]').length`), 1);
    assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]').innerText.includes("Brand: FERRARI")`), false);
    await browser.evaluate(`document.querySelector('[role="dialog"] a[aria-label="Search media tagged with FERRARI"]').focus()`);
    await pressEnter(browser);
    await browser.wait(`location.search.includes("fields=tags") && !document.querySelector('[role="dialog"]')`);
    assert.equal(await browser.evaluate(`new URLSearchParams(location.search).get("q")`), "FERRARI");

    await visit();
    await preview('button[aria-label="Preview photo: Scene-only fixture"]', false);
    assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"] h3#visible-brands-heading')`), null,
      "no Visible brands group is rendered when the media has no brand tags");
    assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]').innerText.includes("rain")`), true);
    assert.deepEqual(browser.errors, []);
  } finally {
    await browser.close();
    await fixture.close();
  }
});
