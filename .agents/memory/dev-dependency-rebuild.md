---
name: Development dependency rebuild
description: Why a merge-time install must interrupt a running development server.
---

Treat an in-place dependency rebuild as a boundary for the development server: stop it while installation is in progress and start it with a fresh module graph afterward.

**Why:** Replit runs merge-time package installation while the existing preview process is still alive. Vite can retain references to optimized chunks from the removed dependency tree; restarting only after the merge does not prevent broken pages during the install.

**How to apply:** When changing install or merge orchestration, preserve a visible unavailable state during an install rather than letting an old Vite process serve partially rebuilt modules. Keep the successful restart check.

Budget the setup deadline for a cold install, type check and build together, not a warmed incremental rerun.

**Why:** Merge-time type checking can be much slower under resource contention; a subsequent cached setup can finish quickly even though the original total deadline was genuinely insufficient.

**How to apply:** Keep validation enabled, allow reasonable headroom for the complete pipeline, and retain per-stage timing output to distinguish slow work from a hung command.