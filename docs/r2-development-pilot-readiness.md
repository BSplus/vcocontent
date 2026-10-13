# Controlled Development migration pilot — readiness

**Superseded by the operator's new-upload-only, empty-library launch plan.**
Do not execute this pilot or treat its migration prerequisites as launch blockers.
See [the current first report](r2-new-upload-launch-plan.md). The findings below
are historical.

13 October 2026. **Planning only; NOT READY to execute.**

## Confirmed

- Authenticated Development R2 upload, read-back, actual-byte SHA-256, length and
  owned-test-object cleanup: **PASS**. Bucket settings review: **complete, reported
  by the operator**, not an automated management-API audit.
- The previous unsigned S3 HTTP 400 is an **invalid public-access verification
  method**, not evidence of public exposure. No repeat is needed for this plan.
- Fresh-process configuration: Development, unpublished runtime, target
  `vco-content-media-dev`, Development credential names present, Production
  credential names absent; default provider **Replit**, routing **disabled**.
- Read-only queries explicitly selected Replit's **Development** database:
  `heliumdb`. The application's configured database name agrees. No Production
  database query or connection comparison was made.

## Isolation and candidate findings

Replit manages separate Development/Production databases, but database separation
does **not** imply source-object separation. Official documentation states that
App Storage shares data between Development and Production of the same app.
This code uses the project-default Replit bucket, with no environment-specific
source bucket binding. Thus **Development-only source provenance is unverified**.
Neither a test-labelled gallery nor a database-target digest proves that its
objects are absent from Production. Require authoritative source provenance and
an explicit key allowlist, or approved creation of new Development-only fixtures.
Do not examine Production media to resolve this without separate authorization.

Bounded Development metadata inventory: 75 records, four object-backed
original/preview pairs. No source object was read or copied.

| Coverage | Conditional candidate | Assessment |
|---|---|---|
| Official photo + preview | Media **175**, gallery **32**; alternative **174** | Test-labelled; object-backed WebP pair. Source provenance and actual byte sizes/MIME still need verification. |
| Creator original + preview | Media **172**, gallery **31**, owner **16** | Object-backed, but not test-labelled; do not approve solely because it exists in Development. |
| Restricted/premium photo + preview | Media **170/171**, premium gallery **29** | Base64-backed; **excluded from this object-copy pilot**. A Development-only object-backed restricted fixture is missing. |
| Video + poster | Media **173**, gallery **31**, owner **16** | Object-backed; provenance, size and playable bytes remain unchecked. Other sampled video sources are external/legacy. |

These are **candidates, not an executable migration allowlist**. No source
existence, checksum, actual MIME, permissions or playback test has been claimed.

## Remaining prerequisites

1. Prove source provenance; approve owners/galleries and the final eight unique
   keys. Supply/approve an object-backed restricted fixture. Exclude Base64,
   external URLs, reference documents, avatars and profile covers.
2. Pin the verified Development target using `MEDIA_STORAGE_DATABASE_FINGERPRINT`
   and `MEDIA_MIGRATION_DATABASE_NAME`. Both are currently unset. A digest is a
   target-change guard, not independent proof of Production separation.
3. Approve Development-only additive schema preparation. Both
   `media_object_routes` and `media_object_migrations` are absent in the managed
   Development database. No schema changes were made.
4. Prepare and test a **copy-only** path first. The current `pilot` command
   requires routing enabled and calls `ledger.activate()` after copying.
   It must **not** be run under the present authorization. Also, the disabled-
   routing startup guard rejects retained-source route records; do not bypass it
   or silently enable routing to make a copy-only journal work.
5. The copy-only path must provide conditional target creation/conflict detection,
   a resumable journal, and source protection compatible with disabled routing.
   Demonstrate that neither the copier nor concurrent cleanup can delete the
   allowlisted sources. Stop on conflicts, changed associations or missing proof.

## Proposed scope and gated execution

**Phase A, after explicit approval and prerequisite completion:** four
Development-only media records and exactly **eight unique objects**: official
download/preview, Creator original/preview, restricted original/preview, and
video/poster. Proposed pilot cap: **25 MiB aggregate**, video **20 MiB maximum**,
one object at a time. These selection caps do not change application limits.
The exact fourth ID and final key manifest cannot be fixed until the missing
fixture and source provenance are resolved.

1. Read-only allowlisted inventory; snapshot media/event IDs, URLs, ownership,
   visibility, premium/entitlements, safety state, all metadata, AI/manual tags,
   identifications, quotas and download counters. Record source versions.
2. Copy existing bytes unchanged to the private Development R2 bucket under the
   same keys. No transcoding, new media IDs, variants, source deletion, default
   provider switch or application mapping activation.
3. Verify SHA-256 from full source and target bytes, length, actual MIME/signature,
   version and association. Re-read pinned source proof; compare metadata and
   counters to the baseline. Preserve official <5,000,000-byte downloads and
   <100,000-byte previews; Creator originals remain byte-identical.
4. Produce per-key evidence, errors and reconciliation. Any mismatch stops the
   run. Resume only matching verified entries; never overwrite a conflicting key.

**Phase B requires separate explicit routing-test approval:** verify unchanged
media links, authorized/anonymous/cross-account/restricted access, video Range
and playback, FFmpeg and AI reads in an isolated validation instance/database.
Do not write new AI tags to existing media. Use isolated counters to prove
completed transfers count once and aborted transfers do not; keep the live
Development counters intact. Protected downloads remain on the authenticated
proxy, without bearer-link activation. The ordinary app remains Replit/disabled.

**Rollback:** Phase A creates no active app mappings, so Replit delivery remains
unchanged. Retain source objects and copies/evidence; do not delete either
automatically. If separately approved Phase B activates validation mappings,
verify retained source bytes/versions and associations before switching only
those validation mappings back to Replit. Any R2-copy cleanup needs its own
explicit allowlisted approval; never empty a bucket or delete sources.

## Worker

**Not required for copying, private S3 integrity checks or proxy validation.**
Edge preview testing is a later separately approved phase: configure isolated
`MEDIA` binding to `vco-content-media-dev`, `jurisdiction = "eu"`,
`DEVELOPMENT_ONLY=true`, isolated `APP_ORIGIN`, and the same
`MEDIA_EDGE_AUTH_SECRET` on Worker/app; configure app `MEDIA_EDGE_ORIGIN` only for
that isolated test. Require current authorization before every cache hit and
revocation/security tests. The example is not deployed; no Worker secret/domain
change or deployment is authorized by this report.

Source: https://docs.replit.com/features/data-and-storage/object-storage
and https://docs.replit.com/features/data-and-storage/development-and-production
(consulted 13 October 2026). No live R2 request, media byte read, copying, routing
change, database write, source deletion, Worker rollout or Production access was
performed during readiness preparation.
