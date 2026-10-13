import { createHash } from "node:crypto";
import type { Request, Response } from "express";

export function thumbnailDigest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

/** Only small outputs are retained. In-flight work is separate and never evicted. */
export class ThumbnailCache {
  private ready = new Map<string, { body: Buffer; expires: number }>();
  private pending = new Map<string, Promise<Buffer>>();
  private bytes = 0;
  constructor(private limits = { entries: 64, bytes: 4 * 1024 * 1024,
    entryBytes: 100 * 1024, ttlMs: 5 * 60_000 }, private now = () => Date.now()) {}

  get stats() { return { entries: this.ready.size, bytes: this.bytes, pending: this.pending.size }; }
  private remove(key: string) {
    const entry = this.ready.get(key);
    if (entry) this.bytes -= entry.body.length;
    this.ready.delete(key);
  }
  async get(key: string, produce: () => Promise<Buffer>): Promise<Buffer> {
    for (const [id, entry] of Array.from(this.ready)) if (entry.expires <= this.now()) this.remove(id);
    const hit = this.ready.get(key);
    if (hit) { this.ready.delete(key); this.ready.set(key, hit); return hit.body; }
    const pending = this.pending.get(key);
    if (pending) return pending;
    // Producers use the shared work budget (2 active + 8 waiting). This also
    // bounds retained closures before producers can enter that budget.
    if (this.pending.size >= 10) {
      const { MediaBusyError } = await import("./media-work-budget");
      throw new MediaBusyError("Media processing is busy. Please retry shortly.");
    }
    const result = Promise.resolve().then(produce).then(body => {
      if (body.length <= this.limits.entryBytes && body.length <= this.limits.bytes) {
        while (this.ready.size && (this.ready.size >= this.limits.entries ||
            this.bytes + body.length > this.limits.bytes)) this.remove(this.ready.keys().next().value!);
        if (this.limits.entries > 0) {
          this.ready.set(key, { body, expires: this.now() + this.limits.ttlMs });
          this.bytes += body.length;
        }
      }
      return body;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, result);
    return result;
  }
}

export const thumbnailCache = new ThumbnailCache();

/** Call only AFTER current authorization and successful source reading. */
export function sendPrivateThumbnail(req: Request, res: Response, body: Buffer, sourceVersion = "") {
  const etag = `"${createHash("sha256").update(sourceVersion).update(body).digest("hex")}"`;
  res.setHeader("Cache-Control", "private, no-cache, max-age=0, must-revalidate");
  res.setHeader("Vary", "Cookie");
  res.setHeader("ETag", etag);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.type("image/webp");
  const validators = req.headers["if-none-match"]?.split(",").map(v => v.trim().replace(/^W\//, ""));
  if (validators?.includes(etag) || validators?.includes("*")) return res.status(304).end();
  return res.send(body);
}
