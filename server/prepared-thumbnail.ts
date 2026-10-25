import type { Request, Response } from "express";
import { readMediaStream } from "./media-storage";
import { sendPrivateThumbnail } from "./thumbnail-cache";
import { ThumbnailCache, thumbnailDigest } from "./thumbnail-cache";
import { preparedThumbnailSource } from "./media-object-routing";
import { ObjectStoreError, type ObjectStore } from "./object-store";

// Prepared thumbnails need I/O only, not the shared image-conversion CPU budget.
// Queue a normal gallery burst while bounding open streams and retained buffers.
export const preparedThumbnailCache = new ThumbnailCache(undefined, undefined,
  { active: 4, waiting: 48, waitMs: 5_000 });
const storeIds = new WeakMap<ObjectStore, number>();
let nextStoreId = 0;
/** Deliver current prepared bytes unchanged, through the existing integrity checks. */
export async function sendPreparedThumbnail(req: Request, res: Response, key: string) {
  const source = await preparedThumbnailSource(key);
  if (source) {
    if (!storeIds.has(source.store)) storeIds.set(source.store, ++nextStoreId);
    const identity = `${storeIds.get(source.store)}:${source.identity}`;
    const body = await preparedThumbnailCache.get(identity, async () => {
      const stream = source.open(), chunks: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(() => stream.destroy(new Error("Thumbnail read timed out")), 10_000);
      try {
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > source.size || size > 100 * 1024) throw new ObjectStoreError("integrity");
          chunks.push(Buffer.from(chunk));
        }
        const bytes = Buffer.concat(chunks);
        if (size !== source.size || thumbnailDigest(bytes) !== source.sha256) throw new ObjectStoreError("integrity");
        return bytes;
      } finally { clearTimeout(timer); stream.destroy(); }
    });
    return sendPrivateThumbnail(req, res, body, identity);
  }
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
