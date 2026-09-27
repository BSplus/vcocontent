---
name: Clean-install firewall
description: Why a passing local build does not guarantee a post-merge clean install succeeds.
---

After dependency changes, verify a clean install against the package lock, not
only a build against already installed modules.

**Why:** A transitive package version remained pinned in the lock despite a
compatible newer release. It worked from the existing workspace cache but
was denied by the package security policy during post-merge setup.

**How to apply:** Update the relevant direct parent first; if its compatible
range still resolves to a blocked transitive lock entry, pin a safe compatible
transitive version with package-manager overrides and revalidate the entire
post-merge setup. Never bypass the security policy.