import test from "node:test";
import assert from "node:assert/strict";
import { ThumbnailCache } from "../server/thumbnail-cache.ts";

const tick = () => new Promise(resolve => setImmediate(resolve));
test("prepared preview burst is queued, bounded and same-key coalesced", async () => {
  const cache = new ThumbnailCache(undefined, undefined, { active: 4, waiting: 48, waitMs: 1000 });
  let active = 0, peak = 0, calls = 0;
  const work = Array.from({ length: 52 }, (_, i) => cache.get(String(i), async () => {
    active++; calls++; peak = Math.max(peak, active);
    await tick();
    active--;
    return Buffer.from(String(i));
  }));
  const joined = cache.get("51", () => assert.fail("Queued key must not duplicate work"));
  await assert.rejects(cache.get("overflow", async () => Buffer.alloc(1)), /busy/);
  const results = await Promise.all(work);
  assert.equal(await joined, results[51]);
  assert.equal(calls, 52);
  assert.equal(peak, 4);
  assert.equal(cache.stats.pending, 0);
});

test("waiting deadline never frees a running read; failed producers release their slots", async () => {
  const cache = new ThumbnailCache(undefined, undefined, { active: 1, waiting: 2, waitMs: 25 });
  let release;
  const running = cache.get("slow", () => new Promise(resolve => { release = resolve; }));
  await tick();
  let queuedCalled = false;
  await assert.rejects(cache.get("timeout", async () => {
    queuedCalled = true; return Buffer.alloc(1);
  }), /busy/);
  assert.equal(queuedCalled, false);
  assert.equal(cache.stats.pending, 1);
  const next = cache.get("next", async () => { throw Error("read failed"); });
  const rejected = assert.rejects(next, /read failed/);
  release(Buffer.alloc(1));
  await Promise.all([running, rejected]);
  assert.equal(cache.stats.pending, 0);
  assert.equal((await cache.get("recovered", async () => Buffer.from("ok"))).toString(), "ok");
});
