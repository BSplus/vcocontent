---
name: Development dependency rebuild
description: Why a merge-time install must interrupt a running development server.
---

Treat an in-place dependency rebuild as a boundary for the development server: stop it while installation is in progress and start it with a fresh module graph afterward.

**Why:** Replit runs merge-time package installation while the existing preview process is still alive. Vite can retain references to optimized chunks from the removed dependency tree; restarting only after the merge does not prevent broken pages during the install.

**How to apply:** When changing install or merge orchestration, preserve a visible unavailable state during an install rather than letting an old Vite process serve partially rebuilt modules. Keep the successful restart check.