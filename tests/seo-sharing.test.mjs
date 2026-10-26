import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { seoHtml } from "../server/seo.ts";
import { serveStatic, setupVite } from "../server/vite.ts";
import { storage } from "../server/storage.ts";
import { searchData } from "../server/public-search-data.ts";
import { HOME_TITLE, HOME_DESCRIPTION, SOCIAL_IMAGE } from "../shared/site-metadata.ts";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = "https://photos.example.test";
const thumb = "/api/media/files/thumb-12345678-1234-1234-1234-123456789abc.webp";
const event = { id: 8, title: "Sharing race", date: "2020-01-01", isPremium: false };
const item = { id: 3, eventId: 8, type: "image", caption: null, photographer: "VCO Crew", thumbnail: thumb, isPremium: false, safetyStatus: "legacy" };
const creator = { id: 4, username: "creator", displayName: "Public Creator", isCreator: true, suspended: false, creatorStatus: "approved", profileImage: "/private-avatar", coverImage: "/private-cover" };
const template = await fs.readFile("client/index.html", "utf8");
const render = route => seoHtml({ originalUrl: route, path: "/", get: () => "attacker.invalid" }, template);
const tag = (html, name) => html.match(new RegExp(`<meta[^>]*(?:name|property)="${name}" content="([^"]*)"`))?.[1];

async function fixtures(run) {
  const oldBase = process.env.PUBLIC_SITE_URL;
  const readers = { ...searchData };
  const methods = { getEvent: storage.getEvent, getMediaItem: storage.getMediaItem, getUser: storage.getUser };
  try {
    process.env.PUBLIC_SITE_URL = base;
    searchData.events = async () => [];
    searchData.images = async () => [];
    storage.getEvent = async id => id === 8 ? event : undefined;
    storage.getMediaItem = async id => id === 3 ? item : undefined;
    storage.getUser = async id => id === 4 ? creator : undefined;
    await run();
  } finally {
    Object.assign(searchData, readers); Object.assign(storage, methods);
    if (oldBase === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = oldBase;
  }
}

test("public route copy and complete branded OG/Twitter fallbacks are distinct and accurate", async () => fixtures(async () => {
  const descriptions = new Set();
  for (const route of ["/", "/current-events", "/upcoming-events", "/archive-events", "/creator-events", "/events/8", "/creator/4", "/search", "/imprint", "/privacy-policy"]) {
    const { html } = await render(route);
    descriptions.add(tag(html, "description"));
    assert.equal(tag(html, "og:site_name"), "VCO Media Database");
    assert.equal(tag(html, "og:title"), tag(html, "twitter:title"));
    assert.equal(tag(html, "description"), tag(html, "og:description"));
    assert.equal(tag(html, "description"), tag(html, "twitter:description"));
    assert.equal(tag(html, "og:image"), base + SOCIAL_IMAGE);
    assert.equal(tag(html, "twitter:image"), base + SOCIAL_IMAGE);
    assert.equal(tag(html, "og:image:alt"), tag(html, "twitter:image:alt"));
    assert.equal(tag(html, "og:image:width"), "1200");
    assert.equal(tag(html, "og:image:height"), "630");
    assert.equal(tag(html, "og:image:type"), "image/jpeg");
    assert.equal(tag(html, "twitter:card"), "summary_large_image");
    assert.ok(!html.includes("twitter:site") && !html.includes("twitter:creator"));
    assert.equal((html.match(/<title\b/g) || []).length, 1);
    assert.match(html, /rel="apple-touch-icon"/);
  }
  assert.equal(descriptions.size, 10);
  const home = await render("/");
  assert.equal(tag(home.html, "description"), HOME_DESCRIPTION);
  assert.ok(home.html.includes(HOME_TITLE.replace("&", "&amp;")));
  assert.match(home.html, /"logo":"https:\/\/photos\.example\.test\/brand\/vco-logo-dark\.png"/);
  const profile = await render("/creator/4");
  assert.ok(!profile.html.includes("private-avatar") && !profile.html.includes("private-cover"));
  storage.getEvent = async () => ({ ...event, date: "2099-01-01" });
  assert.match(tag((await render("/events/8")).html, "description"), /Upcoming sim racing event/);
  storage.getEvent = async () => ({ ...event, description: "  Manual description stays unchanged.  " });
  assert.equal(tag((await render("/events/8")).html, "description"), "Manual description stays unchanged.");
}));

test("only guarded previews override branding; unknown sizes and legacy types are omitted", async () => fixtures(async () => {
  searchData.images = async () => [{ ...item, thumbnail: "/original" }, item];
  assert.equal(tag((await render("/events/8")).html, "og:image"), base + "/api/sharing/media/3/image");
  const photo = await render("/media/3");
  assert.match(tag(photo.html, "description"), /Photo by VCO Crew/);
  assert.equal(tag(photo.html, "og:image"), base + "/api/sharing/media/3/image");
  assert.equal(tag(photo.html, "og:image:type"), "image/webp");
  assert.equal(tag(photo.html, "og:image:width"), undefined);
  storage.getMediaItem = async () => ({ ...item, type: "video" });
  const video = await render("/media/3");
  assert.match(tag(video.html, "og:title"), /Sharing race video/);
  assert.match(tag(video.html, "description"), /Video by VCO Crew/);
  assert.doesNotMatch(tag(video.html, "description"), /Photo by/);
  assert.equal(tag(video.html, "robots"), "noindex,follow");
  storage.getMediaItem = async () => ({ ...item, thumbnail: "data:image/png;base64,historical" });
  const legacy = await render("/media/3");
  assert.equal(tag(legacy.html, "og:image:type"), "image/webp");
  assert.match(tag(legacy.html, "og:image"), /sharing\/media\/3\/image$/);
  for (const thumbnail of ["https://storage.invalid/original", "/api/media/files/media-private.jpg", "javascript:evil"]) {
    storage.getMediaItem = async () => ({ ...item, thumbnail });
    const result = await render("/media/3");
    assert.equal(tag(result.html, "og:image"), base + SOCIAL_IMAGE);
    assert.ok(!result.html.includes(thumbnail));
  }
  storage.getMediaItem = async () => ({ ...item, caption: "Secret caption", isPremium: true });
  const denied = await render("/media/3");
  assert.equal(denied.status, 404);
  assert.equal(tag(denied.html, "og:title"), "Page Not Found | VCO Media Database");
  assert.equal(tag(denied.html, "og:image"), base + SOCIAL_IMAGE);
  assert.ok(!denied.html.includes("Secret caption") && !denied.html.includes('rel="canonical"'));
  delete process.env.PUBLIC_SITE_URL;
  const unconfigured = await render("/");
  assert.equal(tag(unconfigured.html, "og:image"), undefined);
  assert.equal(tag(unconfigured.html, "twitter:card"), "summary");
  assert.ok(!unconfigured.html.includes("attacker.invalid"));
}));

test("branded head is idempotent and user copy remains escaped in both card families", async () => fixtures(async () => {
  const caption = 'Race & "Cup" </script><script>alert(1)</script>';
  storage.getMediaItem = async () => ({ ...item, caption });
  const once = await render("/media/3");
  const twice = await seoHtml({ originalUrl: "/media/3" }, once.html);
  assert.equal((twice.html.match(/<title\b/g) || []).length, 1);
  assert.equal((twice.html.match(/property="og:image"/g) || []).length, 1);
  assert.equal((twice.html.match(/rel="apple-touch-icon"/g) || []).length, 1);
  assert.ok(!twice.html.includes(caption));
  assert.match(tag(twice.html, "twitter:title"), /&amp; &quot;Cup&quot; &lt;\/script&gt;/);
}));

async function serverFixture(mode, run) {
  const app = express();
  let slowStarted = false;
  app.use((req, res, next) => {
    if (req.query.fail) return res.status(503).type("html").send("<head><title>Wrong title</title></head>");
    if (req.query.slow) { slowStarted = true; return setTimeout(next, 500); }
    next();
  });
  app.get("/api/user", (_req, res) => res.status(401).json({}));
  app.get("/api/events/8", (_req, res) => res.json(event));
  app.get("/api/media/3", (_req, res) => res.json(item));
  app.get("/api/users/4", (_req, res) => res.json(creator));
  app.get("/api/events/8/media", (_req, res) => res.json({ items: [], page: 1, totalPages: 1, totalItems: 0, hasMore: false }));
  app.get("/api/events/:id", (req, res, next) => /^\d+$/.test(req.params.id) ? res.status(404).json({ error: "Event not found" }) : next());
  app.get("/api/*", (_req, res) => res.json([]));
  const server = createServer(app);
  const vite = mode === "development" ? await setupVite(app, server) : undefined;
  if (!vite) serveStatic(app, path.resolve("dist/public"));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, () => slowStarted); }
  finally {
    await vite?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test("development and production serve real nested metadata and all branded assets", { timeout: 60000 }, async () => fixtures(async () => {
  const expected = { "vco-icon-16.png": 16, "vco-icon-32.png": 32, "vco-icon-48.png": 48, "apple-touch-icon.png": 180, "icon-192.png": 192, "icon-512.png": 512 };
  for (const mode of ["development", "production"]) await serverFixture(mode, async root => {
    for (const route of ["/", "/events/8", "/media/3", "/creator/4"]) {
      const response = await fetch(root + route);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes(`href="${base}${route}"`));
      assert.equal(tag(html, "vco-page-path"), route);
      assert.match(html, /rel="icon"/);
    }
    assert.equal((await fetch(root + "/events/999")).status, 404);
    for (const [file, size] of Object.entries(expected)) {
      const response = await fetch(`${root}/brand/${file}`);
      assert.equal(response.headers.get("content-type"), "image/png");
      const data = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      assert.equal(data.width, size); assert.equal(data.height, size);
    }
    const social = await fetch(root + SOCIAL_IMAGE);
    assert.equal(social.headers.get("content-type"), "image/jpeg");
    const data = await sharp(Buffer.from(await social.arrayBuffer())).metadata();
    assert.equal(data.width, 1200); assert.equal(data.height, 630);
    const ico = Buffer.from(await (await fetch(root + "/brand/favicon.ico")).arrayBuffer());
    assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 3);
    const logo = await fetch(root + "/brand/vco-logo-dark.png");
    assert.equal(logo.headers.get("content-type"), "image/png");
  });
}));

test("React startup, history, rapid navigation and failed metadata never keep the previous route", { timeout: 90000 }, async () => fixtures(async () => serverFixture("production", async (root, slowStarted) => {
  const b = await uiBrowser();
  const snapshot = () => b.evaluate(`({
    title:document.title,
    canonical:document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    image:document.querySelector('meta[property="og:image"]')?.content,
    robots:document.querySelector('meta[name="robots"]')?.content,
    description:document.querySelector('meta[name="description"]')?.content,
    titles:document.querySelectorAll('title').length,
    icons:document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]').length,
    path:document.querySelector('meta[name="vco-page-path"]')?.content
  })`);
  const navigate = async route => {
    await b.evaluate(`history.pushState(null,'',${JSON.stringify(route)})`);
    await b.wait(`document.querySelector('meta[name="vco-page-path"]')?.content === ${JSON.stringify(route.split("?")[0])}`);
  };
  try {
    await b.command("Page.navigate", { url: root + "/events/8" });
    await b.wait("!document.documentElement.hasAttribute('data-app-starting') && document.body.textContent.includes('Sharing race')");
    assert.equal((await snapshot()).title, "Sharing race | VCO Media Database");
    await navigate("/media/3");
    assert.equal((await snapshot()).image, base + "/api/sharing/media/3/image");
    await navigate("/creator/4");
    assert.equal((await snapshot()).image, base + SOCIAL_IMAGE);
    assert.match((await snapshot()).title, /Creator Profile/);
    await b.evaluate("history.back()");
    await b.wait(`document.querySelector('meta[name="vco-page-path"]')?.content === '/media/3'`);
    assert.equal((await snapshot()).image, base + "/api/sharing/media/3/image");
    await b.evaluate("history.forward()");
    await b.wait(`document.querySelector('meta[name="vco-page-path"]')?.content === '/creator/4'`);
    await navigate("/current-events?tag=car");
    assert.equal((await snapshot()).robots, "noindex,follow");
    await b.evaluate("history.pushState(null,'','/current-events?slow=1')");
    for (let i = 0; i < 100 && !slowStarted(); i++) await delay(20);
    assert.ok(slowStarted());
    await navigate("/upcoming-events");
    await delay(700);
    assert.match((await snapshot()).title, /Upcoming Sim Racing Events/);
    await b.evaluate("history.pushState(null,'','/media/3?fail=1')");
    await b.wait("document.title === 'Page unavailable | VCO Media Database'");
    await delay(250);
    const failure = await snapshot();
    assert.equal(failure.canonical, undefined); assert.equal(failure.image, undefined);
    assert.equal(failure.robots, "noindex,follow");
    assert.match(failure.description, /This page is unavailable/);
    await navigate("/events/999");
    assert.equal((await snapshot()).title, "Page Not Found | VCO Media Database");
    assert.equal((await snapshot()).canonical, undefined);
    await navigate("/");
    assert.equal((await snapshot()).title, HOME_TITLE);
    assert.equal((await snapshot()).description, HOME_DESCRIPTION);
    assert.equal((await snapshot()).titles, 1);
    assert.equal((await snapshot()).icons, 7);
    assert.deepEqual(b.errors, []);
  } finally { await b.close(); }
})));
