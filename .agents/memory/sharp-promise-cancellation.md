---
name: Sharp promise cancellation
description: Sharp stream destruction does not cancel native promise work and can emit unhandled errors
---

When aborting Sharp promise-based metadata or buffer encoding, destroy without
an error, check the cancellation signal after the native promise settles, and
keep the concurrency slot until then. Always bound native work independently.

**Why:** Passing an error to `destroy()` emitted an unhandled stream error during
a real encoding-abort check. Sharp's promise path does not listen for that event,
and destroying the stream does not interrupt its already-running native work.
Releasing the slot early would permit more simultaneous native encodes than the
configured limit.

**How to apply:** Test cancellation during active encoding, not only queueing
and source reads. Describe bounded cancellation grace honestly rather than
claiming instantaneous native interruption.
