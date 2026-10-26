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

Prepared optional schema must remain outside automatic schema discovery until
its application is approved.

**Why:** Merge-time setup can apply active schema definitions to Development.
Preparing a declaration is not approval to change a connected database.

**How to apply:** Keep dormant declarations separate from the active schema
entry point and test them in disposable databases. Review integration and
approval gates before adding them to the publishing/development schema path.

Save multipart write intents independently of provider work, and bound SQL
waiting on the client as well as the database server.

**Why:** SQL rollback cannot undo R2 writes; a long surrounding transaction can
erase the evidence needed after a crash. Server statement timeouts alone do not
cover a lost network response and can leave worker slots waiting indefinitely.

**How to apply:** Use committed checkpoints under a dedicated, fenced session
lease, captured verified connection settings and bounded client query/connect
deadlines. Capacity must survive uncertain results until provider and staging
cleanup or atomic asset registration are confirmed.

Native cleanup fencing must survive both the first-intent insertion gap and
the atomic replacement of a journal by a terminal receipt.

**Why:** A reservation FK alone protects accounting, not local source files.
Legacy cleanup can select a session before an uncommitted intent is visible,
or after successful registration removes its journal.

**How to apply:** Hold the same reservation/session locks through initial intent
insertion; recheck fences under those locks before unlinking. Respect terminal
receipts too. Unpin reservations and register physical usage in one transaction;
perform final quota checks after reservation removal so bytes are not charged
twice. Keep every native part/assembled source inside its owned staging boundary.

Distinguish a deliberate local-preparation fence from an uncertain provider
initiation; never replace one with the other just to protect staging.

**Why:** Decoding needs a cleanup fence before any storage write, but marking
Create as initiated before it was admitted would manufacture ambiguity and
prevent safe cancellation of invalid files.

**How to apply:** Preserve positive no-write evidence until a committed provider
intent replaces it. Release only after checking destination absence, conflicting
persistence routes and local cleanup. Reuse existing JPEG provenance conventions,
since source keys also select established exact-original/privacy delivery rules.

Successful intake and retrieval are not enough to approve a new storage path:
ordinary media/gallery deletion must understand the physical inventory first.

**Why:** The prepared native registration could pass source/preview tests while
the existing bulk gallery deletion left physical inventory linked and therefore
could not delete the gallery. This was isolated-test evidence, not live damage.

**How to apply:** Keep native activation blocked until normal deletion and
retained cleanup accounting have end-to-end acceptance. Removing fixture
inventory manually is test teardown, never proof of working application deletion.

Use a transactional handoff to durable cleanup accounting when gallery-bound
physical inventory must be detached before the gallery can be removed.

**Why:** Keeping the inventory prevents gallery deletion, while dropping it
without transferring actual bytes and ownership would falsely free quota.
The existing cleanup lifecycle provides this handoff without another schema.

**How to apply:** Detach references and hand off verified ownership/bytes
atomically. Preserve shared objects and uncertain uploads. Keep pending bytes
charged until R2 absence is confirmed, including after lost DELETE replies.
Respect queue-before-route locking for existing cleanup rows.

Isolated native-storage tests must mock legacy storage as well as R2.

**Why:** A reservation that never persisted an object may have no provider route;
its cleanup can therefore enter the legacy adapter even in an R2-oriented test.

**How to apply:** Cover every provider fallback in the disposable fixture, not
just the selected upload provider. A synthetic R2 client alone is insufficient.

After finalization starts, an HTTP error alone is not proof of a rejected upload,
including 4xx replies. Conflicts are likewise not safe evidence of no write.

**Why:** Provider work can outlive a request, or a gate can close after bytes were
stored. Labelling that outcome rejected encourages duplicate copies and can
discard the only browser recovery receipt.

**How to apply:** Keep the same receipt, metadata and session; show an unconfirmed
outcome with Resume / check status. Do not automatically cancel, initiate another
upload or clear the receipt based solely on a failed finalization response.

Maintenance must not infer permission to publish or discard from an expired
upload. Unknown initiation and ambiguous/verified completion remain held;
only positively confirmed cancellation or registration can free the reservation.

**Why:** Session expiry does not prove that provider work failed or that its
bytes disappeared, and current ownership/permission may differ from initiation.

**How to apply:** Recover only durable owner-bound intents, recheck current
permissions/gates, and retain uncertain bytes. Keep automatic recovery within
the separately approved Development scope; never broaden it into bucket cleanup.

Creator uploads must clearly communicate their stricter limits, warn before
transfer based on selected file counts and sizes, and preserve batch progress
when a limit is reached. The operator does not want this extra pre-check for
Admins: “Nicht bei Admins nötig!”

**Why:** The operator wants Creators to understand capacity limits before
uploading rather than discovering them through interrupted batch progress.

**How to apply:** Separate advisory selection checks from authoritative server
quotas. Retain saved uploads and distinguish quota-blocked files from uncertain
transfer outcomes. Do not weaken ownership-based quotas or enable Creator
Nextcloud access as an implication of this UX request.

An admission deadline is not a hard operation deadline. Do not release a worker
slot via a timeout race while admitted provider work may still be running.

**Why:** Releasing early permits overlapping writers and can lose the evidence
needed to resolve a late successful write.

**How to apply:** Bound batch size, concurrency and retry frequency; retain the
in-flight slot until work settles. Require separate stall/resource evidence
before activation rather than claiming a strict elapsed-time guarantee.

Read-only operational diagnostics may destroy their own timed-out connection,
but must not reuse that cancellation pattern for storage mutations or alter
the application pool's global policy.

**Why:** A browser deadline only stops waiting; it does not prove database work
ended. Conversely, abandoning a writer can lose the evidence needed to reconcile
a late successful mutation.

**How to apply:** Isolate bounded diagnostic admission and keep unresolved work
charged to its slot until settled. Destroy late diagnostic acquisitions without
SQL. Preserve the stricter lease/evidence rules for upload and cleanup writers.
