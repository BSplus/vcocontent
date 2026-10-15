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

Use an independent cookie jar for each synthetic test actor, including during
sign-in. Do not send one actor's session cookie when logging in as another.

**Why:** Passport regenerates the session on sign-in. Sharing a cookie jar can
invalidate the first actor after its initial authentication check already
passed, making later permission checks appear to fail unpredictably.

**How to apply:** Sign in without another actor's cookies, retain only the
application session cookie privately, and verify all actors' identities after
multi-account setup. Do not change authentication to accommodate the fixture.
