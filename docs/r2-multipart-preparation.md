# Native R2 multipart preparation — isolated tests only

Date: 15 October 2026.

## Scope and approval

The operator approved preparation and disposable tests up to **250 MiB**.
This is not approval to raise application file limits, activate large uploads,
apply schema changes, change hosting/bucket configuration or publish.

The private provider transport, PostgreSQL journal and atomic lifecycle repository
are prepared; see `docs/r2-multipart-journal.md` for the newer handoff/cleanup
evidence. **P2-5 is not feature-complete**:
normal HTTP/Studio intake still uses the existing transport and limits.
No connected database, live bucket, paid AI service or Production endpoint was
used by these tests. The generated large payload is an opaque transport fixture,
not evidence of accepted 250-MiB JPEG/RAW/video content or codec validation.

## Implemented

- `server/r2-multipart-driver.ts`: private, fixed-bucket native S3 multipart
  operations through the existing EU Standard configuration. No URLs or
  credentials are issued to browsers. A dedicated real SDK client disables
  automatic retries of potentially non-idempotent operations.
- `server/r2-multipart-upload.ts`: bounded regular-file transport using one
  reusable **8-MiB data buffer**, sequential equal-sized nonfinal parts, a final
  short part, a 250-MiB preparation ceiling and the existing two-active /
  eight-waiting process work budget.
- Full-file SHA-256 is checked before initiation and over the bytes supplied to
  the provider. Each part sends Content-MD5. Provider ETags are used as part
  identifiers/checks, never as whole-file SHA-256.
- Resume reconciles bounded provider part listings with the immutable source and
  persisted receipts. Missing/corrupt acknowledged parts, holes, extra parts and
  truncated listings fail explicitly, rather than overwriting acknowledged data.
- Successful completion requires metadata ownership, actual size/MIME and an
  independent complete SHA-256 read pinned to the provider object version.
  Retrying verified completion does not require the local source or repeat the
  upload/completion operation.
- Actor, gallery, ownership revision, source hash/size, key, provider scope and
  expiry bind the checkpoint. Mandatory authorization callbacks recheck
  permission/ownership/capacity before progress and finalization.
- Known cancellation confirms both absence of multipart state and absence of a
  committed destination before returning an aborted checkpoint. Failed/uncertain
  cleanup is retained, not reported as quota release.
- Symlinks/nonregular sources, size/hash changes, expiry and over-limit plans
  cannot commit. SDK failures use sanitized errors, not raw provider messages.

## Disabled runtime boundary

`R2Store.preparedMultipart()` is not called by existing upload routes.
Its new writes require explicit `MEDIA_R2_MULTIPART_ENABLED=true`, the normal
new-upload gate, R2 routing/provider selection, the matching database fingerprint
and the strict Development R2 configuration. **Production is rejected even if
all flags are supplied.** Read/recovery and authorized cleanup remain possible
with write flags off.

No environment settings were changed. Final Development inventory:

- `MEDIA_RESUMABLE_UPLOADS_ENABLED=true` — the previous current-limit feature.
- `MEDIA_STORAGE_NEW_UPLOADS_ENABLED=false`.
- `MEDIA_R2_MULTIPART_ENABLED` — not configured, therefore no new multipart writes.

The existing `ObjectStore.put` ceiling and all normal per-user/per-file rules are
unchanged. RAW, Creator video, subscriptions and exact-original availability
were not enabled or altered.

## Actual verification

- **23 distinct multipart checks passed** across the final suite and targeted
  cancellation follow-up. The full 22-case run passed before the additional
  cancellation collision case; the four affected cancellation cases then passed.
- **11 existing R2/private-delivery and resumable-client regression checks passed**.
- TypeScript passed after the final code change; the production bundle build
  passed. Nothing was published.
- The 250-MiB transfer used 32 provider parts, one reusable 8-MiB buffer and no
  whole-file allocation. Latest sampled process RSS growth: **55.4 MiB**.
  This is local fixture evidence, not a hosted-VM memory/latency promise.
- Lost part replies, pause, disk-receipt/new-engine resume, lost completion,
  unknown initiation/completion, permission changes, key/owner tampering,
  corrupt source/provider bytes, lease conflicts, closed gates and cleanup
  ambiguity are exercised.
- All private temporary fixture directories were removed.

Tests use a synthetic SDK transport whose provider bytes live on disk. The
test-only journal rereads atomic JSON checkpoints and provides an in-process
destination lease. This is not a production database journal, cross-host lease,
real process-crash test, real R2 protocol acceptance or end-user 250-MiB smoke.

```sh
node --import tsx --test --test-concurrency=1 \
  tests/r2-multipart-upload.test.mjs tests/r2-storage.test.mjs \
  tests/resumable-upload-client.test.mjs
npm run check
npm run build
```

The preview workflow restarted and the homepage renders. The previously
documented existing-media upstream 502 remains outside this package; no
historical file or Production data was repaired.

## Remaining integration/release gates

1. A real database-backed journal, key lease and reservation binding are now
   prepared and tested: see `docs/r2-multipart-journal.md`. Its optional schema
   remains outside the active schema entry point. Atomic media-registration
   handoff and native-aware local staging cleanup are still required before
   HTTP integration or activation. There is no in-memory application fallback.
   Review/apply additive schema changes only with separate approval.
2. Reconcile uncertain initiation/completion with narrowly proven provider
   ownership. A lost Create reply retains `initiating` and never creates again;
   a missing completion retains `completing` and never blindly completes again.
   Unknown provider IDs are not guessed, aborted or broadly listed for cleanup.
3. Wire the existing authenticated HTTP/UI flow behind disabled gates, with
   real quota/temp-disk/session bounds, independently reviewed larger-file and
   format policy, content/safety validation and atomic asset registration.
4. Test real process restart, distributed lease behavior if relevant, bounded
   live Development R2 operations and user-visible recovery under separate
   approval. Confirm conditional-write/destination fencing against the real
   provider; this preparation does not assume undocumented conditional support
   on CompleteMultipartUpload.
5. Obtain separate schema, activation and Production publishing approvals.

Provider documentation checked:

- https://developers.cloudflare.com/r2/api/s3/api/
- https://developers.cloudflare.com/r2/objects/multipart-objects/

R2 requires equal-sized nonfinal parts of at least 5 MiB; the final part may be
smaller. Its documentation warns that replacing a part can lose its old data
even when the replacement fails. These are reasons to reconcile rather than
blindly replay acknowledged parts.
