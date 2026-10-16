# Gated native JPEG intake — preparation, not activation

15 October 2026. P2-5 of the unified specification.

## What is connected

The existing authenticated upload-session endpoints and Studio uploader can now
use the prepared native R2 lifecycle for **new JPEG sessions only**, when
`MEDIA_R2_MULTIPART_ENABLED=true` is explicitly supplied in Development.
This is not permission to enable it. The ordinary feature flag, new-upload
gate, private R2 configuration, runtime database fingerprint and optional journal
schema must also pass. The provider adapter rejects Production even with flags.

No new endpoints, browser capabilities, product limits or active schema
declarations were added. The native flag remains unset in this workspace.
Normal uploads remain closed. Connected databases and buckets were not changed.

- Transport choice is server-owned and persisted at initiation; clients cannot
  choose keys, ownership or transport through metadata. An existing request key
  retains its original transport choice when flags change.
- Current-limit parts remain authenticated, bounded and SHA-256 checked.
  Finalization claims are serialized against session/reservation state.
- A stable assembled source is reused on recovery rather than creating another
  complete copy. Its bytes and every part must still match the original receipt.
- A durable no-write preparation fence precedes decoding and provider work.
  Actual JPEG validation, immutable original preservation and the bounded WebP
  preview reuse the existing parser and provenance conventions.
- Source transport uses the native engine; the small thumbnail uses the existing
  private object pipeline under the destination lease. Existing verified preview
  routes are independently checked and reused, not overwritten.
- Atomic media/physical-object registration transfers the reservation, and the
  existing independent safety and AI workflows remain in place. Analysis is
  admitted once; manual captions, credit and tags remain protected.
- Exact-source access and stripped visitor JPEG exports use existing delivery
  permissions. This adds no new licensing or original-download entitlement.

Implementation: `server/native-jpeg-intake.ts`,
`server/upload-session-assembly.ts`, `server/resumable-uploads.ts`, and the
existing browser uploader in `client/src/lib/resumable-upload.ts`.

## Recovery and cancellation

An active finalizer is not restarted. A server-confirmed inactive native
finalizer exposes a resume/check-status hint; the browser uses the same session
and completion endpoint without another initiation or retransmitting parts.

Known lost part acknowledgements are reconciled before retrying. A lost
completion reply is verified without another Complete operation. If the
database commit succeeded but its reply was lost, the finalizer resolves the
committed item and completes safety/staging cleanup rather than abandoning it.

Uncertain Create results do **not** start another Create, delete staging or
release capacity. Verified-but-unregistered sources and uncertain thumbnail
persistence also remain retained for bounded reconciliation; there is no legacy
upload fallback. Positive no-write proof permits malformed JPEG cleanup.

Closing write gates blocks new finalization/publication, including after the
source upload. Status lookup and cancellation of a known incomplete native
upload remain available with gates closed. Cancellation is refused for active,
completed or uncertain outcomes, rather than claiming storage was released.

## Release blockers still open

1. **Ordinary native-aware deletion is now prepared and tested**, including
   retained cleanup accounting and R2 absence confirmation; see
   `docs/native-asset-deletion.md`. Bounded native-JPEG reconciliation and
   aggregate diagnostics are now prepared in `docs/native-upload-recovery.md`;
   broader lifecycle/operator and P2-8 operational acceptance still remain
   before enabling this path in a connected environment.
2. Mobile/desktop Studio controls now have interactive mocked-native-response
   coverage; see `docs/native-upload-browser-acceptance.md`. This does not replace
   connected native browser/provider acceptance or the resource/restart/
   operational evidence in P2-5/P2-9.
3. Optional native schema remains outside automatic discovery. Connected schema,
   settings, real provider smoke tests, limits and publishing require separate
   approval. Neither RAW nor Creator video is enabled by this work.

## Initial integration evidence (before deletion/browser extensions)

```sh
node scripts/test-image-downloads.mjs --enable-uploads \
  tests/native-jpeg-intake.test.mjs tests/r2-multipart-journal.test.mjs \
  tests/resumable-uploads.test.mjs tests/retained-storage-capacity.test.mjs \
  tests/resumable-upload-client.test.mjs
npm run check
npm run build
```

**75 Node-reported tests passed, zero failures/skips.** The native HTTP suite
contains 11 scenarios covering selection/schema gates, Creator and official
delivery, admin-to-Creator accounting, concurrent/replayed completion, lost
part/Complete/database replies, closed-gate cancellation, unknown initiation,
mid-flight gate closure and invalid JPEG cleanup.

All data lives in disposable loopback PostgreSQL and local synthetic private
object fixtures. Test-only inventory removal is explicitly scoped to their new
gallery/session IDs; it does not assert that application deletion is finished.
No connected database writes, live R2 operations, paid AI calls or Production
changes were performed. TypeScript and the production bundle passed.

16 October update: the final native-flow suite now passes 22 Node-reported tests,
including deletion/recovery acceptance. It uses ordinary application deletion
for inventory teardown rather than manually removing variants and objects.
See `docs/native-asset-deletion.md` for the latest test-run boundaries.

The subsequent interactive browser controls and conservative finalization-error
handling are documented separately in `docs/native-upload-browser-acceptance.md`.
