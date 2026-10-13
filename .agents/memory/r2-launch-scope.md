---
name: Minimal Production R2 launch scope
description: Operator-selected new-upload launch without database replacement or dummy cleanup prerequisite.
---

The operator's primary objective is Cloudflare R2 EU for new Production uploads,
not replacing the existing Production PostgreSQL database. Existing media and
visible test events are disposable dummy data; hiding them is sufficient for
launch and old-media migration or SQL cleanup is not a prerequisite.

**Why:** The operator explicitly simplified the launch to get R2 live as soon
as safely possible, without complexity that does not materially improve safety.

**How to apply:** Preserve existing users, roles, series, settings and other
integrations. The operator explicitly accepts the empty Production library as
the clean starting point. The previous Nextcloud connection and reference
document 48 are not required for launch and **must not be restored**; they may
be recreated later. All old cleanup SQL is obsolete and **must not be executed**.
Do not introduce cleanup or migration work. Keep ordinary uploads closed until
a controlled Production smoke passes. Storage selection is not approval to
deploy schema, activate Production R2 or open normal uploads; obtain explicit
approval. Use docs/r2-production-launch-checklist.md, not historical cleanup or
recovery prerequisites.

For the Production smoke, the operator requires normal uploads blocked before,
during and after testing; never briefly flip the global upload flag to allow the
test. Use an explicitly approved, actor/event/key-bounded exception instead.
The smoke must remove its own isolated test data, not merely hide it.

**Why:** The operator explicitly required smoke uploads without opening normal
user uploads, exact test cleanup, and preservation of all existing records.

**How to apply:** The narrow exception is preparation only until separately
approved implementation, manual publication and execution. No schema changes,
credential exposure, public bucket or existing-data cleanup. Follow
docs/r2-production-smoke-procedure.md rather than the superseded global-window
smoke procedure.
