# Bounded resumable transport — prepared, not activated

## Scope

This is the current-limit, single-VM transport foundation, **not completion of
the full large-upload specification**. JPEG/Creator allowances are unchanged;
Creator video remains disabled. No >100-MiB acceptance, RAW intake, direct
browser-to-R2 multipart transport or multi-instance support is claimed.

One additive table is declared in `shared/schema.ts`. The reference DDL is
`docs/resumable-upload-schema-PREPARED-ONLY.sql`. Neither Development nor
Production schema changes were executed; only disposable test databases
received the schema. No deployment or production configuration was changed.

`MEDIA_RESUMABLE_UPLOADS_ENABLED` defaults to disabled. `/api/media/policy`
advertises the feature only when explicitly enabled and its table exists.
Ordinary multipart uploads remain available under their existing policy.
Applying the table alone does not activate resumable uploads.

## Architecture and limits

- Authenticated, actor-bound session initiation on an authorized persisted
  gallery. Existing cookie authentication is reused; there are no storage
  credentials, public bucket URLs or bearer download capabilities in browsers.
- One-hour upload lifetime, sequential 1-MiB parts, at most two retained sessions
  per actor and four globally. Active and not-yet-cleaned terminal sessions
  occupy slots. The total source-plus-assembly disk estimate is capped at
  512 MiB; initiation also checks current free temporary disk space.
- Current configured gallery byte/pixel limits still apply. Parts stream to
  private temporary files, never PostgreSQL byte payloads or public media.
  PostgreSQL holds session/ownership/part-checksum metadata only.
- The complete source plus a bounded thumbnail allowance is reserved before
  accepting parts, including for admin actions into a Creator gallery.
- Temporary chunks are **local VM staging**, not persisted R2 originals.
  Existing finalization validates MIME, complete decode, pixels and bytes,
  then uses the existing configured Replit/R2 private object adapter.
- Part size, count, ordering and SHA-256 are checked. Acknowledged parts may be
  retried identically but cannot be replaced. Assembly independently verifies
  each stored part and the complete SHA-256; multipart ETags are never treated
  as checksums.
- Part ingestion and assembly share the existing two-slot/eight-waiter media
  processing budget. Assembly closes its slot before entering the existing
  media processing path, avoiding nested-slot deadlocks.
- Finalization rechecks live actor/gallery permission, ownership, file limits,
  write gates and Creator capacity. Existing safety and AI/caption behavior is
  reused, not bypassed or duplicated.

## Idempotency, recovery and cleanup

Initiation has an actor-scoped request key bound to a canonical request
fingerprint. Media insertion, reservation removal and session completion/
media-ID update share one transaction. Retrying a completed request returns
the saved media identity instead of uploading or generating a second AI job.

The browser keeps a receipt scoped to user, gallery and selected file
attributes. It verifies full-file SHA-256 on reselect; stored caption/credit/
tags are reused on resume. A lost initiation, part or completion response is
resolved through authenticated status lookup, never a silent legacy POST retry.
Local browser receipt storage must be available before starting.

Pause aborts the current transfer request. An uncertain completion is explicitly
reported as unconfirmed; Resume/check status resolves it. Removing an unfinished
file cancels its session and releases storage only after temporary deletion.
Completed media must be deleted through Manage Media, not upload cancellation.

Status and cancellation remain available if the new feature or normal new
uploads are disabled, provided the table exists. Write operations still obey
`MEDIA_STORAGE_NEW_UPLOADS_ENABLED=false`; no smoke-only bypass was added.

The existing 15-minute cleanup cycle handles expired sessions even when new
sessions are disabled. Generic reservation expiry excludes session-owned
reservations. Reconciliation never deletes a finalizer known to still be
running; uncertain state remains accounted. Dead/inactive finalizers can be
cleaned after expiry. Failure to confirm deletion retains the reservation.
Session metadata is cleared on terminal states; small completion/fingerprint
receipts remain for idempotent recovery. Their eventual retention/erasure policy
belongs to the lifecycle release review, not an automatic purge in this change.

Process restarts on the **same single VM and filesystem** can resume receiving
sessions. A filesystem replacement may lose staged chunks; missing/corrupt
chunks fail explicitly and cannot publish. Do not enable this design on
Autoscale/multiple hosts. Native R2 multipart, shared leases, stronger
cross-host reconciliation, approved larger limits and hosting/resource evidence
are required before claiming the full large-upload release.

## Review/activation steps — manual, not performed

1. Review the additive table and resource/retention limitations.
2. Approve/apply that schema in Development only; keep database-copy-to-
   Production and production schema changes out of this step.
3. Explicitly enable `MEDIA_RESUMABLE_UPLOADS_ENABLED=true` for Development
   using normal environment management, with normal uploads already permitted.
4. Verify actual single-VM pause/reselect/restart behavior and capacity before
   requesting a separate Production schema/configuration/publication approval.
5. Do not raise existing byte limits or enable Creator video as part of this
   activation.

## Evidence

Disposable HTTP/DB tests and browser-client protocol tests cover permission,
limits, reservation/slot accounting, replay/tamper/extra-part rejection,
expiry/cancellation, uncertain completion and quota/ownership changes. Local R2
adapter fixtures cover exact retained photo/video bytes, route SHA-256, private
delivery, thumbnails, Range and cleanup. These are not live bucket or VM tests.

Browser UI fixtures use synthetic intercepted API responses, never real account
or Production writes. They check Creator mobile and admin desktop pause/resume,
confirmed-byte progress and a single save without legacy-upload fallback.
