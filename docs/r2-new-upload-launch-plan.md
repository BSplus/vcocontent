# R2 new-upload launch — first report

**Current scope:** [Production R2 launch checklist](r2-production-launch-checklist.md).
The old database-reset prerequisite below is superseded. Keep the accepted clean
Production database. The old Nextcloud connection and document 48 are not needed
and must not be restored. Do not execute old cleanup SQL or migrate dummy media.
Earlier reversible archival recommendations below are superseded and their
tooling removed. No legacy media migration or archival system is required.

**Superseded implementation status:** see [Development readiness](r2-new-upload-readiness.md).
The read-only audit below is historical planning evidence, not current runtime settings.

13 October 2026. **Plan and read-only audit only; no runtime switch, reset,
upload, deletion or deployment.** This supersedes the existing-media migration
and pilot plans. The operator approves launching without the old gallery photos
and videos, but has not approved deleting records or objects.

## 1. Simplest implementation path

- Keep the existing upload/validation/processing pipeline and one small storage
  adapter. Route **new gallery/media uploads**—official, Creator and Nextcloud
  photo/video imports, previews and posters—to the correct private EU R2 bucket.
- Keep one compact object provider/integrity catalog for durable upload state,
  UUID keys, metadata/version verification, analysis, Range reads and safe
  own-object cleanup. New R2 objects must never silently fall back to Replit.
- Remove the migration CLI, copy/reconciliation workflow, retained-source
  workflow and migration-ledger startup requirement from the new-upload launch
  path. No copy-only pilot or legacy migration is needed. Existing evidence can
  remain historical documentation.
- Keep the Replit adapter for unchanged private-reference/profile-image paths
  and untouched old objects. This is compatibility, not dual-write; it does not
  authorize moving these other object families or redesigning profile work.
- Preserve existing optimizers and limits: one official optimized download under
  5,000,000 bytes and preview under 100,000 bytes, no new 2560px cap; Creator
  originals byte-identical with unchanged quota limits; unchanged video/FFmpeg
  processing, access controls, AI/manual tags and completed-transfer statistics.
- Keep existing app-authorized preview and protected-download routes. Buckets
  remain private, without public `r2.dev`/custom-domain access or browser bearer
  downloads. Protected transfers stay on the authenticated proxy.
- A Worker is **not required** for the initial upload/display/Range smoke test.
  The existing optional Edge-preview design remains separately gated: current
  app authorization before cache hits, revocation tests, isolated configuration
  and explicit deployment approval. Do not activate Edge original downloads.

## 2. Empty-library audit and recommended reset

Fresh read-only **Development** audit, not Production counts:

| Item | Count |
|---|---:|
| Media records | 75: 55 photos, 20 videos |
| Inline Base64 original URLs / object-backed original URLs | 16 / 4 |
| Sum of media completed-download counters | 4 |
| Users / events | 34 / 23 |
| Events with cover fields / custom-thumbnail fields | 17 / 9 |
| Download-history/operation rows; media likes/favourites; analysis jobs | 0 currently |
| Nextcloud mappings linked to media | 1 |
| Pending object-cleanup rows / upload reservations | 0 / 0 |

Schema inspection confirms cascading media foreign keys from download history,
download operations, likes, favourites and analysis jobs; Nextcloud links become
NULL when their media row is deleted. Normal media deletion also **enqueues
physical object deletion**. Thus neither normal delete endpoints nor a broad
`DELETE`/`TRUNCATE ... CASCADE` is a safe unapproved reset.

**Recommended first reset, only after separate approval:** retire/archive the
old media records from the active library rather than cascade-delete them.
A small archived-media state can preserve historical counters/relationships
without migrating old files or building a migration service.

- Take a verified backup and explicit per-environment record/reference manifest.
- Mark only approved old records inactive; exclude them from galleries, searches,
  counts and active Creator quota usage. Preserve quota limits and historical
  download data; prevent old jobs/imports from republishing archived items.
- Deny archived originals/previews through every direct/legacy media delivery
  route too; hiding gallery cards alone is insufficient. Do not return archived
  inline-image payloads through history/community endpoints.
- Clear only approved old-media cover/thumbnail references, not event records,
  event details or unrelated artwork; retain the trusted brand fallback.
- Preserve users/authentication, events/series/lineups, settings, credits,
  entitlement/history data, Nextcloud access/configuration, private reference
  documents and profile assets. Leave every storage object untouched.
- Never reuse/reset media ID sequences. Retain the manifest/backup for rollback.

Archiving is a **proposed reset**, not performed or independently authorized.
It leaves old bytes in storage/database pending a separately approved physical
cleanup. If hard deletion is preferred later, first settle the historical-data
policy and audit Production relationships; do not assume Development's zero
history rows describe Production.

**Remaining blockers:** approval for the reset semantics/manifest; Development
provider/integrity schema and verified database target pin; implementation of
new-upload-only startup and archived-media access rules; successful new-media
smoke test. Existing-source provenance/copy-only tooling are no longer launch
prerequisites because old media will not be migrated. Production reference counts
and configuration were not inspected; Production needs its own approved audit.

Current Development configuration remains `MEDIA_STORAGE_PROVIDER=replit`,
`MEDIA_STORAGE_ROUTING=disabled`, bucket `vco-content-media-dev`. No media reset
or R2 activation has occurred.

## 3. Production configuration — later, only after approval

Production secrets, **independently** configured/reviewed under Publishing →
Adjust settings → Production app secrets:

- `R2_PROD_ACCESS_KEY_ID`
- `R2_PROD_SECRET_ACCESS_KEY`

Use the Production-only bucket-scoped S3 credential; no audit/account-wide token.
Never rely on Development secrets being present or use them as fallback.

Non-secret Production values in a **published/Production configuration**, not a
shared or Development testing configuration:

| Variable | Eventual approved value |
|---|---|
| `MEDIA_STORAGE_ENVIRONMENT` | `production` |
| `R2_ACCOUNT_ID` | Production account ID |
| `R2_BUCKET` | `vco-content-media` |
| `R2_JURISDICTION` | `eu` |
| `R2_STORAGE_CLASS` | `Standard` |
| `MEDIA_STORAGE_DATABASE_FINGERPRINT` | Digest of the independently verified Production target |
| `MEDIA_STORAGE_ROUTING` | `enabled`, only at approved activation |
| `MEDIA_STORAGE_PROVIDER` | `r2`, only at approved activation |
| `MEDIA_STORAGE_PRODUCTION_APPROVED` | `true`, only after explicit approval |
| `R2_PROD_WRITE_ENABLED` | `true`, only after explicit write/cleanup approval |

The endpoint is derived as
`https://<account-id>.eu.r2.cloudflarestorage.com`; optional `R2_ENDPOINT` must
equal it. The published runtime also requires `NODE_ENV=production` and the
platform published marker; do not simulate that marker in Development. Keep
the managed database connection and other existing application secrets intact.
No migration-only variable or Worker secret is required for the initial proxy
delivery path. Validate Production's private EU Standard settings separately.
These are **instructions, not settings applied by this report**.

## 4. Minimal Development smoke-test plan

After approval for Development implementation/activation and the scoped test:

1. Apply only approved Development schema/target binding, remove the unused ledger
   dependency, and enable new R2 uploads **only in Development**. Production stays
   unchanged. No broad library reset is needed to test a private fixture gallery.
2. Use an authenticated Development test actor and isolated test-owned gallery.
   Create **two fresh media records/four R2 objects**: a small Creator photo with
   generated preview, and a short video with generated poster. Do not reuse old
   gallery objects, Production fixtures or LIVE test credentials.
3. Exercise real normal upload/display/preview/playback and video Range paths.
   Verify photo original SHA-256/size against input, object MIME, preview budget,
   quota accounting and poster generation. Existing focused local tests cover
   official optimization without another large legacy-media suite.
4. Verify owner access and anonymous/cross-account denial for protected media,
   including guessed direct keys. Use app routes—not unsigned S3 status—as access
   evidence. Exercise restricted/unpublished state only on test-owned fixtures.
5. Verify one bounded AI read/processing result where practical and FFmpeg/video
   processing. Record AI/provider blockers honestly; do not claim recognition
   accuracy from synthetic fixtures. Do not modify real media tags.
6. Check completed-transfer counting/idempotency and incomplete server-transfer
   behaviour. A client abort after server completion does not undo a valid count.
7. Clean up **only this run's newly created records and four owned keys**, verify
   absence, quota/reservation release and no leftover worker/job references.
   The scoped smoke-test approval must include that cleanup; no existing
   records/objects or bucket-wide cleanup are included.

Implementation and the smoke test are not yet run. Default-switch rollback is
not just flipping routing off if R2 mappings remain: first retire/clean only
approved test mappings or keep routing available for active R2 media. Production
cutover, Production reset, object deletion and deployment remain separate approvals.
