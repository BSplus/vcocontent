import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import path from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { seoHtml, canonicalRedirect } from "../server/seo.ts";
import { registerSeoRoutes } from "../server/seo-routes.ts";
import { searchData } from "../server/public-search-data.ts";
import { storage } from "../server/storage.ts";
import { ARCHIVE_FAQ } from "../shared/public-content.ts";
import { serveStatic } from "../server/vite.ts";

const base = "https://photos.example.test";
const template = '<!doctype html><html><head></head><body><div id="root"></div></body></html>';
const thumb = "/api/media/files/thumb-12345678-1234-1234-1234-123456789abc.webp";
const gallery = { id: 8, title: 'Race & "Cup"', description: "Published gallery", date: new Date("2026-10-28T12:00:00Z"), isPremium: false };
const photo = { id: 3, eventId: 8, type: "image", caption: "A visible photo", photographer: "Photo Crew", thumbnail: thumb, isPremium: false, url: "/secret-original.jpg", safetyStatus: "legacy" };
const creator = { id: 4, username: "public-user", displayName: "Public Creator", bio: "Race photography", isCreator: true, suspended: false, creatorStatus: "approved", email: "private@example.test", publicContactEmail: "optional@example.test" };

async function fixtures(run) {
  const oldSite = process.env.PUBLIC_SITE_URL;
  const readers = { ...searchData };
  const oldStorage = { getEvent: storage.getEvent, getMediaItem: storage.getMediaItem, getUser: storage.getUser };
  try {
    process.env.PUBLIC_SITE_URL = base;
    searchData.events = async () => [gallery];
    searchData.images = async () => [photo];
    searchData.creators = async () => [creator];
    searchData.counts = async () => ({ events: 501, creators: 1, images: [{ id: 8, total: 501 }] });
    storage.getEvent = async id => id === 8 ? gallery : undefined;
    storage.getMediaItem = async id => id === 3 ? photo : undefined;
    storage.getUser = async id => id === 4 ? creator : undefined;
    await run();
  } finally {
    Object.assign(searchData, readers); Object.assign(storage, oldStorage);
    if (oldSite === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = oldSite;
  }
}
const render = path => seoHtml({ originalUrl: path, path: "/" }, template);
const schema = html => JSON.parse(html.match(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)[1]);

test("public HTML includes real content, protected previews, creator and breadcrumb schema", async () => fixtures(async () => {
  const home = await render("/");
  assert.match(home.html, /Every race\. Every frame\./);
  for (const faq of ARCHIVE_FAQ) assert.ok(home.html.includes(faq.question));
  assert.equal(schema(home.html)["@graph"][0]["@type"], "Organization");
  for (const path of ["/current-events", "/archive-events", "/upcoming-events", "/creator-events"]) {
    const page = await render(path);
    assert.equal(page.status, 200);
    assert.match(page.html, /index,follow,max-image-preview:large/);
    assert.ok(page.html.includes(`${base}${path}`));
  }
  const event = await render("/events/8");
  assert.match(event.html, /<h1>Race &amp; &quot;Cup&quot;<\/h1>/);
  assert.match(event.html, /28 October 2026/);
  assert.match(event.html, /href="\/media\/3"/);
  assert.match(event.html, /alt="A visible photo"/);
  const image = await render("/media/3");
  const graph = schema(image.html)["@graph"];
  assert.equal(graph[0]["@type"], "ImageObject");
  assert.equal(graph[0].contentUrl, base + "/api/sharing/media/3/image");
  assert.equal(graph[0].creator.name, "Photo Crew");
  assert.equal(graph[1]["@type"], "BreadcrumbList");
  assert.equal(graph[1].itemListElement[1].item, base + "/events/8");
  assert.ok(!image.html.includes("secret-original"));
  const profile = await render("/creator/4");
  assert.match(profile.html, /Public Creator/);
  assert.match(profile.html, /href="\/events\/8"/);
  assert.equal(schema(profile.html)["@graph"][0]["@type"], "ProfilePage");
  assert.ok(!profile.html.includes("private@example") && !profile.html.includes("optional@example"));
  const filtered = await render("/events/8?tag=driver");
  assert.match(filtered.html, /content="noindex,follow"/);
  assert.match((await render("/events/8?utm_source=test")).html, /index,follow,max-image-preview/);
}));

test("protected, premium, suspended and unreviewed records never leak into HTML", async () => fixtures(async () => {
  for (const modification of [{ isPremium: true }, { adminHidden: true },
    { creatorId: 4, visibility: "draft", safetyStatus: "legacy" },
    { creatorId: 4, visibility: "published", safetyStatus: "pending" }]) {
    storage.getEvent = async () => ({ ...gallery, title: "Secret gallery name", ...modification });
    const result = await render("/events/8");
    assert.equal(result.status, 404);
    assert.ok(!result.html.includes("Secret gallery name"));
    assert.ok(!result.html.includes("ld+json"));
  }
  storage.getEvent = async () => ({ ...gallery, creatorId: 4, visibility: "published", safetyStatus: "legacy" });
  storage.getUser = async () => ({ ...creator, suspended: true });
  assert.equal((await render("/media/3")).status, 404);
  assert.equal((await render("/creator/4")).status, 404);
  storage.getUser = async () => ({ ...creator, creatorStatus: "rejected" });
  assert.equal((await render("/creator/4")).status, 404);
  storage.getUser = async () => creator;
  storage.getMediaItem = async () => ({ ...photo, caption: "Secret caption", safetyStatus: "pending" });
  const unsafe = await render("/media/3");
  assert.equal(unsafe.status, 404);
  assert.ok(!unsafe.html.includes("Secret caption"));
  storage.getEvent = async () => gallery;
  storage.getMediaItem = async () => ({ ...photo, isPremium: true });
  assert.equal((await render("/media/3")).status, 404);
  for (const thumbnail of ["/original.jpg", "https://cdn.example/original.jpg", "/api/media/files/media-abc.jpg"]) {
    storage.getMediaItem = async () => ({ ...photo, thumbnail });
    const result = await render("/media/3");
    assert.match(result.html, /content="noindex,follow"/);
    assert.ok(!result.html.includes(thumbnail));
  }
  storage.getMediaItem = async () => ({ ...photo, thumbnail: "data:image/png;base64,secret" });
  assert.match((await render("/media/3")).html, /sharing\/media\/3\/image/);
  for (const path of ["/auth", "/account", "/credits", "/admin/dashboard", "/creator/dashboard", "/search?q=driver"]) {
    assert.match((await render(path)).html, /content="noindex,follow"/);
  }
  for (const path of ["/not-a-page", "/media/0", "/events/99999999999999999999999", "/creator/absent"]) {
    assert.equal((await render(path)).status, 404);
  }
}));

test("JSON-LD and HTML escape untrusted descriptions and captions", async () => fixtures(async () => {
  const attack = '</script><script>alert("bad")</script>';
  storage.getMediaItem = async () => ({ ...photo, caption: attack });
  const result = await render("/media/3");
  assert.ok(!result.html.includes(attack));
  assert.equal(schema(result.html)["@graph"][0].name, attack);
}));

test("segmented XML includes preview images and never original or private data; moderation rechecked", async () => fixtures(async () => {
  const app = express(); registerSeoRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  try {
    const get = path => fetch(root + path);
    const indexResponse = await get("/sitemap.xml");
    const index = await indexResponse.text();
    assert.equal(XMLValidator.validate(index), true);
    for (const path of ["/sitemap-pages.xml", "/sitemap-events/1.xml", "/sitemap-events/2.xml", "/sitemap-creators/1.xml", "/sitemap-media/8/1.xml", "/sitemap-media/8/2.xml"]) assert.ok(index.includes(path));
    const mediaResponse = await get("/sitemap-media/8/1.xml");
    const xml = await mediaResponse.text();
    assert.equal(mediaResponse.headers.get("cache-control"), "private, no-store");
    assert.equal(XMLValidator.validate(xml), true);
    const parsed = new XMLParser().parse(xml).urlset.url;
    assert.equal(parsed.loc, base + "/media/3");
    assert.equal(parsed["image:image"]["image:loc"], base + thumb);
    assert.ok(!xml.includes("secret-original"));
    for (const path of ["/sitemap-pages.xml", "/sitemap-events/1.xml", "/sitemap-creators/1.xml"]) {
      const response = await get(path);
      assert.equal(response.status, 200);
      assert.equal(XMLValidator.validate(await response.text()), true);
    }
    let robots = await (await get("/robots.txt")).text();
    assert.match(robots, /Allow: \/api\/media\/files\/thumb-/);
    assert.match(robots, /Disallow: \/api\//);
    storage.getEvent = async () => ({ ...gallery, adminHidden: true });
    assert.equal((await get("/sitemap-media/8/1.xml")).status, 404);
    for (const path of ["/sitemap-media/0/1.xml", "/sitemap-media/8/0.xml", "/sitemap-events/900719925474099999.xml"]) assert.equal((await get(path)).status, 404);
    delete process.env.PUBLIC_SITE_URL;
    assert.equal((await get("/sitemap.xml")).status, 404);
    robots = await (await get("/robots.txt")).text();
    assert.equal(robots, "User-agent: *\nDisallow: /\n");
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}));

test("canonical migration redirects only explicitly configured HTTPS old origin", async () => fixtures(async () => {
  const previous = process.env.PUBLIC_PREVIOUS_SITE_URL;
  const req = { method: "GET", protocol: "https", originalUrl: "/events/8?utm_source=share", get: () => "old.example.test" };
  try {
    delete process.env.PUBLIC_PREVIOUS_SITE_URL;
    assert.equal(canonicalRedirect(req), null);
    process.env.PUBLIC_PREVIOUS_SITE_URL = "https://old.example.test";
    assert.equal(canonicalRedirect(req), base + "/events/8?utm_source=share");
    assert.equal(canonicalRedirect({ ...req, get: () => "attacker.example" }), null);
    assert.equal(canonicalRedirect({ ...req, method: "POST" }), null);
    assert.equal(canonicalRedirect({ ...req, protocol: "http" }), null);
    process.env.PUBLIC_PREVIOUS_SITE_URL = "https://user:pass@old.example.test";
    assert.equal(canonicalRedirect(req), null);
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_PREVIOUS_SITE_URL;
    else process.env.PUBLIC_PREVIOUS_SITE_URL = previous;
  }
}));

test("production homepage and nested routes pass through HTML renderer, not bare static index", async () => fixtures(async () => {
  const app = express(); serveStatic(app, path.resolve("dist/public"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ["/", "/events/8", "/media/3", "/creator/4"]) {
      const response = await fetch(root + path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const html = await response.text();
      assert.match(html, /<main>/);
      assert.match(html, /application\/ld\+json/);
      assert.ok(html.includes(`href="${base}${path}"`));
    }
    assert.equal((await fetch(root + "/events/99")).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}));
