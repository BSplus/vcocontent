---
name: Post-merge dependencies
description: Security-policy checks and install races when a preview remains active during a merge.
---

After dependency changes, verify a clean install against the package lock in
an isolated or stopped environment, not only a build against cached modules.
During live post-merge reconciliation, use a non-destructive, lock-preserving
install instead of deleting the running app's modules.

**Why:** A transitive package version remained pinned in the lock despite a
compatible newer release. It worked from the existing workspace cache but
was denied by the package security policy during post-merge setup. Separately,
a clean install tried to remove a directory while the live preview was writing
its build cache there and failed with a filesystem race.

**How to apply:** Update the relevant direct parent first; if its compatible
range still resolves to a blocked transitive lock entry, pin a safe compatible
transitive version with package-manager overrides and revalidate the entire
post-merge setup. Never bypass the security policy. Keep the live merge setup
non-destructive and fail if it changes the committed dependency lock; check a
clean install separately when the preview is not competing for those files.