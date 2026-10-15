# Gallery ownership foundation

This first Development implementation package covers ownership classification
and upload reservation/commit fences only. It introduces no schema change,
backfill, content cleanup, subscription, RAW/video expansion or payment feature.
Existing content is not migrated. Production has not been changed or deployed.

## Contract

- A persisted gallery with explicit `creatorId: null` is `OFFICIAL_VCO`.
- A persisted gallery with a positive integer Creator ID is `CREATOR(ownerId)`,
  including when the owner or uploader is an admin.
- Missing/invalid gallery context is rejected, never interpreted as official.
- The uploader, author credit, series and official-event association cannot
  change accounting ownership.
- Existing reservation owner/gallery fields are the upload snapshot. Reservation
  creation compares this snapshot with the locked gallery; commit repeats the
  comparison and verifies that a Creator owner exists in the same transaction.
- Changed/deleted galleries cannot produce an orphan media row. Failed commits
  leave the reservation available for the existing abandonment/cleanup path.
- Classification never changes existing role, moderation or public-download rules.

| Actor | Official gallery | Own Creator gallery | Other Creator gallery |
| --- | --- | --- | --- |
| Active authorized admin | Manage; official accounting | Manage; Creator accounting | Manage; target Creator accounting |
| Active approved Creator | No management | Manage; own accounting | No management |
| Anonymous, suspended or unapproved ordinary account | No management | No management | No management |

Approved Creator status remains sufficient without the older role flag. Admin
status does not transfer ownership or turn a Creator gallery into official
content. Existing official-event associations remain links only.

## Intentional limits

The existing beta policy remains in effect. In particular, the admin-owner
budget exemption is **not** removed in this package: classification correctly
identifies those galleries as Creator-owned, but the versioned allowance
transition and full retained-byte accounting belong to the later capacity
package. No claim of complete marketplace quota enforcement is made here.
Existing official technical resource limits remain; no Creator subscription
lookup is introduced. Ownership-transfer UI/API is not added.

No photo AI input, matching, captions, suppression, model or thresholds change.
No newly required metadata or UI step is added.

## Verification

Pure contract tests cover invalid/ambiguous context, owner snapshots and category
changes. Isolated PostgreSQL tests cover the existing role/owner management
matrix, official quota independence, admin uploads, official association,
admin-owned Creator galleries, commit-time ownership drift and deleted galleries.
All new integration writes require the disposable local database/object runner;
they do not use connected Development or Production data.

```sh
node --import tsx --test tests/gallery-ownership.test.mjs
node scripts/test-image-downloads.mjs --enable-uploads tests/gallery-ownership-storage.test.mjs
```

The broader isolated baseline command for this package is:

```sh
node scripts/test-image-downloads.mjs --enable-uploads \
  tests/gallery-ownership-storage.test.mjs tests/creator-upload.test.mjs \
  tests/image-download-routes.test.mjs tests/photo-matching.test.mjs \
  tests/video-analysis.test.mjs tests/video-delivery.test.mjs
```

Existing upload/download and photo/video analysis regression suites remain the
baseline. Reverting this package requires code rollback only: no database or
object restore/migration is introduced. Do not remove ownership fences in a
rollback without considering in-flight uploads.

## Development verification result

15 October 2026: `npm run check` and `npm run build` passed. Pure ownership,
download-access and tag-reconciliation checks passed all nine tests; the broader
disposable-database command above passed all 58 tests with no skips. This
includes existing Creator uploads, image delivery, photo matching, sampled-video
analysis and Range delivery. Providers were mocked; no live AI quality or
Production readiness claim is made.

The Development workflow restarted successfully and the anonymous homepage
rendered in the preview. One existing media request logged an object-store
upstream error (502). Existing content/storage investigation was not part of
this new-upload package, and no historical object was inspected or repaired.

### Independent matching change already in the integration baseline

The integration baseline `ab28137` (“Refactor caption matching logic and update
photo evidence processing”) already contains the separately merged entry-list
vehicle-authority change. The ownership implementation commit `7ee12c2` changes
only the two upload/storage consumers, the ownership contract, its tests and
this document. It does not change reference matching, caption generation,
recognition, analysis workers or video aggregation. Comparing those AI files
between the integration baseline and this package produces no diff.

An additional check requested during completion,
`node --import tsx --test tests/photo-caption-omission-diagnosis.test.mjs`,
passes eight tests and fails two assertions that still require visual
manufacturer/vehicle conflicts to veto reference matches. Those assertions
conflict with the separately merged entry-list precedence behavior. The tested
matching source and test file are byte-identical to the integration baseline,
so these are recorded baseline failures, not ownership changes. They have not
been weakened, updated or silently counted as passing. Reconciling that
separate matching specification/test conflict is outside this ownership
package; reverting the separately merged behavior here would violate scope.
