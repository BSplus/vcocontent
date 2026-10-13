# New-upload-only R2 — Development readiness

**Current plan supersedes all archive/restore instructions:** see
[clean-library/Production launch preparation](r2-production-launch-preparation.md).
Archive tooling has been removed. This older readiness document retains
historical evidence; its old archive commands are no longer available.

**Latest Development evidence:** [final minimal smoke — PASS](r2-final-development-smoke-report.md).
Five test objects and all associated records cleaned up; original 75 media
unchanged; upload gate closed. Clean-library reset and Production actions remain
separately unapproved. No further legacy migration work is required.

**Live smoke follow-up:** the subsequently approved test stopped with delivery
HTTP 404 in an untraced photo/video-preview group and an AI replacement-poster
overrun of the four-key cleanup allowlist. See the correction and local
reproduction in `r2-development-delivery-investigation.md`.
See `r2-development-live-smoke-report.md`. Upload gate is reclosed; separately
approved five-key cleanup is now complete and the baseline is restored.
Do not repeat uploads or run the archive without separate approval.

13 October 2026. Latest operator approval replaces existing-media migration with
new uploads plus a separately approved reversible archive. **No live smoke,
archive execution, old-object copying/deletion, Production access or deployment.**

## Implemented and staged

- Normal gallery photo/video/preview/poster writes select private EU R2.
  Existing IDs and `/api/media/files/<key>` URLs remain unchanged.
  Existing unmapped files still resolve through Replit; no dual writes.
- Official photo optimization keeps the decimal 5,000,000-byte budget and
  preview <100,000 bytes without adding a fixed 2560px limit. Creator source
  bytes, existing quota/rights checks, FFmpeg, AI input retrieval and protected
  proxy transfer/completion accounting reuse the existing pipeline.
- Development target guard runs **before a database connection**. The runtime
  managed Development target was independently verified as `helium/heliumdb`;
  deployment marker must be absent, bucket must be `vco-content-media-dev`,
  Production credential names must be absent, and the pinned target hash must
  match. Disposable local tests have their own loopback database/provider guard.
  A connection-address fingerprint alone is not proof of Dev/Prod separation.
- Minimal preparation on the explicitly selected managed Development database:
  nullable `media_items.archived_at`, active-media index, and the provider catalog.
  No startup DDL, migration ledger or historical source-copy framework.
- Archive exclusions cover gallery/search/public APIs, direct media and poster
  delivery, thumbnail selection, moderation/analysis selection and active
  Creator photo/byte quotas. Physical storage reporting still includes retained
  bytes; preserved events still count as events/galleries, not deleted entities.
- Archive is a metadata-only transaction with a frozen ID list, row fingerprints,
  locked parent events/media, exact cover checks and queued-cleanup refusal.
  It does not invoke object storage or cascade/delete records. Gallery deletion
  refuses archived children. Garbage collection still recognizes archived rows
  as references and cannot treat their files as unreferenced.
- Profile images/private reference documents remain on their existing Replit
  paths. Worker/public edge and bearer downloads are not required or activated.
  Protected downloads retain the app proxy, including Range and normal rights.

## Current Development configuration

In **Tools → Secrets → Configurations → Development**, not Shared/Production:

| Variable | Staged value |
|---|---|
| `MEDIA_STORAGE_ENVIRONMENT` | `development` |
| `MEDIA_STORAGE_PROVIDER` | `r2` |
| `MEDIA_STORAGE_ROUTING` | `enabled` |
| `MEDIA_STORAGE_NEW_UPLOADS_ENABLED` | **`false` — waiting for smoke approval** |
| `MEDIA_STORAGE_DATABASE_FINGERPRINT` | `1084b7369cf3f7180297632e6bbdeaf771549edf02e9451dae8d5f2d4963cdba` |
| `R2_ACCOUNT_ID` | operator's Development account ID, already configured |
| `R2_BUCKET` | `vco-content-media-dev` |
| `R2_JURISDICTION` | `eu` |
| `R2_STORAGE_CLASS` | `Standard` |

Development-only Secrets: `R2_DEV_ACCESS_KEY_ID`, `R2_DEV_SECRET_ACCESS_KEY`.
Do not put Production keys in Development or Shared. No audit/account-wide token.
The EU S3 endpoint is derived as
`https://<R2_ACCOUNT_ID>.eu.r2.cloudflarestorage.com`; no public bucket URL.

**New R2 gallery uploads are deliberately paused**, before reservation/provider
writes, until the operator separately approves opening the smoke gate. The app's
existing library still works using legacy Replit sources, and profile/reference
writes are unchanged. This is staged configuration, not evidence of a live smoke.

## Exact pending archive scope

Read-only frozen manifest: `generated-artifacts/r2/media-archive-manifest.json`.
It is ignored by Git/deployment, mode 0600, and contains original cover values
needed for restore; do not publish it or replace it to include later uploads.

75 existing Development rows, 55 photos and 20 videos:

```
6,7,8,9,10,11,12,37,38,39,40,41,42,43,44,45,46,47,48,
61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,
97,98,99,100,104,105,143,144,145,146,147,148,149,150,151,152,153,154,
159,160,161,162,163,164,165,170,171,172,173,174,175,344
```

If separately approved, only `archived_at` changes on these rows. Gallery
`cover_image` references to them would be cleared on event IDs
**1,2,5,7,8,10,13,14,18,19,20,21,26,27,28,32,57**.
Matching selected `custom_thumbnail` references would be cleared on **13,14**.
Independent artwork/custom thumbnails are retained; built-in fallback handles
cleared selections. These cover changes are captured for conditional restore.

All media IDs, ownership, captions/tags/AI results, dates, source URLs/bytes and
other metadata remain stored. **34 users and 23 events are preserved**.
Historical media download counters sum to **4**, unchanged. Related rows:
download history 0, operations 0, likes 0, favorites 0, analysis jobs 0,
**Nextcloud media links 1 — preserved**. Settings and other non-media tables
are not modified. No source objects are read, copied or deleted by the archive.

Current real database: **75 active / 0 archived / 0 R2 mappings**.
If any planned row/cover changes before approval, the transaction stops instead
of overwriting changes. A re-planned scope requires renewed operator review.

### Commands — prepared, NOT executed

Read-only planning: `npm run media:archive-plan` (exclusive manifest creation).
After separate explicit archive approval:

```
node --import tsx scripts/media-archive-plan.mjs archive --explicitly-approved-development-archive
```

Rollback archive, after separate operator instruction:

```
node --import tsx scripts/media-archive-plan.mjs restore --explicitly-approved-development-archive
```

The application must still target the verified Development namespace. The
manifest timestamp is saved before the transaction for recovery if its response
is lost. Restore checks the same rows and cleared cover slots, removes only its
archive timestamp and restores original cover values. Conflicting edits stop
the entire transaction for review; never overwrite new work or delete sources
to force a restore. Preserve the private manifest until restore is no longer
needed. Neither command is a generic media deletion/reset command.

## Prepared live smoke — requires separate approval

Do not repeat the connectivity probe or unsigned S3 request. Previous real
upload/read-back/SHA-256/size/cleanup passed; manual EU/Standard/private bucket
review is operator-confirmed complete. HTTP 400 from unsigned S3 was an
**invalid public-access verification method, not exposure evidence**.

Proposed smallest live scope:

1. Recheck Development namespace/hash, no Production keys, exact bucket, and
   current catalog. Operator approves smoke and temporary upload-gate opening.
2. Use authenticated Development test accounts only (not `LIVE_TEST_*`
   credentials), with permission for a Creator test gallery and an official
   test gallery for video. Existing user/galleries are not reset. Record an
   ownership allowlist for only new test records, keys, reservations/history
   and optional newly created test galleries. Private/draft throughout.
3. Upload **one newly generated Creator photo + preview**, and **one newly
   generated one-second video + poster** through normal authenticated app APIs.
   Expected 2 media rows / 4 owned R2 keys, not copied historical media.
4. Verify actual source SHA-256/size/MIME and R2 mapping/version; photo original
   byte identity, preview <100 KB, video playback and `206 Content-Range`.
   Verify owner display, anonymous/cross-account denial, restricted/premium
   non-expansion and download counters only for completed authorized transfers.
   Confirm quota accounting and optional managed-AI input/results without
   replacing manual tags. Model calls are only part of the newly approved scope.
5. Abort a transfer and repeat its completion identifier to check no extra
   credit; test manipulated keys and deny private responses public caching.
   Browser saving is not measured as a completed server transfer.
6. Reclose the upload gate. Delete only allowlisted newly created test rows/keys
   using normal controlled cleanup; verify those exact objects are gone and
   old rows/counters/source references unchanged. Preserve evidence, not files.
   Cleanup must never derive a broad prefix/bucket deletion.

No Worker deployment is needed for this proxy-based smoke. A later public
preview Worker needs separate bindings/auth secret/domain/deployment approval,
fresh app authorization before every cache hit, revocation checks and its own
live tests. Do not enable bearer original downloads or direct browser uploads.

Local preparation evidence: type check/build PASS; **9 focused R2 tests PASS**,
**18 download/access/thumbnail/Low-Res regressions PASS**, all disposable
PostgreSQL and mock/disk providers, never Cloudflare. Includes real local
FFmpeg clip/poster, source byte equality, AI input retrieval, private Range,
anonymous/cross-account denial, archive exclusions/restore/conflict refusal,
preserved counters/tags/history, quota release and owned-object cleanup.
Provider error assertions use sanitized errors, not raw upstream messages.
Actual cloud AI, browser playback and live R2/Edge latency are **not measured**.
Signed-in UI has not been visually verified; local authenticated HTTP routes
were tested. Historical bounded cost models and dated sources are in
`r2-migration-report.md`; migration sections are superseded, not launch gates.

## Production preparation — no settings changed

**Development Secrets/Configurations are not assumed to exist in Production.**
Before any later approved Publish, configure the following independently under
the **Production** configuration/publishing Secrets UI:

| Production setting | Required value / gate |
|---|---|
| `R2_PROD_ACCESS_KEY_ID`, `R2_PROD_SECRET_ACCESS_KEY` | Production-only bucket-scoped Secrets; never Development credentials |
| `R2_ACCOUNT_ID` | account owning the Production bucket |
| `R2_BUCKET` | `vco-content-media` |
| `R2_JURISDICTION`, `R2_STORAGE_CLASS` | `eu`, `Standard` |
| `MEDIA_STORAGE_ENVIRONMENT` | `production` |
| `MEDIA_STORAGE_DATABASE_FINGERPRINT` | independently verified **Production** target hash, still pending |
| `MEDIA_STORAGE_PRODUCTION_APPROVED` | `true` only after explicit activation approval |
| `R2_PROD_WRITE_ENABLED` | `false` until approved cutover, then `true` |
| `MEDIA_STORAGE_NEW_UPLOADS_ENABLED` | `false` until approved smoke/cutover, then `true` |
| `MEDIA_STORAGE_PROVIDER` | initially `replit`; switch to `r2` only at approved activation |
| `MEDIA_STORAGE_ROUTING` | initially `disabled`; `enabled` at approved activation |

Published runtime must supply `REPLIT_DEPLOYMENT=1` and `NODE_ENV=production`;
do not fake that marker in Development. EU endpoint is derived, bucket remains
private and Standard with public r2.dev/custom domains disabled. No account-wide
audit token or Worker/bearer signing is required.

**Remaining Production blocker:** obtaining/verifying the actual published
database identity and hash requires separately approved read-only Production
inspection. It has NOT been accessed to satisfy this report, and the Dev hash
must not be copied or treated as proof. Approval also needs a publishing schema
diff showing only intended additive columns/catalog, Production scoped settings,
an approved new-upload smoke and explicit cutover. Never use startup DDL or run
the archive against Production. The archive manifest/CLI is Development-only.

### Runtime rollback

Pause R2 uploads first. Keep routing enabled while active verified R2 mappings
exist; otherwise restarting would refuse readiness and URLs could become
unresolvable. Default new writes can return to Replit **with routing retained**
so verified R2 and legacy objects still read through their assigned providers.
If no active R2 mappings remain, provider/routing may safely return together to
`replit`/`disabled`. Do not copy/delete old sources, empty buckets, or assume
rollback restores already deleted objects. Production rollback requires its
own approval. Archive restore and provider rollback are independent operations.

**Next approval choices are separate:** the tiny live Development smoke;
the frozen 75-row archive and 17/2 cover-reference changes. Neither has run.
