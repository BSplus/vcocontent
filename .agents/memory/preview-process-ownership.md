---
name: Preview process ownership
description: Why a successful workflow restart alone does not prove the current server owns the preview port.
---

After restarting a preview workflow, verify that the new process owns the configured port, not merely that the port responds.

**Why:** A workflow restart once left an older process bound to the preview port. The replacement silently started on the next available port, so HTTP checks on the expected port still reached stale code.

**How to apply:** Compare the listener's PID with the workflow process tree and startup logs after restarts when served behavior disagrees with the source. An existing task covers making port conflicts fail visibly.