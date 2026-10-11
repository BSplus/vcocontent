import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createVideoPreview, videoFrameThumbnail } from "../server/video-preview.ts";
import { probeVideoFile, videoToolTimeout } from "../server/video-tools.ts";
import { uploadMedia } from "../server/media-storage.ts";
import { Client } from "@replit/object-storage";

test("real MP4, MOV and WebM frames become compact previews; invalid input never creates a placeholder",
  {timeout:60000}, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "video-preview-test-"));
    try {
      assert.equal(videoToolTimeout("ffprobe"), 30000);
      assert.equal(videoToolTimeout("ffmpeg"), 15000);
      for (const ext of ["mp4", "mov", "webm"]) {
        const filename = path.join(directory, `red.${ext}`);
        await promisify(execFile)("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
          "color=red:size=160x90:rate=1:duration=2", "-threads", "1",
          "-c:v", ext === "webm" ? "libvpx-vp9" : "libx264", "-pix_fmt", "yuv420p", filename], {timeout:10000});
        const info = await probeVideoFile(filename);
        assert.ok(info.duration >= 1);
        assert.equal(info.width, 160);
        const preview = await createVideoPreview(filename);
        assert.ok(preview.length < 100 * 1024);
        assert.equal((await sharp(preview).metadata()).format, "webp");
        const {data} = await sharp(preview).resize(1, 1).removeAlpha().raw().toBuffer({resolveWithObject:true});
        assert.ok(data[0] > 180 && data[1] < 60 && data[2] < 60, "thumbnail must contain the actual red frame");
      }
      const corrupt = path.join(directory, "bad.mp4");
      await writeFile(corrupt, "not a video");
      await assert.rejects(() => createVideoPreview(corrupt), error => error.stage === "probe");
      await assert.rejects(() => videoFrameThumbnail(Buffer.alloc(524289)), error => error.code === "FRAME_LIMIT");
    } finally { await rm(directory, {recursive:true,force:true}); }
  });

test("upload persists the true frame independently of AI and preserves original bytes", {timeout:30000}, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "video-upload-test-"));
  const filename = path.join(directory, "red.mp4");
  const objects = new Map();
  t.mock.method(Client.prototype, "uploadFromFilename", async (key, file) => {
    objects.set(key, await readFile(file)); return {ok:true};
  });
  t.mock.method(Client.prototype, "uploadFromBytes", async (key, bytes) => {
    objects.set(key, Buffer.from(bytes)); return {ok:true};
  });
  t.mock.method(Client.prototype, "delete", async key => { objects.delete(key); return {ok:true}; });
  try {
    await promisify(execFile)("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
      "color=red:size=160x90:rate=2:duration=2", "-threads", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", filename]);
    const bytes = await readFile(filename);
    const stored = await uploadMedia({path:filename,mimetype:"video/mp4",size:bytes.length}, "video");
    assert.deepEqual(objects.get(stored.storageKey), bytes);
    assert.equal(stored.highBytes, bytes.length);
    assert.equal(stored.lowBytes, objects.get(stored.thumbnailKey).length);
    const {data} = await sharp(objects.get(stored.thumbnailKey)).resize(1,1).removeAlpha().raw().toBuffer({resolveWithObject:true});
    assert.ok(data[0] > 180 && data[1] < 60 && data[2] < 60);
  } finally { await rm(directory, {recursive:true,force:true}); }
});
