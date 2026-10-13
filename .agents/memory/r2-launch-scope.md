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
Do not introduce cleanup or migration work. Storage selection is not approval
to deploy schema, activate Production R2 or change normal upload availability.
Use docs/r2-production-launch-checklist.md, not historical cleanup or recovery
prerequisites.

For Production verification, use existing application functionality, not a new
authorization system or migration. The operator now reports successful live
photo/video uploads and explicitly requires normal uploads to remain enabled,
the deployment to remain public, and the uploaded test media/galleries preserved.

**Why:** The operator rejected the smoke-only authorization proposal and then
requested final go-live verification without disabling uploads or deleting tests.

**How to apply:** Do not follow the earlier smoke plan's closure/deletion steps
during final verification. Prefer read-only checks; no secrets, schema, existing
record changes or automatic publishing. Completing counted downloads changes
records, so distinguish protected original-file retrieval from testing the
counted endpoint and obtain authorization for the latter. Private-gallery tests
need suitable authorized fixtures; public official galleries do not prove those
permissions. Confirm bucket privacy/token scope separately rather than inferring
them from successful R2 reads. Any later cleanup must account for existing delete
handlers sweeping the queued cleanup, not just the selected gallery's keys.
