import test from "node:test";
import assert from "node:assert/strict";
import { discover, resolveSource } from "../server/nextcloud.ts";
import { startImport, importStatus } from "../server/nextcloud.ts";
import { storage } from "../server/storage.ts";
import sharp from "sharp";
import express from "express";
import { once } from "node:events";
import { registerRoutes } from "../server/routes.ts";
import { eventCreateRoute } from "../client/src/lib/event-create-route.ts";

const base = "https://cloud.example.invalid";
const publicBase = "https://nextcloud.bs-plus.de";
const previous = {
  base: process.env.NEXTCLOUD_BASE_URL,
  user: process.env.NEXTCLOUD_USERNAME,
  password: process.env.NEXTCLOUD_APP_PASSWORD,
};
process.env.NEXTCLOUD_BASE_URL = base;
process.env.NEXTCLOUD_USERNAME = "admin";
process.env.NEXTCLOUD_APP_PASSWORD = "test-app-password";
test.after(() => {
  for (const [key, value] of Object.entries({
    NEXTCLOUD_BASE_URL: previous.base, NEXTCLOUD_USERNAME: previous.user,
    NEXTCLOUD_APP_PASSWORD: previous.password,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function dav(folder, entries) {
  const response = (href, directory = false, bytes = 12) =>
    `<d:response><d:href>${href}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:resourcetype>${directory ? "<d:collection/>" : ""}</d:resourcetype><d:getcontentlength>${bytes}</d:getcontentlength></d:prop></d:propstat></d:response>`;
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${response(folder, true)}${entries.map(e => response(...e)).join("")}</d:multistatus>`;
}

test("public password, internal account and unsupported target validation", () => {
  const publicSource = resolveSource({ link: `${base}/s/abc`, password: "private" });
  assert.equal(publicSource.root.pathname, "/public.php/dav/files/abc/");
  assert.equal(Buffer.from(publicSource.auth.slice(6), "base64").toString(), "abc:private");
  const internal = resolveSource({ link: `${base}/apps/files/files/12?dir=%2FEvents%2F2026` });
  assert.equal(internal.root.pathname, "/remote.php/dav/files/admin/Events/2026/");
  assert.equal(Buffer.from(internal.auth.slice(6), "base64").toString(), "admin:test-app-password");
  assert.throws(() => resolveSource({ link: "https://other.example/s/abc" }));
  assert.throws(() => resolveSource({ link: `${base}/s/abc?path=/../private` }));
  assert.throws(() => resolveSource({ link: `${base}/apps/files/files/12?dir=%2F..%2Fsecret` }));
  assert.throws(() => resolveSource({ link: `${base}/remote.php/dav/files/another/Events` }));
});

test("operator public shares work without an account, but internal and foreign links do not", async () => {
  delete process.env.NEXTCLOUD_BASE_URL;
  delete process.env.NEXTCLOUD_USERNAME;
  delete process.env.NEXTCLOUD_APP_PASSWORD;
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return new Response(dav("/public.php/dav/files/TEST_ONLY_NOT_A_REAL_SHARE/",
      [["/public.php/dav/files/TEST_ONLY_NOT_A_REAL_SHARE/photo.jpg"]]), { status: 207 });
  };
  try {
    const link = `${publicBase}/s/TEST_ONLY_NOT_A_REAL_SHARE`;
    const found = await discover([{ link, password: "album-password" }]);
    assert.equal(found.files.length, 1);
    assert.equal(calls[0].url.href, `${publicBase}/public.php/dav/files/TEST_ONLY_NOT_A_REAL_SHARE/`);
    assert.equal(calls[0].options.redirect, "manual");
    assert.equal(Buffer.from(calls[0].options.headers.Authorization.slice(6), "base64").toString(),
      "TEST_ONLY_NOT_A_REAL_SHARE:album-password");
    assert.throws(() => resolveSource({ link: `${publicBase}/apps/files/files/12?dir=/Album` }), /Interner Nextcloud-Zugang/);
    assert.throws(() => resolveSource({ link: `${publicBase}/remote.php/dav/files/admin/Album` }), /Interner Nextcloud-Zugang/);
    assert.throws(() => resolveSource({ link: "https://other.example/s/abc" }), /nicht unterstützt/);
    assert.throws(() => resolveSource({ link: "http://nextcloud.bs-plus.de/s/abc" }), /HTTPS/);
    assert.throws(() => resolveSource({ link: "https://nextcloud.bs-plus.de:444/s/abc" }), /nicht unterstützt/);
    assert.throws(() => resolveSource({ link: "https://nextcloud.bs-plus.de.evil.example/s/abc" }), /nicht unterstützt/);
    assert.equal(calls.length, 1, "invalid links must be rejected before any network request");
    globalThis.fetch = async () => new Response("", { status: 401 });
    await assert.rejects(() => discover([{ link, password: "wrong" }]), /Kein Zugriff/);
    globalThis.fetch = async () => new Response("", { status: 404 });
    await assert.rejects(() => discover([{ link }]), /nicht gefunden/);
    globalThis.fetch = async () => { throw new TypeError("network failure"); };
    await assert.rejects(() => discover([{ link }]), /nicht erreichbar/);
    globalThis.fetch = async () => new Response("", { status: 302, headers: { Location: "http://127.0.0.1/" } });
    await assert.rejects(() => discover([{ link }]), /umgeleitet/);
    globalThis.fetch = async () => new Response(dav("/public.php/dav/files/TEST_ONLY_NOT_A_REAL_SHARE/",
      [["https://other.example/public.php/dav/files/TEST_ONLY_NOT_A_REAL_SHARE/photo.jpg"]]), { status: 207 });
    await assert.rejects(() => discover([{ link }]), /unsicherer Nextcloud-Pfad/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXTCLOUD_BASE_URL = base;
    process.env.NEXTCLOUD_USERNAME = "admin";
    process.env.NEXTCLOUD_APP_PASSWORD = "test-app-password";
  }
});

test("multiple links, recursive folders, mixed files and access failures", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({ path: new URL(url).pathname, options });
    const path = new URL(url).pathname;
    const entries = path === "/public.php/dav/files/abc/" ?
      [["/public.php/dav/files/abc/sub/", true], ["/public.php/dav/files/abc/readme.txt"], ["/public.php/dav/files/abc/one.jpg"],
        ["/public.php/dav/files/abc/movie.MP4"]] :
      path === "/public.php/dav/files/abc/sub/" ?
        [["/public.php/dav/files/abc/sub/two.png"], ["/public.php/dav/files/abc/sub/clip.webm"]] :
        [["/remote.php/dav/files/admin/Other/three.webp"], ["/remote.php/dav/files/admin/Other/film.mov"]];
    return new Response(dav(path, entries), { status: 207 });
  };
  try {
    const found = await discover([
      { link: `${base}/s/abc`, password: "private" },
      { link: `${base}/apps/files/files/3?dir=/Other` },
    ]);
    assert.equal(found.files.length, 6);
    assert.equal(found.files.filter(file => file.type === "image").length, 3);
    assert.equal(found.files.filter(file => file.type === "video").length, 3);
    assert.equal(found.skipped, 1);
    assert.equal(seen.length, 3);
    assert.ok(seen.every(entry => entry.options.redirect === "manual" && entry.options.method === "PROPFIND"));
    assert.equal(Buffer.from(seen[0].options.headers.Authorization.slice(6), "base64").toString(), "abc:private");
    globalThis.fetch = async () => new Response("", { status: 401 });
    await assert.rejects(() => discover([{ link: `${base}/s/abc`, password: "bad" }]), /Kein Zugriff/);
    globalThis.fetch = async () => new Response("", { status: 302, headers: { Location: "http://127.0.0.1/" } });
    await assert.rejects(() => discover([{ link: `${base}/s/abc` }]), /umgeleitet/);
    globalThis.fetch = async () => new Response(dav("/public.php/dav/files/abc/", [["/remote.php/dav/files/admin/private.jpg"]]), { status: 207 });
    await assert.rejects(() => discover([{ link: `${base}/s/abc` }]), /außerhalb/);
  } finally { globalThis.fetch = originalFetch; }
});

test("mixed import validates content and size, serves video posters safely, and resumes without duplicates", async () => {
  const originalFetch = globalThis.fetch;
  const event = await storage.createEvent({
    title: "Mixed Nextcloud media", description: "Temporary import test", date: new Date(), isPremium: false,
  });
  const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: "red" } }).jpeg().toBuffer();
  const png = await sharp(jpeg).png().toBuffer();
  const gif = await sharp(jpeg).gif().toBuffer();
  const webp = await sharp(jpeg).webp().toBuffer();
  const mp4 = Buffer.from("00000000667479706d703432", "hex");
  const mov = Buffer.from("000000006674797071742020", "hex");
  const webm = Buffer.from("1a45dfa34286810142828104", "hex");
  const contents = new Map([
    ["one.jpg", jpeg], ["two.png", png], ["three.gif", gif], ["four.webp", webp],
    ["five.mp4", mp4], ["six.mov", mov], ["seven.webm", webm],
    ["wrong.mp4", webm], ["broken.webm", Buffer.from("not webm")],
    ["bad.jpg", Buffer.from("not an image")], ["mismatch.jpg", png],
    ["big.mov", mov], ["overflow.mp4", mp4],
  ]);
  const directory = "/public.php/dav/files/mixed/";
  let repaired = false;
  const getCalls = [];
  globalThis.fetch = async (url, options) => {
    if (new URL(url).origin !== base) return originalFetch(url, options);
    const pathname = new URL(url).pathname;
    if (options.method === "PROPFIND") {
      const entries = pathname === directory
        ? [["one.jpg"], ["two.png"], ["five.mp4"], ["wrong.mp4"], ["bad.jpg"],
          ["mismatch.jpg"], ["big.mov", false, 51 * 1048576], ["overflow.mp4"], ["unknown.txt"], ["sub/", true]]
        : [["three.gif"], ["four.webp"], ["six.mov"], ["seven.webm"], ["broken.webm"]];
      return new Response(dav(pathname, entries.map(([name, directory, size]) =>
        [pathname + name, directory, size ?? contents.get(name)?.length ?? 12])), { status: 207 });
    }
    getCalls.push(pathname);
    const name = pathname.split("/").pop();
    const data = repaired && name === "wrong.mp4" ? mp4
      : repaired && name === "broken.webm" ? webm
      : repaired && (name === "bad.jpg" || name === "mismatch.jpg") ? jpeg : contents.get(name);
    return new Response(data, { status: 200, headers: { "Content-Length": String(name === "overflow.mp4" && !repaired ? 51 * 1048576 : data.length) } });
  };
  const source = [{ link: `${base}/s/mixed` }];
  const finish = async () => {
    for (let i = 0; i < 160; i++) {
      const result = await importStatus(event.id);
      if (["partial", "completed", "error"].includes(result.status)) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Import did not finish");
  };
  try {
    const preview = await discover(source);
    assert.equal(preview.files.filter(file => file.type === "image").length, 6);
    assert.equal(preview.files.filter(file => file.type === "video").length, 6);
    assert.equal(preview.skipped, 2, "unknown and oversized advertised file are skipped");
    await startImport(event.id, source);
    const first = await finish();
    assert.equal(first.status, "partial", JSON.stringify(first));
    assert.equal(first.importedImages, 4);
    assert.equal(first.importedVideos, 3);
    assert.equal(first.failed, 5);
    assert.equal(first.skipped, 2);
    assert.ok(first.warnings <= first.importedImages);
    assert.ok(first.files.filter(file => file.type === "video").every(file => !file.aiWarning));
    assert.ok(getCalls.some(p => p.endsWith("overflow.mp4")));
    assert.ok(!getCalls.some(p => p.endsWith("big.mov") || p.endsWith("unknown.txt")));

    const media = await storage.getMediaItems(event.id);
    assert.equal(media.length, 7);
    for (const item of media) {
      assert.equal(item.type, /\.(mp4|mov|webm)$/i.test(item.caption) ? "video" : "image");
      assert.match(item.thumbnail, /^\/api\/media\/files\/thumb-.*\.webp$/);
      assert.match(item.url, new RegExp(`^/api/media/files/media-.*\\.${item.type === "video"
        ? item.caption.split(".").pop() : "webp"}$`));
    }

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 42, isAdmin: true };
      req.isAuthenticated = () => req.path === "/api/admin/nextcloud/preview";
      next();
    });
    const server = await registerRoutes(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = `http://127.0.0.1:${server.address().port}`;
      const apiPreview = await originalFetch(`${address}/api/admin/nextcloud/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: source }),
      });
      assert.equal(apiPreview.status, 200);
      assert.deepEqual(await apiPreview.json(), { count: 12, images: 6, videos: 6, skipped: 2 });
      const video = media.find(item => item.type === "video");
      const poster = await originalFetch(address + video.thumbnail);
      assert.equal(poster.status, 200);
      assert.equal(poster.headers.get("content-type"), "image/webp");
      assert.equal((await sharp(Buffer.from(await poster.arrayBuffer())).metadata()).format, "webp");
      const denied = await originalFetch(address + video.url);
      assert.equal(denied.status, 401);
      const missing = await originalFetch(address + video.url.replace("media-", "thumb-"));
      assert.equal(missing.status, 404);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }

    repaired = true;
    await startImport(event.id, source);
    const second = await finish();
    assert.equal(second.status, "completed", JSON.stringify(second));
    assert.equal(second.importedImages, 6);
    assert.equal(second.importedVideos, 6);
    assert.equal(second.failed, 0);
    await startImport(event.id, source);
    assert.equal((await finish()).imported, 12);
    assert.equal((await storage.getMediaItems(event.id)).length, 12);
    assert.ok(await storage.getEvent(event.id));
  } finally {
    globalThis.fetch = originalFetch;
    await storage.deleteEvent(event.id);
  }
});

test("a failed image does not block the others, and retry does not duplicate saved images or albums", async () => {
  const originalFetch = globalThis.fetch;
  const event = await storage.createEvent({
    title: "Nextcloud retry test", description: "Temporary import test", date: new Date(), isPremium: false,
  });
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: "red" } }).jpeg().toBuffer();
  let broken = true;
  globalThis.fetch = async (url, options) => {
    if (new URL(url).origin !== base) return originalFetch(url, options);
    const p = new URL(url).pathname;
    if (options.method === "PROPFIND")
      return new Response(dav(p, [["/public.php/dav/files/abc/good.jpg"], ["/public.php/dav/files/abc/bad.jpg"]]), { status: 207 });
    const bytes = p.endsWith("bad.jpg") && broken ? Buffer.from("not a jpeg") : image;
    return new Response(bytes, { status: 200, headers: { "Content-Length": String(bytes.length) } });
  };
  async function finished() {
    for (let attempt = 0; attempt < 120; attempt++) {
      const status = await importStatus(event.id);
      if (["completed", "partial", "error"].includes(status.status)) return status;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error("Import did not complete in time");
  }
  try {
    const sources = [{ link: `${base}/s/abc` }];
    await startImport(event.id, sources);
    const first = await finished();
    assert.equal(first.imported, 1, JSON.stringify(first));
    assert.equal(first.failed, 1);
    assert.equal(first.total, 2);
    broken = false;
    await startImport(event.id, sources);
    const second = await finished();
    assert.equal(second.status, "completed");
    assert.equal(second.imported, 2);
    assert.equal(second.failed, 0);
    await startImport(event.id, sources);
    assert.equal((await finished()).imported, 2);
    assert.equal((await storage.getMediaItems(event.id)).length, 2);
    assert.ok(await storage.getEvent(event.id));
  } finally {
    globalThis.fetch = originalFetch;
    await storage.deleteEvent(event.id);
  }
});

test("admin can preview and import an operator public share without Nextcloud configuration", async () => {
  delete process.env.NEXTCLOUD_BASE_URL;
  delete process.env.NEXTCLOUD_USERNAME;
  delete process.env.NEXTCLOUD_APP_PASSWORD;
  const route = eventCreateRoute({ id: 42, isAdmin: true, isCreator: true }, "nextcloud");
  assert.deepEqual(route, { endpoint: "/api/events" });
  assert.equal(eventCreateRoute({ id: 42, isCreator: true }, "local").endpoint, "/api/creator/events");
  assert.equal(eventCreateRoute({ id: 42, creatorStatus: "approved" }, "local").endpoint, "/api/creator/events");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 42, isAdmin: true, isCreator: true };
    req.isAuthenticated = () => true;
    next();
  });
  const server = await registerRoutes(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (new URL(url).origin !== publicBase) return originalFetch(url, options);
    return new Response(dav("/public.php/dav/files/abc/", []), { status: 207 });
  };
  let eventId;
  try {
    const invalid = await originalFetch(`${address}/api/admin/nextcloud/preview`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: [{ link: `${publicBase}/apps/files/files/12?dir=/Album` }] }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /Interner Nextcloud-Zugang/);
    const preview = await originalFetch(`${address}/api/admin/nextcloud/preview`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: [{ link: `${publicBase}/s/abc`, password: "private" }] }),
    });
    const previewBody = await preview.json();
    assert.equal(preview.status, 200, JSON.stringify(previewBody));
    assert.equal(previewBody.count, 0);
    const created = await originalFetch(address + route.endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Dual-role admin import", description: "Temporary test",
        date: new Date().toISOString(), creatorId: route.creatorId }),
    });
    assert.equal(created.status, 201);
    const event = await created.json();
    eventId = event.id;
    assert.equal(event.creatorId, null);
    const started = await originalFetch(`${address}/api/admin/events/${eventId}/nextcloud`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: [{ link: `${publicBase}/s/abc`, password: "private" }] }),
    });
    assert.equal(started.status, 202, await started.text());
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await importStatus(eventId)).status === "completed") break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal((await importStatus(eventId)).status, "completed");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.NEXTCLOUD_BASE_URL = base;
    process.env.NEXTCLOUD_USERNAME = "admin";
    process.env.NEXTCLOUD_APP_PASSWORD = "test-app-password";
    if (eventId) await storage.deleteEvent(eventId);
    await new Promise(resolve => server.close(resolve));
  }
});