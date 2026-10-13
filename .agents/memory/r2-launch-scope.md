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

For the Production smoke, the operator now chooses existing application upload
functionality, not a new authorization system or migration. A temporary global
upload window is the selected plan, pending explicit execution approval.

**Why:** The operator explicitly simplified the launch and rejected implementing
the previously proposed smoke-only authorization system.

**How to apply:** Follow docs/r2-direct-production-smoke-plan.md. Do not implement
the superseded smoke features. Explain that all eligible users can upload while
the live global flag is true; private platform access restricted to test operators
minimizes exposure. The operator must immediately restore false and republish
after the upload phase or any error; saving false alone is not runtime closure.
Only new test media/galleries may be deleted after successful verification.
Existing delete handlers can sweep queued cleanup, so prove that queue is
exclusively test-owned first. No schema, existing-data cleanup, credential
exposure or public bucket. Preparation is not approval to change settings,
publish, upload or delete.
