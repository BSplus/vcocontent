---
name: Live browser verification runtime
description: Fallback when the documented testing subagent kind is unavailable during authenticated Production checks.
---

A testing skill file does not guarantee its subagent kind is available. The
runtime rejected the documented testing kind during live verification.

**Why:** Browser playback needed actual observation; a skill's existence and
successful HTTP Range requests were not evidence of a working browser test.

**How to apply:** If the runtime rejects that kind, do not repeatedly retry it.
An installed Chromium instance can be driven directly through CDP with the
installed WebSocket library. Use a fresh temporary browser profile, bounded
startup/evaluation waits and runtime-only session cookies; remove the temporary
profile afterwards. Never bypass application authentication or print secrets.
For read-only Production checks, verify native playback without clicking
Download, which can mutate counters/history.
