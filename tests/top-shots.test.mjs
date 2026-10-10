import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import sharp from "sharp";
import ws from "ws";
import { db } from "../server/db.ts";
import { events, mediaItems, users } from "../shared/schema.ts";
import { eq } from "drizzle-orm";
import { topShotDownloadName } from "../client/src/lib/top-shot-download.ts";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5000";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function checkTopShotsInBrowser(videoId, photoId, landscapeId, account, password) {
  const child = spawn(process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=/tmp/top-shots-${randomUUID()}`,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let output = "";
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  let socket;
  try {
    const deadline = Date.now() + 15000;
    while (!output.match(/DevTools listening on (ws:\/\/\S+)/) && Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Chromium exited: ${output}`);
      await delay(100);
    }
    const endpoint = output.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
    assert.ok(endpoint, `Chromium did not start: ${output}`);
    socket = new ws(endpoint);
    await once(socket, "open");
    let id = 0;
    const pending = new Map();
    socket.on("message", bytes => {
      const reply = JSON.parse(bytes.toString());
      if (reply.id && pending.has(reply.id)) {
        pending.get(reply.id)(reply);
        pending.delete(reply.id);
      }
    });
    const send = async (method, params = {}, sessionId) => {
      const next = ++id;
      const reply = new Promise(resolve => pending.set(next, resolve));
      socket.send(JSON.stringify({ id: next, method, params, sessionId }));
      const result = await reply;
      if (result.error) throw new Error(`${method}: ${result.error.message}`);
      return result.result;
    };
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Runtime.enable", {}, sessionId);
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async expression => {
      const limit = Date.now() + 25000;
      while (Date.now() < limit) {
        const result = await evaluate(expression);
        if (result) return result;
        await delay(150);
      }
      throw new Error(`Browser condition timed out: ${expression}`);
    };
    for (const width of [390, 1280]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: width === 390 }, sessionId);
      await send("Page.navigate", { url: base }, sessionId);
      await waitFor(`document.querySelector('button[aria-label^="Preview video:"][aria-label$="Media ${videoId}"]') !== null`);
      const state = await evaluate(`(() => {
        const cards = [...document.querySelectorAll('section[aria-labelledby="top-shots-heading"] button[aria-label^="Preview"]')];
        return { cardCount: cards.length, video: cards[0]?.querySelector('img')?.style.objectFit || getComputedStyle(cards[0]?.querySelector('img')).objectFit,
          photo: cards.find(card => card.getAttribute('aria-label').endsWith('Media ${photoId}'))?.querySelector('img')?.getAttribute('class'),
          landscape: cards.find(card => card.getAttribute('aria-label').endsWith('Media ${landscapeId}'))?.querySelector('img')?.getAttribute('class'),
          badge: cards[0]?.innerText.includes('Video'), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      })()`);
      assert.equal(state.cardCount, 3);
      assert.equal(state.video, "contain");
      assert.match(state.photo, /object-contain/);
      assert.match(state.landscape, /object-contain/);
      assert.ok(state.badge);
      assert.equal(state.overflow, false);
      await evaluate(`document.querySelector('button[aria-label$="Media ${videoId}"]').click()`);
      await waitFor(`document.querySelector('[role="dialog"]') !== null`);
      assert.equal(await evaluate(`!!document.querySelector('[role="dialog"] video')`), false);
      assert.equal(await evaluate(`document.querySelector('[role="dialog"]')?.innerText.includes('Sign in to play this video')`), true);
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
      await waitFor(`document.querySelector('[role="dialog"]') === null`);
      await evaluate(`document.querySelector('button[aria-label$="Media ${photoId}"]').click()`);
      await waitFor(`document.querySelector('[role="dialog"] img') !== null`);
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('[role="dialog"] img')).objectFit`), "contain");
      await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
      await waitFor(`document.querySelector('[role="dialog"]') === null`);
    }
    const signedIn = await evaluate(`fetch('/api/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({ username: account.username, password })})}).then(r=>r.ok)`);
    assert.equal(signedIn, true);
    await send("Page.navigate", { url: base }, sessionId);
    await waitFor(`document.querySelector('button[aria-label$="Media ${videoId}"]') !== null && !document.body.innerText.includes('Sign in to play this video')`);
    await evaluate(`document.querySelector('button[aria-label$="Media ${videoId}"]').click()`);
    await waitFor(`document.querySelector('[role="dialog"] video[controls]') !== null`);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"] video').getAttribute('poster').includes('/thumbnail')`), true);
  } finally {
    socket?.close();
    child.kill("SIGTERM");
  }
}

test("top shots rank public photos and videos together without creator or premium media", { timeout: 120000 }, async () => {
  const suffix = randomUUID();
  const password = `fixture-${suffix}`;
  const salt = randomUUID();
  const [account] = await db.insert(users).values({
    username: `top_${suffix}`, email: `top_${suffix}@example.invalid`,
    password: `${scryptSync(password, salt, 64).toString("hex")}.${salt}`,
  }).returning();
  const [official] = await db.insert(events).values({
    title: "Top shots test official", description: "Fixture", date: new Date(), creatorId: null,
  }).returning();
  const [creator] = await db.insert(events).values({
    title: "Top shots test creator", description: "Fixture", date: new Date(), creatorId: account.id,
  }).returning();
  const [premium] = await db.insert(events).values({
    title: "Top shots test premium", description: "Fixture", date: new Date(), creatorId: null, isPremium: true,
  }).returning();
  const ids = [];
  try {
    const poster = await sharp({ create: { width: 360, height: 640, channels: 3, background: "red" } }).jpeg().toBuffer();
    const thumbnail = `data:image/jpeg;base64,${poster.toString("base64")}`;
    const landscapePoster = await sharp({ create: { width: 640, height: 360, channels: 3, background: "blue" } }).jpeg().toBuffer();
    const add = async (eventId, type, count, isPremium = false, preview = thumbnail) => {
      const [item] = await db.insert(mediaItems).values({
        eventId, type, isPremium, downloadCount: count,
        url: type === "video" ? "data:video/mp4;base64,AAAA" : preview,
        thumbnail: preview,
      }).returning();
      ids.push(item.id);
      return item;
    };
    const video = await add(official.id, "video", 2147483647);
    const photo = await add(official.id, "image", 2147483646);
    const landscape = await add(official.id, "image", 2147483645, false, `data:image/jpeg;base64,${landscapePoster.toString("base64")}`);
    const creatorVideo = await add(creator.id, "video", 2147483647);
    const premiumVideo = await add(premium.id, "video", 2147483647);
    const premiumItem = await add(official.id, "video", 2147483647, true);
    const downloadableVideo = await add(official.id, "video", 1);

    const response = await fetch(`${base}/api/media/top-shots`);
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.equal(rows.length, 3);
    assert.equal(rows[0].id, video.id);
    assert.equal(rows[0].type, "video");
    assert.ok(rows.some(row => row.id === photo.id && row.type === "image"));
    assert.ok(rows.some(row => row.id === landscape.id && row.type === "image"));
    for (const item of [creatorVideo, premiumVideo, premiumItem])
      assert.ok(!rows.some(row => row.id === item.id));
    assert.ok(!JSON.stringify(rows).includes("data:"));
    assert.equal(rows[0].thumbnail, `/api/media/legacy/${video.id}/thumbnail`);
    assert.equal((await fetch(`${base}${rows[0].thumbnail}`)).status, 200);
    assert.equal((await fetch(`${base}${rows[0].url}`)).status, 401);
    assert.equal((await fetch(`${base}/api/media/${video.id}/download`, { method: "POST" })).status, 401);
    const login = await fetch(`${base}/api/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: account.username, password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const headers = { Cookie: cookie };
    const authorized = await fetch(`${base}/api/media/${downloadableVideo.id}/download`, { method: "POST", headers });
    assert.equal(authorized.status, 200);
    const { url } = await authorized.json();
    const original = await fetch(new URL(url, base), { headers });
    assert.equal(original.status, 200);
    assert.equal(original.headers.get("content-type"), "video/mp4");
    assert.equal((await fetch(`${base}/api/media/${premiumItem.id}/download`, { method: "POST", headers })).status, 403);
    assert.equal((await fetch(`${base}/api/media/${premiumVideo.id}/download`, { method: "POST", headers })).status, 403);
    await checkTopShotsInBrowser(video.id, photo.id, landscape.id, account, password);
  } finally {
    for (const id of ids) await db.delete(mediaItems).where(eq(mediaItems.id, id));
    for (const event of [official, creator, premium]) await db.delete(events).where(eq(events.id, event.id));
    await db.delete(users).where(eq(users.id, account.id));
  }
});

test("top shots preserve actual photo and video download formats, including poster", () => {
  assert.equal(topShotDownloadName({ id: 1, type: "image" }, "high", "/media/photo.webp", "image/webp"), "media-1-high.webp");
  assert.equal(topShotDownloadName({ id: 1, type: "image" }, "low", "/media/photo.webp", "image/jpeg"), "media-1-low.jpg");
  assert.equal(topShotDownloadName({ id: 2, type: "video" }, "high", "/media/clip.webm", "video/webm"), "media-2-high.webm");
  assert.equal(topShotDownloadName({ id: 2, type: "video" }, "high", "/api/media/legacy/2/file", "video/quicktime"), "media-2-high.mov");
  assert.equal(topShotDownloadName({ id: 2, type: "video" }, "low", "/media/poster.webp", "image/webp"), "media-2-poster.webp");
});

test("top shots cards and preview keep portrait media contained and gate video playback", async () => {
  const source = await readFile(new URL("../client/src/pages/home-page.tsx", import.meta.url), "utf8");
  assert.match(source, /shot\.type === "video".*PlayCircle.*Video/);
  assert.match(source, /shot\.thumbnail.*object-contain/);
  assert.match(source, /selectedMedia\.type === "video" && user && selectedMedia\.url/);
  assert.match(source, /<video key=\{selectedMedia\.id\}.*controls.*max-h-\[65dvh\]/);
  assert.match(source, /selectedMedia\.type === "video" && !user.*Sign in to play/);
  assert.match(source, /selectedMedia\.thumbnail \|\| selectedMedia\.url.*max-h-\[65dvh\].*object-contain/);
  assert.match(source, /selectedMedia\.type === "image" && <DropdownMenuItem.*downloadOptionLabel\(selectedMedia, "low"\)/);
  assert.match(source, /downloadOptionLabel\(selectedMedia, "high"\)/);
});