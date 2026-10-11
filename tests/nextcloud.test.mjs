import test from "node:test";
import assert from "node:assert/strict";
import { discover, resolveSource } from "../server/nextcloud.ts";
import { startImport, importStatus, stopImportWorker, updateGallery } from "../server/nextcloud.ts";
import { readSources, saveSources } from "../server/nextcloud-sources.ts";
import { db } from "../server/db.ts";
import { nextcloudSources, mediaAnalysisJobs } from "../shared/schema.ts";
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stopAnalysisWorker } from "../server/analysis-jobs.ts";
import { pool } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import sharp from "sharp";
import express from "express";
import { once } from "node:events";
import { registerRoutes } from "../server/routes.ts";
import { eventCreateRoute } from "../client/src/lib/event-create-route.ts";

const base = "https://cloud.example.invalid";
const publicBase = "https://nextcloud.bs-plus.de";
const vcoBase = "https://nextcloud.vco-motorsports.com";
const syntheticToken = "TEST_ONLY_NOT_A_REAL_SHARE";
const previous = {
  base: process.env.NEXTCLOUD_BASE_URL,
  user: process.env.NEXTCLOUD_USERNAME,
  password: process.env.NEXTCLOUD_APP_PASSWORD,
};
process.env.NEXTCLOUD_BASE_URL = base;
process.env.NEXTCLOUD_USERNAME = "admin";
process.env.NEXTCLOUD_APP_PASSWORD = "test-app-password";
test.after(async () => {
  await stopImportWorker();
  await stopAnalysisWorker();
  await storage.cleanupObjects();
  await pool.end();
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

// Provider mocks must not intercept HTTP API calls or App Storage's transport.
function mockOrigin(origin, handler, transport = globalThis.fetch) {
  return (url, options) => new URL(url).origin === origin
    ? handler(url, options) : transport(url, options);
}

test("persistent private sources, password edits, restart and non-destructive current-run updates", { timeout: 60000 }, async () => {
  const event = await storage.createEvent({ title: "Source persistence", description: "Synthetic only", date: new Date() });
  const creator = await storage.createUser({ username: `nc-owner-${Date.now()}`, email: `nc-${Date.now()}@example.invalid`, password: "synthetic-hash" });
  const gallery = await storage.createEvent({ title: "Creator boundary", description: "Synthetic only", date: new Date(), creatorId: creator.id });
  const transport = globalThis.fetch;
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: "red" } }).jpeg().toBuffer();
  const link = `${base}/s/SYNTHETIC_PERSISTENT`;
  const second = `${base}/s/SYNTHETIC_SECOND`;
  let password = "synthetic-private";
  let entries = ["first.jpg"];
  let denied = false;
  let gets = 0, propfinds = 0;
  globalThis.fetch = mockOrigin(base, (url, options) => {
    const pathname = new URL(url).pathname;
    if (options.method === "PROPFIND") {
      propfinds++;
      if (denied) return new Response("", { status: 403 });
      assert.equal(Buffer.from(options.headers.Authorization.slice(6), "base64").toString(),
        `${pathname.includes("SYNTHETIC_SECOND") ? "SYNTHETIC_SECOND:" : "SYNTHETIC_PERSISTENT:" + password}`);
      return new Response(dav(pathname, pathname.includes("SYNTHETIC_SECOND") ? [] :
        entries.map(name => [pathname + name, false, image.length])), { status: 207 });
    }
    gets++;
    return new Response(image);
  }, transport);
  const finish = async () => {
    for (let i = 0; i < 150; i++) {
      const status = await importStatus(event.id);
      if (["completed", "partial", "error"].includes(status.status)) return status;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Gallery update timed out");
  };
  let admin = true, authenticated = true, server;
  const openApi = async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = authenticated ? { id: 42, isAdmin: admin, isCreator: !admin } : undefined;
      req.isAuthenticated = () => authenticated;
      next();
    });
    server = await registerRoutes(app, { workers: false });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    return `http://127.0.0.1:${server.address().port}`;
  };
  let address = await openApi();
  const api = (suffix, body) => transport(`${address}/api/admin/events/${event.id}/nextcloud${suffix}`,
    body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.deepEqual(await readSources(event.id), []);
    const savedResponse = await api("/sources", { sources: [{ link, password }, { link: second }] });
    assert.equal(savedResponse.status, 200);
    const saved = (await savedResponse.json()).sources;
    assert.equal(saved.length, 2); assert.equal(saved[0].hasPassword, true);
    assert.ok(!JSON.stringify(saved).includes(password));
    assert.equal(propfinds, 0, "saving does not scan");
    const [encrypted] = await db.select().from(nextcloudSources).where(eq(nextcloudSources.eventId, event.id));
    assert.ok(!encrypted.encrypted.includes("SYNTHETIC_PERSISTENT"));
    assert.ok(!encrypted.encrypted.includes(password));
    // Separate Node process proves persistence does not rely on a module cache.
    const restarted = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import {readSources} from './server/nextcloud-sources.ts'; import {pool} from './server/db.ts';
       console.log(JSON.stringify(await readSources(${event.id}))); await pool.end();`]);
    assert.deepEqual(JSON.parse(restarted.stdout.trim()), saved);
    await new Promise(resolve => server.close(resolve)); address = await openApi();
    assert.deepEqual((await (await api("/sources")).json()).sources, saved);
    for (const role of ["anonymous", "creator"]) {
      authenticated = role !== "anonymous"; admin = false;
      for (const suffix of ["/sources", "/update", "/preview"])
        assert.equal((await api(suffix, { sources: [] })).status, authenticated ? 403 : 401);
      assert.equal((await api("/sources")).status, authenticated ? 403 : 401);
    }
    authenticated = true; admin = true;
    assert.equal((await transport(`${address}/api/admin/events/${gallery.id}/nextcloud/sources`)).status, 404);
    assert.equal((await transport(`${address}/api/admin/events/${gallery.id}/nextcloud/update`, { method: "POST" })).status, 404);
    assert.ok(!JSON.stringify(await (await transport(`${address}/api/events/${event.id}`)).json()).includes(link));
    await saveSources(event.id, saved.map(source => ({ id: source.id, link: source.link })));
    assert.equal((await api("/update", {})).status, 202);
    assert.deepEqual((await finish()).run, { found: 1, existing: 0, imported: 1, skipped: 0, failed: 0 });
    // Initial analysis must settle before comparing an unchanged job across updates.
    await stopAnalysisWorker();
    const [item] = await storage.getMediaItems(event.id);
    await storage.updateMediaItem(item.id, { caption: "Preserved manual caption", tags: ["manual-tag"] });
    const before = await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id));
    await stopImportWorker();
    entries.push("new.jpg");
    await updateGallery(event.id);
    assert.deepEqual((await finish()).run, { found: 2, existing: 1, imported: 1, skipped: 0, failed: 0 });
    assert.deepEqual(await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId, item.id)), before);
    await stopImportWorker();
    await updateGallery(event.id);
    assert.deepEqual((await finish()).run, { found: 2, existing: 2, imported: 0, skipped: 0, failed: 0 });
    assert.equal(gets, 2, "existing files never downloaded again");
    assert.equal((await storage.getMediaItem(item.id)).caption, "Preserved manual caption");
    assert.deepEqual((await storage.getMediaItem(item.id)).tags, ["manual-tag"]);
    await stopImportWorker();
    password = "replacement";
    await saveSources(event.id, [{ ...saved[0], password }]);
    assert.equal((await readSources(event.id)).length, 1, "removed source only removes source");
    await updateGallery(event.id); await finish(); await stopImportWorker();
    password = "";
    await saveSources(event.id, [{ id: saved[0].id, link, removePassword: true }]);
    assert.equal((await readSources(event.id))[0].hasPassword, false);
    entries = [];
    await updateGallery(event.id);
    assert.deepEqual((await finish()).run, { found: 0, existing: 0, imported: 0, skipped: 0, failed: 0 });
    assert.equal((await storage.getMediaItems(event.id)).length, 2);
    await stopImportWorker();
    denied = true;
    const errorResponse = await api("/update", {});
    assert.equal(errorResponse.status, 400);
    const error = await errorResponse.json();
    assert.match(error.error, /Access.*denied/);
    assert.ok(!JSON.stringify(error).includes("SYNTHETIC"));
    assert.equal((await importStatus(event.id)).status, "error");
    assert.equal((await readSources(event.id)).length, 1);
    assert.equal((await storage.getMediaItems(event.id)).length, 2);
    denied = false;
    process.env.NEXTCLOUD_BASE_URL = "https://changed.example.invalid";
    const calls = propfinds;
    await assert.rejects(() => updateGallery(event.id), /not supported/);
    assert.equal(propfinds, calls);
    process.env.NEXTCLOUD_BASE_URL = base;
    // Concurrent scan starts are rejected before another scan or transfer.
    const originalMock = globalThis.fetch;
    let release;
    globalThis.fetch = mockOrigin(base, async (url, options) => {
      if (options.method === "PROPFIND") await new Promise(resolve => { release = resolve; });
      return originalMock(url, options);
    }, transport);
    const scan = updateGallery(event.id);
    while (!release) await new Promise(resolve => setTimeout(resolve, 20));
    await assert.rejects(() => updateGallery(event.id), /already running/);
    release(); await scan; await finish(); await stopImportWorker();
    await saveSources(event.id, []);
    assert.deepEqual(await readSources(event.id), []);
    await assert.rejects(() => updateGallery(event.id), /1 to 10/);
    await storage.deleteEvent(event.id);
    assert.deepEqual(await db.select().from(nextcloudSources).where(eq(nextcloudSources.eventId, event.id)), []);
  } finally {
    process.env.NEXTCLOUD_BASE_URL = base;
    await stopImportWorker();
    globalThis.fetch = transport;
    await storage.deleteEvent(event.id); await storage.deleteEvent(gallery.id);
    await pool.query("delete from users where id=$1", [creator.id]);
    await new Promise(resolve => server.close(resolve));
  }
});

test("both trusted public instances preserve configured origins and installation paths", () => {
  try {
    for (const configured of [undefined, base, `${vcoBase}/nextcloud`]) {
      if (configured) process.env.NEXTCLOUD_BASE_URL = configured;
      else delete process.env.NEXTCLOUD_BASE_URL;
      delete process.env.NEXTCLOUD_USERNAME;
      delete process.env.NEXTCLOUD_APP_PASSWORD;
      for (const origin of [publicBase, vcoBase]) {
        for (const form of ["/s/", "/index.php/s/"]) {
          const source = resolveSource({ link: `${origin}${form}${syntheticToken}?path=%2FRace%20photos%2FDay1`, password: "synthetic-password" });
          assert.equal(source.base.origin, origin);
          assert.equal(source.root.href, `${origin}/public.php/dav/files/${syntheticToken}/Race%20photos/Day1/`);
          assert.equal(Buffer.from(source.auth.slice(6), "base64").toString(), `${syntheticToken}:synthetic-password`);
        }
        assert.throws(() => resolveSource({ link: `${origin}/apps/files/files/12?dir=/Album` }), /Internal Nextcloud access/);
      }
      if (configured) {
        assert.equal(resolveSource({ link: `${configured}/index.php/s/${syntheticToken}` }).root.href,
          `${configured}/public.php/dav/files/${syntheticToken}/`);
      }
    }
    process.env.NEXTCLOUD_BASE_URL = `${vcoBase}/nextcloud`;
    process.env.NEXTCLOUD_USERNAME = "admin";
    process.env.NEXTCLOUD_APP_PASSWORD = "test-app-password";
    for (const link of [
      `${vcoBase}/nextcloud/apps/files/files/12?dir=/Album`,
      `${vcoBase}/nextcloud/remote.php/dav/files/admin/Album`,
    ]) {
      assert.equal(resolveSource({ link }).root.href, `${vcoBase}/nextcloud/remote.php/dav/files/admin/Album/`);
    }
  } finally {
    process.env.NEXTCLOUD_BASE_URL = base;
    process.env.NEXTCLOUD_USERNAME = "admin";
    process.env.NEXTCLOUD_APP_PASSWORD = "test-app-password";
  }
});

test("VCO public discovery rejects unsafe links, redirects, DAV escapes and import limits without leaking access", async () => {
  const transport = globalThis.fetch;
  let calls = 0;
  const link = `${vcoBase}/index.php/s/${syntheticToken}`;
  const folder = `/public.php/dav/files/${syntheticToken}/`;
  const password = "synthetic-private-password";
  let respond = () => new Response(dav(folder, [[folder + "photo.jpg"]]), { status: 207 });
  globalThis.fetch = mockOrigin(vcoBase, (url, options) => {
    calls++;
    assert.equal(options.redirect, "manual");
    return respond(url, options);
  }, transport);
  try {
    for (const invalid of [
      `https://foreign.example/s/${syntheticToken}`,
      `http://nextcloud.vco-motorsports.com/s/${syntheticToken}`,
      `${vcoBase}:444/s/${syntheticToken}`,
      `https://nextcloud.vco-motorsports.com.evil.example/s/${syntheticToken}`,
      `https://nextcloud-vco-motorsports.com/s/${syntheticToken}`,
      `https://user:password@nextcloud.vco-motorsports.com/s/${syntheticToken}`,
      `${link}#fragment`, `${link}?unexpected=1`, `${link}?path=/../private`,
      `${link}?path=%2F..%2Fprivate`, `${link}?path=%2Fbad%5Cfolder`,
      `${link}?path=%2F%252e%252e%2Fprivate`,
      `${vcoBase}/s/${syntheticToken}%2fprivate`,
      `${vcoBase}/s/${syntheticToken}%5cprivate`,
      `${vcoBase}/s/${syntheticToken}%00`,
    ]) {
      await assert.rejects(() => discover([{ link: invalid }]));
    }
    assert.equal(calls, 0, "unsafe links rejected before fetching");
    for (const [status, expected] of [[401, /Access.*denied/], [403, /Access.*denied/], [404, /not found/], [500, /HTTP 500/]]) {
      respond = () => new Response("", { status });
      await assert.rejects(() => discover([{ link, password }]), error =>
        expected.test(error.message) && !error.message.includes(password) && !error.message.includes(syntheticToken));
    }
    respond = () => { throw new Error(`${link} ${password}`); };
    await assert.rejects(() => discover([{ link, password }]), error =>
      /unreachable/.test(error.message) && !error.message.includes(password) && !error.message.includes(syntheticToken));
    for (const location of ["http://127.0.0.1/", `${vcoBase}/s/OTHER_SYNTHETIC_SHARE`, `${publicBase}/s/OTHER_SYNTHETIC_SHARE`]) {
      respond = () => new Response("", { status: 302, headers: { Location: location } });
      const before = calls;
      await assert.rejects(() => discover([{ link, password }]), /redirected/);
      assert.equal(calls, before + 1, "redirect must never be followed");
    }
    for (const href of [
      `https://other.example${folder}photo.jpg`, `${vcoBase}:444${folder}photo.jpg`,
      "/private/photo.jpg", folder + "bad%2fphoto.jpg", folder + "bad%5cphoto.jpg",
      folder + "%252e%252e/photo.jpg", folder + "../private/photo.jpg",
    ]) {
      respond = () => new Response(dav(folder, [[href]]), { status: 207 });
      await assert.rejects(() => discover([{ link }]), /unsafe|outside/);
    }
    respond = () => new Response(dav(folder, Array.from({ length: 501 }, (_, i) => [folder + `${i}.jpg`])), { status: 207 });
    await assert.rejects(() => discover([{ link }]), /Import limit reached/);
    respond = () => new Response(dav(folder, Array.from({ length: 17 }, (_, i) => [folder + `${i}.jpg`, false, 32 * 1048576])), { status: 207 });
    await assert.rejects(() => discover([{ link }]), /Import limit reached/);
  } finally { globalThis.fetch = transport; }
});

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
  globalThis.fetch = mockOrigin(publicBase, async (url, options) => {
    calls.push({ url: new URL(url), options });
    return new Response(dav("/public.php/dav/files/TEST_ONLY_NOT_A_REAL_SHARE/",
      [["/public.php/dav/files/TEST_ONLY_NOT_A_REAL_SHARE/photo.jpg"]]), { status: 207 });
  }, originalFetch);
  try {
    const link = `${publicBase}/s/TEST_ONLY_NOT_A_REAL_SHARE`;
    const found = await discover([{ link, password: "album-password" }]);
    assert.equal(found.files.length, 1);
    assert.equal(calls[0].url.href, `${publicBase}/public.php/dav/files/TEST_ONLY_NOT_A_REAL_SHARE/`);
    assert.equal(calls[0].options.redirect, "manual");
    assert.equal(Buffer.from(calls[0].options.headers.Authorization.slice(6), "base64").toString(),
      "TEST_ONLY_NOT_A_REAL_SHARE:album-password");
    assert.throws(() => resolveSource({ link: `${publicBase}/apps/files/files/12?dir=/Album` }), /Internal Nextcloud access/);
    assert.throws(() => resolveSource({ link: `${publicBase}/remote.php/dav/files/admin/Album` }), /Internal Nextcloud access/);
    assert.throws(() => resolveSource({ link: "https://other.example/s/abc" }), /not supported/);
    assert.throws(() => resolveSource({ link: "http://nextcloud.bs-plus.de/s/abc" }), /HTTPS/);
    assert.throws(() => resolveSource({ link: "https://nextcloud.bs-plus.de:444/s/abc" }), /not supported/);
    assert.throws(() => resolveSource({ link: "https://nextcloud.bs-plus.de.evil.example/s/abc" }), /not supported/);
    assert.equal(calls.length, 1, "invalid links must be rejected before any network request");
    globalThis.fetch = mockOrigin(publicBase, async () => new Response("", { status: 401 }), originalFetch);
    await assert.rejects(() => discover([{ link, password: "wrong" }]), /Access.*denied/);
    globalThis.fetch = mockOrigin(publicBase, async () => new Response("", { status: 404 }), originalFetch);
    await assert.rejects(() => discover([{ link }]), /not found/);
    globalThis.fetch = mockOrigin(publicBase, async () => { throw new TypeError("network failure"); }, originalFetch);
    await assert.rejects(() => discover([{ link }]), /unreachable/);
    globalThis.fetch = mockOrigin(publicBase, async () => new Response("", { status: 302, headers: { Location: "http://127.0.0.1/" } }), originalFetch);
    await assert.rejects(() => discover([{ link }]), /redirected/);
    globalThis.fetch = mockOrigin(publicBase, async () => new Response(dav("/public.php/dav/files/TEST_ONLY_NOT_A_REAL_SHARE/",
      [["https://other.example/public.php/dav/files/TEST_ONLY_NOT_A_REAL_SHARE/photo.jpg"]]), { status: 207 }), originalFetch);
    await assert.rejects(() => discover([{ link }]), /unsafe Nextcloud path/);
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
  globalThis.fetch = mockOrigin(base, async (url, options) => {
    seen.push({ path: new URL(url).pathname, options });
    const path = new URL(url).pathname;
    const entries = path === "/public.php/dav/files/abc/" ?
      [["/public.php/dav/files/abc/sub/", true], ["/public.php/dav/files/abc/readme.txt"], ["/public.php/dav/files/abc/one.jpg"],
        ["/public.php/dav/files/abc/movie.MP4"]] :
      path === "/public.php/dav/files/abc/sub/" ?
        [["/public.php/dav/files/abc/sub/two.png"], ["/public.php/dav/files/abc/sub/clip.webm"]] :
        [["/remote.php/dav/files/admin/Other/three.webp"], ["/remote.php/dav/files/admin/Other/film.mov"]];
    return new Response(dav(path, entries), { status: 207 });
  }, originalFetch);
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
    globalThis.fetch = mockOrigin(base, async () => new Response("", { status: 401 }), originalFetch);
    await assert.rejects(() => discover([{ link: `${base}/s/abc`, password: "bad" }]), /Access.*denied/);
    globalThis.fetch = mockOrigin(base, async () => new Response("", { status: 302, headers: { Location: "http://127.0.0.1/" } }), originalFetch);
    await assert.rejects(() => discover([{ link: `${base}/s/abc` }]), /redirected/);
    globalThis.fetch = mockOrigin(base, async () => new Response(dav("/public.php/dav/files/abc/", [["/remote.php/dav/files/admin/private.jpg"]]), { status: 207 }), originalFetch);
    await assert.rejects(() => discover([{ link: `${base}/s/abc` }]), /outside/);
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
    assert.ok(first.files.some(file => file.message === "The file could not be imported."));
    assert.ok(first.files.some(file => /^(Image|Video) exceeds the file size limit\.$/.test(file.message || "")));
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

for (const configured of [false, true]) {
 for (const form of ["/s/", "/index.php/s/"]) {
  test(`admin VCO preview and real image import: ${form}, other instance configured=${configured}`, async () => {
    if (configured) process.env.NEXTCLOUD_BASE_URL = base;
    else delete process.env.NEXTCLOUD_BASE_URL;
    delete process.env.NEXTCLOUD_USERNAME;
    delete process.env.NEXTCLOUD_APP_PASSWORD;
    const app = express();
    app.use(express.json());
    let admin = true;
    app.use((req, _res, next) => {
      req.user = { id: 42, isAdmin: admin };
      req.isAuthenticated = () => true;
      next();
    });
    const server = await registerRoutes(app, { workers: false });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = `http://127.0.0.1:${server.address().port}`;
    const transport = globalThis.fetch;
    const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: "red" } }).jpeg().toBuffer();
    const folder = `/public.php/dav/files/${syntheticToken}/Selected%20folder/`;
    let gets = 0;
    globalThis.fetch = mockOrigin(vcoBase, (url, options) => {
      assert.equal(options.redirect, "manual");
      assert.equal(Buffer.from(options.headers.Authorization.slice(6), "base64").toString(), `${syntheticToken}:synthetic-password`);
      const pathname = new URL(url).pathname;
      if (options.method === "PROPFIND") {
        assert.equal(pathname, folder);
        return new Response(dav(folder, [[folder + "photo.jpg", false, image.length]]), { status: 207 });
      }
      assert.equal(options.method, "GET");
      assert.equal(pathname, folder + "photo.jpg");
      gets++;
      return new Response(image, { headers: { "Content-Length": String(image.length) } });
    }, transport);
    const sources = [{ link: `${vcoBase}${form}${syntheticToken}?path=%2FSelected%20folder`, password: "synthetic-password" }];
    const post = (path, body) => transport(address + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    let eventId;
    try {
      admin = false;
      assert.equal((await post("/api/admin/nextcloud/preview", { sources })).status, 403);
      admin = true;
      const preview = await post("/api/admin/nextcloud/preview", { sources });
      assert.equal(preview.status, 200);
      assert.deepEqual(await preview.json(), { count: 1, images: 1, videos: 0, skipped: 0 });
      const created = await post("/api/events", { title: "Synthetic VCO import", description: "Temporary test", date: new Date().toISOString(), visibility: "draft" });
      assert.equal(created.status, 201);
      const event = await created.json();
      eventId = event.id;
      assert.equal(event.creatorId, null);
      const started = await post(`/api/admin/events/${eventId}/nextcloud`, { sources });
      assert.equal(started.status, 202, await started.text());
      let result;
      for (let attempt = 0; attempt < 120; attempt++) {
        const response = await transport(`${address}/api/admin/events/${eventId}/nextcloud`);
        assert.equal(response.status, 200);
        result = await response.json();
        if (["completed", "partial", "error"].includes(result.status)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(result.status, "completed", JSON.stringify(result));
      assert.equal(result.importedImages, 1);
      assert.equal(result.failed, 0);
      assert.equal(gets, 1);
      const media = await storage.getMediaItems(eventId);
      assert.equal(media.length, 1);
      assert.match(media[0].url, /^\/api\/media\/files\/media-.*\.webp$/);
      assert.ok(!JSON.stringify(result).includes("synthetic-password"));
    } finally {
      await stopImportWorker();
      globalThis.fetch = transport;
      if (eventId) await storage.deleteEvent(eventId);
      await new Promise(resolve => server.close(resolve));
      process.env.NEXTCLOUD_BASE_URL = base;
      process.env.NEXTCLOUD_USERNAME = "admin";
      process.env.NEXTCLOUD_APP_PASSWORD = "test-app-password";
    }
  });
 }
}

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
    assert.match((await invalid.json()).error, /Internal Nextcloud access/);
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