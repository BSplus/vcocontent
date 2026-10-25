import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { build } from "esbuild";
import sharp from "sharp";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

test("gallery preview recovers, caps retries, resets sources and cancels on unmount", { timeout: 75000 }, async () => {
  const output = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import PreviewImage from './client/src/components/preview-image';
    const root=createRoot(document.getElementById('root'));
    window.show=(src)=>flushSync(()=>root.render(<div style={{position:'relative',width:320,height:240}}>
      <PreviewImage src={src} alt="Race preview" /></div>));
    window.hide=()=>flushSync(()=>root.render(null));
    window.show('/image/recover');`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, format: "esm", jsx: "automatic" });
  const pixels = await sharp({ create: { width: 80, height: 60, channels: 3, background: "blue" } }).webp().toBuffer();
  const requests = [];
  const app = express();
  app.get("/", (_req, res) => res.type("html").send('<div id="root"></div><script type="module" src="/fixture.js"></script>'));
  app.get("/fixture.js", (_req, res) => res.type("js").send(output.outputFiles[0].text));
  app.get("/image/:id", (req, res) => {
    requests.push({ id: req.params.id, retry: req.query._previewRetry });
    res.set("Cache-Control", "no-store");
    if (req.params.id === "ok" || req.params.id === "recover" && req.query._previewRetry)
      return res.type("webp").send(pixels);
    res.status(503).set("Retry-After", "5").end();
  });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const browser = await uiBrowser();
  try {
    await browser.command("Page.navigate", { url: `http://127.0.0.1:${server.address().port}` });
    await browser.wait(`document.querySelector('[role=status]')?.textContent==='Retrying preview…'`);
    await delay(6500);
    await browser.wait(`document.querySelector('img')?.naturalWidth===80`);
    assert.equal(requests.filter(r => r.id === "recover").length, 2);
    await browser.evaluate(`window.show('/image/permanent')`);
    await delay(39000);
    await browser.wait(`document.querySelector('[role=status]')?.textContent==='Preview unavailable'`);
    assert.equal(requests.filter(r => r.id === "permanent").length, 4);
    await browser.evaluate(`window.show('/image/replaced')`);
    await browser.wait(`document.querySelector('[role=status]')!=null`);
    await browser.evaluate(`window.show('/image/ok')`);
    await browser.wait(`document.querySelector('img')?.naturalWidth===80`);
    assert.equal(await browser.evaluate(`document.querySelector('img').dataset.previewAttempt`), "0");
    await browser.evaluate(`window.show('/image/unmounted')`);
    await browser.wait(`document.querySelector('[role=status]')!=null`);
    await browser.evaluate(`window.hide()`);
    await delay(6500);
    assert.equal(requests.filter(r => r.id === "replaced").length, 1);
    assert.equal(requests.filter(r => r.id === "unmounted").length, 1);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
