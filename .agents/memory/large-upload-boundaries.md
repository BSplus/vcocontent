---
name: Large-upload approval and provider boundaries
description: The 250-MiB test approval is not a user limit or activation; native R2 retry rules need conservative reconciliation.
---

The operator approved preparing multipart transport and testing up to 250 MiB
in isolated fixtures only. This is not approval to raise actual user limits,
open Development uploads, apply schema changes, change hosting/bucket settings,
enable RAW/Creator video or publish.

**Why:** The approval form explicitly limited the work to preparation/disposable
tests while preserving existing user limits, upload gates and Production.

**How to apply:** Treat the fixture ceiling separately from product policy and
runtime activation. Obtain separate approval for connected schema/settings,
live uploads and Production changes; do not infer those from successful fixtures.

For preparation, retain the private, file-backed server transport boundary.
Direct browser-to-R2 capabilities/CORS are not activated by this choice.

**Why:** This reuses the established authenticated staging and storage boundary
without adding browser credentials or capabilities while the large-file
application lifecycle is still being integrated.

**How to apply:** Keep provider preparation distinct from a feature-complete
HTTP/UI release. Require durable ownership/lease/reservation integration and
confirmed uncertain-operation recovery before activating it. The evidence and
remaining gates are in `docs/r2-multipart-preparation.md`.

Native R2 part retries are not automatically harmless: a failed replacement
can destroy an existing part, and multipart ETags are not whole-file SHA-256.

**Why:** These are explicit R2 provider semantics, not generic S3 retry assumptions.

**How to apply:** Reconcile acknowledged/provider parts against immutable source
evidence before resending. Verify completed bytes independently with a pinned
read. Do not release capacity or broaden cleanup when initiation/completion or
the destination object's outcome is uncertain.
