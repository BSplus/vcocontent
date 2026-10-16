# Native JPEG maintenance recovery — prepared, not activated

16 October 2026. Bounded P2-8 integration; not approval for rollout.

## Integration and scope

The existing 15-minute upload-session maintenance pass now calls
`recoverNativeUploadSessions` before its pre-existing expiry cleanup.
There is no new timer, public endpoint, schema, bucket-listing job, credential
flow or authentication bypass.

Recovery requires all existing opt-ins: explicit Development environment,
R2 provider, enabled routing, resumable uploads, native multipart, and complete
optional native schema. Production and missing/partial schema return without
recovery mutations. The workspace native flag remains off; no connected data,
settings or schema were changed.

Finalization also requires the normal new-upload gate. With that gate closed,
the pass can clean registered terminal staging or confirm safe expired multipart
cancellation, but cannot finalize/publish another media item.

## Bounds and ownership

- One in-flight recovery pass per process; overlapping calls do not take another
  slot. Current transport remains single-host, not a multi-instance guarantee.
- Scan at most eight due JPEG sessions and admit at most two actions, serially.
  A ten-second admission window prevents starting more work after that window.
- Admission/SQL-lock bounds are **not a hard end-to-end wall-clock timeout**.
  Existing provider/image/lease limits still apply. An admitted operation keeps
  its slot until it settles; there is no timeout race that abandons live writes.
  Whole-worker stall/resource acceptance remains a P2-9 release gate.
- Claim under reservation-before-session locks with local lock/statement limits.
  Persist retry progress before provider work, outside any surrounding SQL
  transaction. Backoff is 1, 2, 4, 8, 16, then 30 minutes.
- Recheck active finalizers, current actor permissions, gallery ownership,
  fingerprint, gates and capacity through the existing finalization repository.
  Recovery uses the stored actor ID, not a fabricated HTTP request.
- Select only existing native session IDs and registered receipts. Never derive
  an expanded cleanup scope by listing a bucket or guessing keys.

## Outcomes

| State | Action |
| --- | --- |
| Inactive, unexpired finalizer | Resume the existing authenticated-intent pipeline with the same source, metadata, reservation and provider journal. |
| Lost part reply | Reconcile acknowledged provider bytes before any retry; no replacement of an accepted part. |
| Lost Complete reply | Verify the existing completed object; never blindly repeat Complete. |
| Pending thumbnail after a lost PUT reply | Read only the reserved thumbnail, compare with the prepared bytes, pin the read to its version and confirm HEAD again before conditionally verifying the still-pending route. Never repeat PUT. |
| Verified source/thumbnail, registration interrupted | Verify and atomically register the same objects without another source write. |
| Registered receipt, staging left behind | Clean only owned staging; preserve the terminal receipt and registered media. |
| Unknown initiation | Hold, preserve capacity/staging, stop automatic retries; no second Create or guessed abort. |
| Expired known incomplete/preparation-only multipart | Confirm safe cancellation and absence before deleting staging or releasing the reservation. |
| Expired ambiguous/verified completion | Hold; do not publish or infer cancellation from expiry. |
| Integrity or ownership conflict | Hold for review; do not overwrite objects or free quota. This is not a complete public quarantine/admin-review UI. |
| Transient/unconfirmed outcome or paused uploads | Retain capacity and retry with durable backoff; explicit user status checks remain available. |

Internal `nativeRecovery` progress is stripped before parsing user metadata.
Terminal registration retains its existing receipt format; post-processing
always reads the latest row so it cannot replace a concurrent terminal receipt
with an old metadata snapshot. Cleanup never grants safety/publication approval
or creates another analysis admission.

Aggregate per-pass counters contain no user IDs, object keys, upload IDs,
credentials or raw provider errors. Held states remain recorded in internal
session metadata for future operator diagnostics. No new public diagnostic
surface or automatic unhold mechanism is introduced by maintenance itself.
An aggregate, admin-only Development read view is now prepared separately; see
`docs/native-upload-diagnostics.md`. It cannot invoke recovery or release bytes.

## Verification

```sh
node scripts/test-image-downloads.mjs --enable-uploads \
  tests/native-jpeg-intake.test.mjs tests/resumable-uploads.test.mjs \
  tests/retained-storage-capacity.test.mjs tests/r2-multipart-journal.test.mjs \
  tests/gallery-ownership-storage.test.mjs
npm run check
npm run build
```

The previous native run passed **36 Node-reported checks, zero failures/skips**.
TypeScript and the production build passed. Its recovery scenarios
cover lost part/Complete replies, pre-registration failure, held initiation,
closed gates/backoff, Production/schema guards, permission changes, terminal
staging, concurrent passes, two-action bounds, active finalizers, remote hash
mismatch and actual expiry of known versus ambiguous multipart outcomes.

Tests use disposable loopback PostgreSQL and synthetic providers; optional
schema and gate changes exist only inside those test children. A preceding
broader run passed 98 tests before the final five native scenarios were added;
that native run is reported separately, not as another full combined run.

## Remaining release gates

This closes the bounded native-JPEG recovery implementation slice, not all of
P2-8/P2-9. Broader cross-object diagnostics and case-resolution procedures, RAW/video lifecycle integration,
real-provider/connected-browser/resource/restart
acceptance and separately approved schema/settings/publishing remain.
Unknown initiation and expired ambiguous completion deliberately stay held until
verified operational resolution; no automatic destructive cleanup is implied.

## Pending thumbnail reconciliation

Only the key derived from the session's existing reservation and deterministic
JPEG preparation is eligible, under the same fenced source-key lease and fresh
upload authorization. The route must be R2/pending with no prior integrity or
retained-source evidence. Size, WebP MIME, SHA-256 and stable provider version
must match; the conditional update cannot promote a concurrently deleted or
changed route. Normal independent verification and atomic registration follow.

Missing bytes stay pending with retry backoff. Wrong bytes or changed versions
are held as integrity conflicts. Neither outcome overwrites/deletes the object,
publishes media or releases the reservation. No bucket discovery or general
pending-route repair is introduced. The five added disposable scenarios cover
lost PUT success, missing bytes, conflicting bytes, version change and concurrent
route deletion.

After this extension the full native suite passed **41 Node-reported checks,
zero failures/skips**. TypeScript and the production build also passed on the
updated source. The application restarted successfully and its public homepage
rendered in preview; no authenticated browser or real-provider test was run.
