import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { Client } from "@replit/object-storage";
import sharp from "sharp";
import ws from "ws";

// The route validates the MP4 container signature; it does not transcode videos.
const video = Buffer.from("000000186674797069736f6d0000020069736f6d6d703431", "hex");
const objectKey = /^\/api\/media\/files\/((?:media|thumb)-[0-9a-f-]{36}\.(?:jpg|png|gif|webp|mp4|mov|webm))$/;
const uploadDir = path.join(tmpdir(), "vco-media-uploads");
// This flag is process-local and inherited only by disposable test servers.
if (process.env.VCO_TEST_OBJECTS) process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED = "true";

async function storageKeys(objects) {
  const keys = [];
  for (const prefix of ["media-", "thumb-"]) {
    const result = await objects.list({ prefix });
    assert.equal(result.ok, true, `Cannot inspect ${prefix} storage objects: ${String(result.error)}`);
    keys.push(...result.value.map(item => item.name));
  }
  return new Set(keys);
}

async function temporaryFiles() {
  try {
    return new Set(await readdir(uploadDir));
  } catch (error) {
    if (error.code === "ENOENT") return new Set();
    throw error;
  }
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

async function startServer(port,suffix) {
  const child = spawn(process.execPath, ["--import", "tsx", "--import", "./tests/helpers/beta-provider-preload.mjs", "server/index.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: "development",CREATOR_UPLOAD_TEST_SUFFIX:suffix },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => { output = (output + chunk.toString()).slice(-8000); });
  }
  const url = `http://127.0.0.1:${port}/api/media/files/not-a-media-key`;
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Test server exited before becoming ready:\n${output}`);
      }
      // A response from the port alone might belong to another process if the
      // port was claimed between freePort() and spawn().
      if (!output.includes(`Server running on port ${port}`)) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        continue;
      }
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (response.status === 404) return child;
        throw new Error(`Unexpected test server response: ${response.status}`);
      } catch (error) {
        if (!(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Test server did not become ready:\n${output}`);
  } catch (error) {
    await stopServer(child);
    throw error;
  }
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

function client(base) {
  let cookie = "";
  return async (path, { method = "GET", body, json = false } = {}) => {
    const response = await fetch(new URL(path, base), {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      body: json ? JSON.stringify(body) : body,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return response;
  };
}

async function json(response, status) {
  const text = await response.text();
  assert.equal(response.status, status, text);
  return JSON.parse(text);
}

function multipart(bytes, filename, mime, type, photographer = "  Zoë 李  ") {
  const form = new FormData();
  form.set("type", type);
  form.set("caption", `Smoke test ${type}`);
  form.set("photographer", photographer);
  form.set("file", new Blob([bytes], { type: mime }), filename);
  return form;
}

test("verified creator photo uploads, video rejection, delivery and ownership", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for isolated upload fixtures");
  const image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#6688aa" },
  }).png().toBuffer();
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const objects = new Client();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const owner = client(base);
  const outsider = client(base);
  const anonymous = client(base);
  const suffix = randomUUID().slice(0, 12);
  const accounts = [];
  let eventId;
  let server;

  try {
    server = await startServer(port,suffix);
    for (const [request, role] of [[owner, "owner"], [outsider, "outsider"]]) {
      const username = `upload_smoke_${role}_${suffix}`;
      const user = await json(await request("/api/register", {
        method: "POST",
        json: true,
        body: { username, email: `${username}@example.invalid`, password: `${randomUUID()}Ab!` },
      }), 201);
      accounts.push({ id: user.id, username });
    }

    // Registration deliberately cannot grant roles. Only promote the two IDs
    // returned by this run, and leave every existing account untouched.
    for (const account of accounts) {
      const result = await pool.query(
        "UPDATE users SET is_creator = true, creator_status = 'approved', email_verified_at = now() WHERE id = $1 AND username = $2 RETURNING id",
        [account.id, account.username],
      );
      assert.equal(result.rowCount, 1);
    }

    const csv = new FormData();
    csv.set("file", new Blob(["Number,Team,Car,Drivers\n007,Team One,Porsche,A. Driver\n"], { type: "text/csv" }), "entries.csv");
    await json(await anonymous("/api/events/entries/preview", { method: "POST", body: csv }), 401);
    const draft = await json(await owner("/api/events/entries/preview", { method: "POST", body: csv }), 200);
    assert.deepEqual(draft.rows.map(({ number, team, car, drivers }) => ({ number, team, car, drivers })), [
      { number: "007", team: "Team One", car: "Porsche", drivers: "A. Driver" },
    ]);
    const invalidTitle = `Invalid entries ${suffix}`;
    await json(await owner("/api/creator/events", {
      method: "POST", json: true,
      body: {
        title: invalidTitle, description: "No event must be created", date: new Date().toISOString(),
        entryRows: [draft.rows[0], { ...draft.rows[0], number: "7" }],
      },
    }), 400);
    assert.equal((await pool.query("SELECT id FROM events WHERE title = $1", [invalidTitle])).rowCount, 0);

    const event = await json(await owner("/api/creator/events", {
      method: "POST",
      json: true,
      body: {
        title: `Upload smoke ${suffix}`,
        description: "Disposable creator upload test",
        date: new Date().toISOString(),
        entryRows: draft.rows,
      },
    }), 201);
    eventId = event.id;
    assert.equal(event.creatorId, accounts[0].id);
    assert.deepEqual(await json(await owner(`/api/events/${eventId}/entries`), 200), [
      { number: "007", team: "Team One", car: "Porsche", drivers: "A. Driver",
        manufacturer: "", racingClass: "", discipline: "" },
    ]);

    const details = await json(await owner(`/api/events/${eventId}`, {
      method: "PUT", json: true, body: { round: "Round 3", track: "Hockenheim" },
    }), 200);
    assert.equal(details.round, "Round 3");
    assert.equal(details.track, "Hockenheim");
    await json(await outsider(`/api/events/${eventId}/entries`), 403);
    await json(await anonymous(`/api/events/${eventId}/entries`), 401);
    const entryPreview = await json(await owner(`/api/events/${eventId}/entries/preview`, { method: "POST", body: csv }), 200);
    assert.equal(entryPreview.rows[0].number, "007");
    await json(await outsider(`/api/events/${eventId}/entries/preview`, { method: "POST", body: csv }), 403);
    await json(await outsider(`/api/events/${eventId}/entries`, {
      method: "PUT", json: true, body: { rows: entryPreview.rows },
    }), 403);
    await json(await owner(`/api/events/${eventId}/entries`, {
      method: "PUT", json: true, body: { rows: [{ ...entryPreview.rows[0], number: "7" }, entryPreview.rows[0]] },
    }), 400);
    await json(await owner(`/api/events/${eventId}/entries`, {
      method: "PUT", json: true, body: { rows: entryPreview.rows },
    }), 200);

    const uploaded = [];
    await json(await owner(`/api/events/${eventId}/publish`,{method:"POST",json:true,body:{published:true}}),200);
    await json(await owner(`/api/events/${eventId}/media/upload`,{method:"POST",body:multipart(video,"tiny.mp4","video/mp4","video")}),413);
    for (const [bytes, filename, mime, type] of [
      [image, "tiny.png", "image/png", "image"],
    ]) {
      const media = await json(await owner(`/api/events/${eventId}/media/upload`, {
        method: "POST",
        body: multipart(bytes, filename, mime, type),
      }), 201);
      uploaded.push(media);
      assert.equal(media.photographer, "Zoë 李");
      assert.equal(media.eventId, eventId);
      assert.equal(media.type, type);
      assert.match(media.url, objectKey);
      assert.match(media.thumbnail, objectKey);

      // Automatic tags can briefly invalidate the first safety version.
      // Assert public delivery only after the background job and its new
      // safety version have settled, not in the deliberate private window.
      let settled=false;
      let finalState;
      for (let attempt=0;attempt<60;attempt++) {
        const analysis=await json(await owner(`/api/media/${media.id}/analysis`),200);
        const current=(await json(await owner("/api/creator/media"),200)).find(item=>item.id===media.id);
        assert.ok(current,"Private owner metadata must remain available during safety review");
        finalState={job:analysis.status,jobError:analysis.error,safety:current.safetyStatus,reason:current.safetyReason,version:current.contentVersion,checkedVersion:current.safetyVersion};
        if (analysis.status==="completed" && current.safetyStatus==="approved" &&
          current.safetyVersion===current.contentVersion) { settled=true;break; }
        await new Promise(resolve=>setTimeout(resolve,200));
      }
      assert.ok(settled,`Automatic tags and their safety version must complete: ${JSON.stringify(finalState)}`);
      const thumbnail = await anonymous(media.thumbnail);
      assert.equal(thumbnail.status, 200);
      assert.match(thumbnail.headers.get("content-type") ?? "", /^image\/webp/);
      assert.ok((await thumbnail.arrayBuffer()).byteLength > 0);

      await json(await anonymous(media.url), 401);
      const original = await owner(media.url);
      assert.equal(original.status, 200);
      const delivered = Buffer.from(await original.arrayBuffer());
      if (type === "image") {
        assert.equal(original.headers.get("content-type"), mime);
        assert.deepEqual(delivered, bytes, "Creator download must be byte-identical");
      } else {
        assert.equal(original.headers.get("content-type"), mime);
        assert.deepEqual(delivered, bytes);
      }
    }

    // Automatic tags are a public metadata edit and must pass their own check.
    let listing=[];
    for (let attempt=0;attempt<40;attempt++) {
      listing=await json(await anonymous(`/api/events/${eventId}/media`),200);
      if(uploaded.every(item=>listing.some(row=>row.id===item.id))) break;
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    assert.deepEqual(
      new Set(listing.map((item) => item.id)),
      new Set(uploaded.map((item) => item.id)),
    );
    const longCaption = "Entry 007 — Team One, Porsche, A. Driver. ".repeat(8);
    const updatedImage = await json(await owner(`/api/media/${uploaded[0].id}`, {
      method: "PUT", json: true, body: { caption: longCaption, tags: ["Manual"], photographer: "  José & <Studio>  " },
    }), 200);
    assert.equal(updatedImage.caption, longCaption);
    assert.equal(updatedImage.photographer, "José & <Studio>");
    await json(await owner(`/api/media/${uploaded[0].id}`, {
      method: "PUT", json: true, body: { photographer: "x".repeat(151) },
    }), 400);
    assert.equal((await json(await owner(`/api/media/${uploaded[0].id}`), 200)).photographer, "José & <Studio>");
    await json(await owner(`/api/events/${eventId}/media/upload`, {
      method: "POST", body: multipart(image, "long-credit.png", "image/png", "image", "x".repeat(151)),
    }), 400);
    await json(await outsider(`/api/media/${uploaded[0].id}`, {
      method: "PUT", json: true, body: { caption: "Hijacked" },
    }), 403);
    await json(await owner(`/api/media/${uploaded[0].id}`, {
      method: "PUT", json: true, body: { caption: "x".repeat(1001) },
    }), 400);
    const clearedTags = await json(await owner(`/api/media/${uploaded[0].id}`, {
      method: "PUT", json: true, body: { caption: longCaption, tags: [] },
    }), 200);
    assert.deepEqual(clearedTags.tags, []);
    const untaggedCaption = await json(await owner(`/api/media/${uploaded[0].id}`, {
      method: "PUT", json: true, body: { caption: longCaption + " Edited" },
    }), 200);
    assert.equal(untaggedCaption.caption, longCaption + " Edited");
    await json(await owner(`/api/media/${uploaded[0].id}`, {
      method: "PUT", json: true, body: { caption: longCaption },
    }), 200);
    assert.equal((await json(await owner(`/api/events/${eventId}/media`), 200)).find(item => item.id === uploaded[0].id).caption, longCaption);
    const featured = await json(await anonymous(`/api/media/top/creator/${accounts[0].id}`), 200);
    const imageCard = featured.find(item => item.id === uploaded.find(item => item.type === "image").id);
    assert.ok(imageCard, "new creator image should appear in featured media");
    assert.equal((await anonymous(imageCard.thumbnail)).status, 200);
    assert.equal((await anonymous(imageCard.url)).status, 401);

    // A different approved creator cannot upload into, modify or delete this event,
    // nor delete its media. Verify the records still exist after those attempts.
    await json(await outsider(`/api/events/${eventId}/media/upload`, {
      method: "POST",
      body: multipart(image, "foreign.png", "image/png", "image"),
    }), 403);
    await json(await outsider(`/api/events/${eventId}`, {
      method: "PUT",
      json: true,
      body: { title: "Hijacked" },
    }), 403);
    await json(await outsider(`/api/events/${eventId}`, { method: "DELETE" }), 403);
    for (const media of uploaded) {
      assert.equal((await outsider(`/api/media/${media.id}`, { method: "DELETE" })).status, 403);
    }
    const after = await json(await owner(`/api/events/${eventId}/media`), 200);
    assert.deepEqual(new Set(after.map((item) => item.id)), new Set(uploaded.map((item) => item.id)));
    assert.equal((await pool.query("SELECT title FROM events WHERE id = $1 AND creator_id = $2", [
      eventId, accounts[0].id,
    ])).rows[0]?.title, `Upload smoke ${suffix}`);

    const beforeKeys = await storageKeys(objects);
    const beforeTemp = await temporaryFiles();
    const beforeRows = await pool.query("SELECT id FROM media_items WHERE event_id = $1", [eventId]);
    for (const [label, bytes, filename, mime, type, status] of [
      ["corrupt image", Buffer.from("not a PNG"), "broken.png", "image/png", "image", 400],
      ["truncated image", image.subarray(0, 40), "truncated.png", "image/png", "image", 400],
      ["corrupt video", Buffer.from("not an MP4"), "broken.mp4", "video/mp4", "video", 413],
      ["wrong image MIME", image, "wrong.jpg", "image/jpeg", "image", 400],
      ["wrong video MIME", video, "wrong.webm", "video/webm", "video", 413],
      ["wrong selected type", image, "wrong.png", "image/png", "video", 413],
      ["unsupported MIME", image, "wrong.txt", "text/plain", "image", 400],
    ]) {
      const response = await owner(`/api/events/${eventId}/media/upload`, {
        method: "POST",
        body: multipart(bytes, filename, mime, type),
      });
      const result = await json(response, status);
      assert.ok(result.error, `${label}: expected an error response`);
      const rows = await pool.query("SELECT id FROM media_items WHERE event_id = $1", [eventId]);
      assert.deepEqual(rows.rows.map(row => row.id).sort(), beforeRows.rows.map(row => row.id).sort(),
        `${label}: rejected upload created a media record`);
    }
    // Other tests or creators can upload concurrently to this bucket. Newly
    // created keys belonging to committed records are not rejected-upload leaks.
    const newKeys = [...await storageKeys(objects)].filter(key => !beforeKeys.has(key));
    const allUrls = await pool.query("SELECT url, thumbnail FROM media_items");
    const referenced = new Set(allUrls.rows.flatMap(row => [row.url, row.thumbnail]));
    assert.deepEqual(newKeys.filter(key => !referenced.has(`/api/media/files/${key}`)), [],
      "Rejected upload left an unreferenced storage object");
    assert.deepEqual(await temporaryFiles(), beforeTemp, "Rejected upload left a temporary file");

    // Stop this test's own server completely, then boot a fresh process against
    // the same database and object bucket. The owner keeps the persisted session.
    await stopServer(server);
    server = undefined;
    server = await startServer(port);
    assert.equal((await json(await owner(`/api/events/${eventId}`), 200)).track, "Hockenheim");
    assert.equal((await json(await owner(`/api/events/${eventId}/entries`), 200))[0].number, "007");
    const persisted = await json(await owner(`/api/events/${eventId}/media`), 200);
    assert.equal(persisted.find(item => item.id === uploaded[0].id).caption, longCaption);
    assert.deepEqual(new Set(persisted.map((item) => item.id)), new Set(uploaded.map((item) => item.id)));
    for (const media of uploaded) {
      const restored = persisted.find((item) => item.id === media.id);
      assert.equal(restored.url, media.url);
      assert.equal(restored.thumbnail, media.thumbnail);
      await json(await anonymous(media.url), 401);
      const original = await owner(media.url);
      assert.equal(original.status, 200);
      const delivered = Buffer.from(await original.arrayBuffer());
      if (media.type === "image") {
        assert.equal(original.headers.get("content-type"), "image/png");
        assert.equal((await sharp(delivered).metadata()).format, "png");
      } else {
        assert.equal(original.headers.get("content-type"), "video/mp4");
        assert.deepEqual(delivered, video);
      }
      const thumbnail = await anonymous(media.thumbnail);
      assert.equal(thumbnail.status, 200);
      assert.match(thumbnail.headers.get("content-type") ?? "", /^image\/webp/);
      assert.ok((await thumbnail.arrayBuffer()).byteLength > 0);
    }
  } finally {
    const cleanupErrors = [];
    try { await stopServer(server); } catch (error) { cleanupErrors.push(error); }
    // Save the keys before deleting metadata. Restrict every query to IDs made
    // by this test; never use a broad username prefix or delete shared rows.
    if (eventId && accounts[0]) {
      try {
        const media = await pool.query(
          `SELECT m.url, m.thumbnail FROM media_items m
           JOIN events e ON e.id = m.event_id
           WHERE e.id = $1 AND e.creator_id = $2`,
          [eventId, accounts[0].id],
        );
        for (const row of media.rows) {
          for (const url of [row.url, row.thumbnail]) {
            const key = objectKey.exec(url)?.[1];
            if (!key) {
              cleanupErrors.push(new Error(`Refusing to delete unexpected object URL: ${url}`));
              continue;
            }
            try {
              const result = await objects.delete(key);
              if (!result.ok) throw new Error(`Could not delete ${key}: ${String(result.error)}`);
            } catch (error) { cleanupErrors.push(error); }
          }
        }
        await pool.query(
          `DELETE FROM media_items WHERE event_id IN
           (SELECT id FROM events WHERE id = $1 AND creator_id = $2)`,
          [eventId, accounts[0].id],
        );
        const removed = await pool.query(
          "DELETE FROM events WHERE id = $1 AND creator_id = $2",
          [eventId, accounts[0].id],
        );
        if (removed.rowCount !== 1) cleanupErrors.push(new Error("Test event was not removed"));
      } catch (error) { cleanupErrors.push(error); }
    }
    for (const account of accounts.reverse()) {
      try {
        const removed = await pool.query(
          "DELETE FROM users WHERE id = $1 AND username = $2",
          [account.id, account.username],
        );
        if (removed.rowCount !== 1) cleanupErrors.push(new Error(`Test account was not removed: ${account.username}`));
      } catch (error) { cleanupErrors.push(error); }
    }
    await pool.end();
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Upload test fixture cleanup failed");
  }
});