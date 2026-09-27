import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { uploadMedia, createMediaKeys, readMediaStream, deleteMediaObject } from "../server/media-storage.ts";
import { mediaPolicy, MediaLimitError } from "../server/media-policy.ts";

test("reject oversized images before writing an object", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "media-budget-"));
  const filename = path.join(dir, "oversized.png");
  try {
    await writeFile(filename, Buffer.from("not an image"));
    await assert.rejects(
      uploadMedia({ path: filename, size: mediaPolicy.imageBytes + 1, mimetype: "image/png" }, "image"),
      MediaLimitError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stored images have exactly two bounded private objects", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "media-budget-"));
  const filename = path.join(dir, "photo.png");
  const keys = createMediaKeys("image/png");
  try {
    await sharp({ create: { width: 3000, height: 1200, channels: 3, background: "#304050" } })
      .png().toFile(filename);
    const { stat } = await import("node:fs/promises");
    const file = { path: filename, size: (await stat(filename)).size, mimetype: "image/png" };
    const saved = await uploadMedia(file, "image", keys);
    assert.equal(saved.objectCount, 2);
    assert.equal(saved.mimeType, "image/webp");
    const read = async key => {
      const chunks = [];
      for await (const chunk of readMediaStream(key)) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    };
    const display = await read(keys.storageKey);
    const thumb = await read(keys.thumbnailKey);
    assert.equal(saved.storedBytes, display.length + thumb.length);
    assert.ok(display.length <= 4 * 1048576);
    assert.ok(thumb.length < 100 * 1024);
    assert.ok((await sharp(display).metadata()).width <= 2560);
    assert.ok((await sharp(thumb).metadata()).width <= 640);
  } finally {
    await Promise.allSettled([deleteMediaObject(keys.storageKey), deleteMediaObject(keys.thumbnailKey)]);
    await rm(dir, { recursive: true, force: true });
  }
});