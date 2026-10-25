import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { MediaBusyError } from "./media-work-budget";

export function thumbnailDigest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

/** Only small outputs are retained. In-flight work is separate and never evicted. */
export class ThumbnailCache {
  private ready = new Map<string, { body: Buffer; expires: number }>();
  private pending = new Map<string, Promise<Buffer>>();
  private bytes = 0;
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private limits = { entries: 64, bytes: 4 * 1024 * 1024,
    entryBytes: 100 * 1024, ttlMs: 5 * 60_000 }, private now = () => Date.now(),
    private work = { active: 10, waiting: 0, waitMs: 5_000 }) {}

  private async produce(work: () => Promise<Buffer>) {
    if (this.active >= this.work.active) {
      await new Promise<void>((resolve, reject) => {
        const start = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => {
          this.waiting = this.waiting.filter(entry => entry !== start);
          reject(new MediaBusyError("Media processing is busy. Please retry shortly."));
        }, this.work.waitMs);
        this.waiting.push(start);
      });
    } else this.active++;
    try { return await work(); }
    finally {
      const next = this.waiting.shift();
      if (next) next(); // Transfer the occupied slot; never abandon running reads.
      else this.active--;
    }
  }

  get stats() { return { entries: this.ready.size, bytes: this.bytes, pending: this.pending.size }; }
  /** Clear retained outputs only; in-flight work still owns its bounded slot. */
  clear() { this.ready.clear(); this.bytes = 0; }
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
    // Bound distinct producers and queued closures. Same-key requests join above.
    if (this.pending.size >= this.work.active + this.work.waiting) {
      throw new MediaBusyError("Media processing is busy. Please retry shortly.");
    }
    const result = Promise.resolve().then(() => this.produce(produce)).then(body => {
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
