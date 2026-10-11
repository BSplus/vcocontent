---
name: Node deadline fixtures
description: Synthetic hung streams need a referenced handle to test AbortSignal.timeout
---

Keep a referenced timer or socket alive while testing a timeout against an
otherwise idle synthetic Node stream.

**Why:** `AbortSignal.timeout` uses an unreferenced timer. A synthetic Readable
that never produces data has no socket handle, so Node can exit before the
deadline fires and report a pending test as cancelled. Real HTTP requests have
a socket and do not share that fixture behavior.

**How to apply:** In isolated deadline tests, add a short referenced timer and
clear it in `finally`; retain the actual AbortSignal timeout under test.
