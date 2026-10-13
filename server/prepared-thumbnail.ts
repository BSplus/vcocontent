import type { Request, Response } from "express";
import { readMediaStream } from "./media-storage";
import { sendPrivateThumbnail } from "./thumbnail-cache";

/** Deliver current prepared bytes unchanged, through the existing integrity checks. */
export async function sendPreparedThumbnail(req: Request, res: Response, key: string) {
  const stream = readMediaStream(key), chunks: Buffer[] = [];
  let size = 0, streaming = false;
  const timer = setTimeout(() => stream.destroy(new Error("Thumbnail read timed out")), 10_000);
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (!streaming && size > 100 * 1024) {
        // Historical larger outputs retain streaming/no-store behavior.
        streaming = true;
        res.type("image/webp").set("Cache-Control", "private, no-store");
        for (const buffered of chunks) res.write(buffered);
        chunks.length = 0;
      }
      if (streaming) {
        if (!res.write(chunk)) await new Promise<void>((resolve, reject) => {
          const cleanup = () => { res.off("drain", drained); res.off("close", closed); };
          const drained = () => { cleanup(); resolve(); };
          const closed = () => { cleanup(); reject(new Error("Thumbnail response closed")); };
          res.once("drain", drained); res.once("close", closed);
        });
      } else chunks.push(Buffer.from(chunk));
    }
    if (!size) throw new Error("Empty thumbnail");
    if (streaming) return res.end();
    return sendPrivateThumbnail(req, res, Buffer.concat(chunks));
  } finally { clearTimeout(timer); stream.destroy(); }
}
