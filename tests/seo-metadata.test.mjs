import test from "node:test";
import assert from "node:assert/strict";
import { storage } from "../server/storage.ts";
import { seoHtml, publicSiteUrl } from "../server/seo.ts";

test("public event and image pages return escaped, indexable server HTML", async () => {
  const previousSite = process.env.PUBLIC_SITE_URL;
  const getEvent = storage.getEvent;
  const getMediaItem = storage.getMediaItem;
  const template = "<!doctype html><html><head></head><body>App</body></html>";
  try {
    process.env.PUBLIC_SITE_URL = "https://photos.example.test";
    storage.getEvent = async id => id === 8 ? { id, title: 'Race & "Test" <Cup>', description: "A great <race>", isPremium: false } : undefined;
    storage.getMediaItem = async id => id === 3 ? {
      id, eventId: 8, type: "image", caption: 'Start <script>alert("x")</script>',
      photographer: "VCO & Crew", isPremium: false, thumbnail: "/api/media/files/thumb-12345678-1234-1234-1234-123456789abc.webp",
    } : undefined;
    const event = await seoHtml({ path: "/", originalUrl: "/events/8?source=share" }, template);
    assert.equal(event.status, 200);
    assert.match(event.html, /<title>Race &amp; &quot;Test&quot; &lt;Cup&gt; \| VCO Media Database<\/title>/);
    assert.match(event.html, /name="description" content="A great &lt;race&gt;"/);
    assert.match(event.html, /rel="canonical" href="https:\/\/photos.example.test\/events\/8"/);
    const image = await seoHtml({ path: "/", originalUrl: "/media/3" }, template);
    assert.equal(image.status, 200);
    assert.ok(!image.html.includes("<script>alert"));
    assert.match(image.html, /rel="canonical" href="https:\/\/photos.example.test\/media\/3"/);
    assert.match(image.html, /og:image" content="https:\/\/photos.example.test\/api\/media\/files\/thumb-/);
    assert.equal((await seoHtml({ path: "/", originalUrl: "/events/99" }, template)).status, 404);
    assert.equal((await seoHtml({ path: "/", originalUrl: "/media/99" }, template)).status, 404);
  } finally {
    storage.getEvent = getEvent;
    storage.getMediaItem = getMediaItem;
    if (previousSite === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = previousSite;
  }
});

test("unconfigured or invalid site URLs never become canonical URLs", async () => {
  const previousSite = process.env.PUBLIC_SITE_URL;
  try {
    for (const url of ["http://photos.example.test", "https://photos.example.test/path", "https://user:pass@photos.example.test"]) {
      process.env.PUBLIC_SITE_URL = url;
      assert.equal(publicSiteUrl(), null);
    }
    delete process.env.PUBLIC_SITE_URL;
    const result = await seoHtml({ path: "/" }, "<head></head>");
    assert.match(result.html, /name="robots" content="noindex,follow"/);
    assert.ok(!result.html.includes('rel="canonical"'));
  } finally {
    if (previousSite === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = previousSite;
  }
});