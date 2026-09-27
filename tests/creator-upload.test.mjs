import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { Client } from "@replit/object-storage";
import sharp from "sharp";
import ws from "ws";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5000";
// The route validates the MP4 container signature; it does not transcode videos.
const video = Buffer.from("000000186674797069736f6d0000020069736f6d6d703431", "hex");
const objectKey = /^\/api\/media\/files\/((?:media|thumb)-[0-9a-f-]{36}\.(?:jpg|png|gif|webp|mp4|mov|webm))$/;
const uploadDir = path.join(tmpdir(), "vco-media-uploads");

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

function client() {
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

function multipart(bytes, filename, mime, type) {
  const form = new FormData();
  form.set("type", type);
  form.set("caption", `Smoke test ${type}`);
  form.set("file", new Blob([bytes], { type: mime }), filename);
  return form;
}

test("creator image/video uploads, delivery and ownership", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for isolated upload fixtures");
  const image = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#6688aa" },
  }).png().toBuffer();
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const objects = new Client();
  const owner = client();
  const outsider = client();
  const anonymous = client();
  const suffix = randomUUID().slice(0, 12);
  const accounts = [];
  let eventId;

  try {
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
        "UPDATE users SET is_creator = true, creator_status = 'approved' WHERE id = $1 AND username = $2 RETURNING id",
        [account.id, account.username],
      );
      assert.equal(result.rowCount, 1);
    }

    const event = await json(await owner("/api/creator/events", {
      method: "POST",
      json: true,
      body: {
        title: `Upload smoke ${suffix}`,
        description: "Disposable creator upload test",
        date: new Date().toISOString(),
      },
    }), 201);
    eventId = event.id;
    assert.equal(event.creatorId, accounts[0].id);

    const uploaded = [];
    for (const [bytes, filename, mime, type] of [
      [image, "tiny.png", "image/png", "image"],
      [video, "tiny.mp4", "video/mp4", "video"],
    ]) {
      const media = await json(await owner(`/api/events/${eventId}/media/upload`, {
        method: "POST",
        body: multipart(bytes, filename, mime, type),
      }), 201);
      uploaded.push(media);
      assert.equal(media.eventId, eventId);
      assert.equal(media.type, type);
      assert.match(media.url, objectKey);
      assert.match(media.thumbnail, objectKey);

      const thumbnail = await anonymous(media.thumbnail);
      assert.equal(thumbnail.status, 200);
      assert.match(thumbnail.headers.get("content-type") ?? "", /^image\/webp/);
      assert.ok((await thumbnail.arrayBuffer()).byteLength > 0);

      await json(await anonymous(media.url), 401);
      const original = await owner(media.url);
      assert.equal(original.status, 200);
      assert.equal(original.headers.get("content-type"), mime);
      assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
    }

    const listing = await json(await anonymous(`/api/events/${eventId}/media`), 200);
    assert.deepEqual(
      new Set(listing.map((item) => item.id)),
      new Set(uploaded.map((item) => item.id)),
    );

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
      ["corrupt image", Buffer.from("not a PNG"), "broken.png", "image/png", "image", 502],
      ["truncated image", image.subarray(0, 40), "truncated.png", "image/png", "image", 502],
      ["corrupt video", Buffer.from("not an MP4"), "broken.mp4", "video/mp4", "video", 502],
      ["wrong image MIME", image, "wrong.jpg", "image/jpeg", "image", 502],
      ["wrong video MIME", video, "wrong.webm", "video/webm", "video", 502],
      ["wrong selected type", image, "wrong.png", "image/png", "video", 502],
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
  } finally {
    const cleanupErrors = [];
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