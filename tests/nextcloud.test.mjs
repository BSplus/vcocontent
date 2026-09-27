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

test("multiple links, recursive folders, mixed files and access failures", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({ path: new URL(url).pathname, options });
    const path = new URL(url).pathname;
    const entries = path === "/public.php/dav/files/abc/" ?
      [["/public.php/dav/files/abc/sub/", true], ["/public.php/dav/files/abc/readme.txt"], ["/public.php/dav/files/abc/one.jpg"]] :
      path === "/public.php/dav/files/abc/sub/" ?
        [["/public.php/dav/files/abc/sub/two.png"]] :
        [["/remote.php/dav/files/admin/Other/three.webp"]];
    return new Response(dav(path, entries), { status: 207 });
  };
  try {
    const found = await discover([
      { link: `${base}/s/abc`, password: "private" },
      { link: `${base}/apps/files/files/3?dir=/Other` },
    ]);
    assert.equal(found.files.length, 3);
    assert.equal(found.skipped, 1);
    assert.equal(seen.length, 3);
    assert.ok(seen.every(entry => entry.options.redirect === "manual" && entry.options.method === "PROPFIND"));
    assert.equal(Buffer.from(seen[0].options.headers.Authorization.slice(6), "base64").toString(), "abc:private");
    globalThis.fetch = async () => new Response("", { status: 401 });
    await assert.rejects(() => discover([{ link: `${base}/s/abc`, password: "bad" }]), /Kein Zugriff/);
    globalThis.fetch = async () => new Response("", { status: 302, headers: { Location: "http://127.0.0.1/" } });
    await assert.rejects(() => discover([{ link: `${base}/s/abc` }]), /HTTP 302/);
    globalThis.fetch = async () => new Response(dav("/public.php/dav/files/abc/", [["/remote.php/dav/files/admin/private.jpg"]]), { status: 207 });
    await assert.rejects(() => discover([{ link: `${base}/s/abc` }]), /außerhalb/);
  } finally { globalThis.fetch = originalFetch; }
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

test("a dual-role admin creates an admin album and can start its Nextcloud import", async () => {
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
    if (new URL(url).origin !== base) return originalFetch(url, options);
    return new Response(dav("/public.php/dav/files/abc/", []), { status: 207 });
  };
  let eventId;
  try {
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
      body: JSON.stringify({ sources: [{ link: `${base}/s/abc` }] }),
    });
    assert.equal(started.status, 202, await started.text());
    for (let attempt = 0; attempt < 20; attempt++) {
      if ((await importStatus(eventId)).status === "completed") break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal((await importStatus(eventId)).status, "completed");
  } finally {
    globalThis.fetch = originalFetch;
    if (eventId) await storage.deleteEvent(eventId);
    await new Promise(resolve => server.close(resolve));
  }
});