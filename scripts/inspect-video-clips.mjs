// Local-only inspection: production sampler, operator-supplied originals, no AI calls.
import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { sampleVideo } from "../server/video-sampling.ts";
import { mediaPolicy } from "../server/media-policy.ts";

const directory = "generated-artifacts/video-review";
await mkdir(directory, { recursive: true });
for (const file of (await readdir("attached_assets")).filter(f => /1791615863.*\.(mp4|mov)$/.test(f)).sort()) {
  if ((await stat(`attached_assets/${file}`)).size > mediaPolicy.videoBytes) {
    console.log(JSON.stringify({ file, excluded: "Exceeds existing video byte policy; no override or transcoding" }));
    continue;
  }
  await sampleVideo({ url: `/api/media/files/media-${randomUUID()}.${file.split(".").pop()}` }, async sample => {
    await writeFile(`${directory}/${file}.sample.json`, JSON.stringify(sample));
    const tiles = await Promise.all(sample.frames.map(async frame => sharp(Buffer.from(frame.image.split(",")[1], "base64"))
      .resize(240, 300, { fit: "contain", background: "#222" }).jpeg().toBuffer()));
    await sharp({ create: { width: 240 * tiles.length, height: 300, channels: 3, background: "#222" } })
      .composite(tiles.map((input, i) => ({ input, left: i * 240, top: 0 })))
      .jpeg().toFile(`${directory}/${file}.jpg`);
    console.log(JSON.stringify({ file, duration: sample.duration, frames: sample.frames.length,
      timestamps: sample.frames.map(f => f.timestamp), samplingMs: sample.samplingMs }));
  }, () => createReadStream(`attached_assets/${file}`));
}
