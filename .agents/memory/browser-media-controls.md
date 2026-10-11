---
name: Browser media controls
description: Avoid false playback-test diagnoses caused by native controls, retained media buffers, and unrelated page text.
---

In Chromium playback checks, locate the native Play control rather than guessing
a bottom-left coordinate: the timeline can occupy that position and only seek.
Native controls can consume Escape; test dialog closing via its visible action.

**Why:** These behaviors made a decodable, ready video appear not to start or
its dialog appear not to close, although the application behavior was intact.

**How to apply:** Use trusted mouse/touch on the UA control, assert decoded
motion and currentTime, and scope error assertions to the player's alert/status.
For session-revocation fixtures, force a new media request; already-buffered
bytes can be reused even after changing the synthetic cookie. Do not mistake
cached playback for a fresh authorization decision or a rights notice containing
“permission” for the player's access-denied message.

Keep CPU-heavy image-optimization fixtures separate from browser playback and
FFmpeg deadline checks.

**Why:** Concurrent runs exhausted existing media-work/polling deadlines and
made otherwise independently verified playback checks exceed the runner window.

**How to apply:** Parallelize lightweight, independent checks, but serialize
resource-heavy media/browser matrices before diagnosing timeout regressions.
