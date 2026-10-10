---
name: FFmpeg failure codes across versions
description: Decoder exit statuses are version-dependent and must not be assumed to equal one.
---

FFmpeg failures do not universally exit with status 1.

**Why:** FFmpeg versions can return different nonzero statuses for the same kind of failure; assuming a universal numeric value makes checks unreliable across runtimes.

**How to apply:** Preserve the actual numeric exit status and signal. Classify failures using bounded, allowlisted diagnostics and explicit timeout flags; tests should assert the error category and a nonzero exit, not an assumed numeric value.
