# Media asset-object foundation

## Scope and activation

This is the second explicitly requested Development implementation package after
gallery ownership. It prepares additive relationships and compatibility readers,
not a marketplace launch. Current upload, display, analysis and download routes
do not create or consume the new variants. No new public endpoint, navigation,
upload format, subscription, financial feature or delivery bypass is enabled.

Only disposable local PostgreSQL fixtures were used to apply/test the new schema.
No connected database migration, historical backfill, bucket operation or
Production change is part of this work. The schema source is ready for the
project's normal approved Development merge process; there is no startup DDL,
custom Production migration runner or database-copy step. Review the additive
schema diff and obtain the separate approvals before any Production operation.

## Shared identity and compatibility

- Existing `media_items.id`, gallery relationships, URLs, captions, tags, manual
  identifications and safety versions remain unchanged. `image` maps to `PHOTO`;
  `video` maps to `VIDEO`. RAW never creates a second editorial media row.
- An optional title lives in the one-to-one `media_asset_records` extension,
  rather than adding a required column to every existing media SELECT. Title
  edits do not alter or fall back to captions. This package exposes only the
  internal repository contract; title UI is not activated.
- Private `readMediaAsset` reads old and new records. If all foundation tables
  are absent it returns the unchanged legacy representation; partial schema
  application fails explicitly. It never inserts, enriches or rewrites history.
- Legacy high-resolution files are `legacy_available_source`, not alleged
  originals. Only the existing Creator-original UUID marker retains its
  already-established original provenance. The marker is not authorization.
- Legacy URLs remain present even for foundation records, so old readers can
  still render them. There is no switch of current delivery/AI to a new key.
  Future consumers must use publication/safety/rights checks and the protected
  delivery resolver; this private data reader grants no file access.

## Physical inventory and variants

`media_asset_objects` holds one row per physical key, its immutable gallery /
official-or-Creator ownership snapshot, retention lifecycle and timestamp.
The key references the **existing** `media_object_routes` provider authority.
Provider, actual bytes, MIME, SHA-256, provider version and provider verification
state are joined from that table, not copied into a competing inventory.

`media_asset_variants` relates one media identity and source revision to
original / legacy source / preview / thumbnail / RAW / poster purposes.
A revision has one primary source; derivatives name that source's key in the
same media identity and revision. Several logical purposes may reference one
physical key without duplicating its stored-byte charge.

The repository:

1. Locks and validates the persisted gallery against the server-derived owner
   snapshot, then locks the media identity.
2. Locks target and source route keys in deterministic order, checks verified
   provider metadata and the expected SHA/version, and rejects stale inputs.
3. Requires primary sources to have no parent, and derivatives to reference the
   same asset/revision and retained owner/gallery. RAW requires a JPEG source.
4. Validates key-extension/MIME/purpose coherence. RAW metadata vocabulary is
   preparatory only: no RAW upload, decoder, safety approval or download is
   enabled. Container/content validation remains a later intake requirement.
5. Inserts the physical key once and rejects any second owner, gallery or
   incompatible lifecycle. No cross-gallery/owner deduplication is introduced.
6. Inserts immutable revision links, with idempotent identical retries.
   Conflicts roll back the complete transaction.

Internal writers require callers to authorize management before passing a
server-derived ownership snapshot. They are not permission middleware or an
alternative to reservations. Current intake does not call them: activating
new writes depends on complete capacity/reservation support and the subsequent
immutable-intake package.

## Lifecycle and deletion safety

Physical inventory lifecycle (`retained`, `deletion_pending`, `deleted`) is
distinct from provider verification state (`pending`, `verified`, `deleted`).
Deletion-pending bytes remain in reconciliation totals. A tombstone does not
prove that provider bytes disappeared.

All new relationships use restrictive foreign keys: existing media, galleries,
users and route records cannot cascade away while foundation records depend
on them. This deliberately prevents silent loss until reference-aware deletion
is implemented. There is no user-facing foundation deletion or owner-transfer
operation in this package.

The existing routed physical deletion path now checks for a foundation object
under the same route-key transaction lock used by registration. **Any**
foundation inventory row, including a tombstone, prevents the legacy cleaner
from deleting that key. This conservative guard is not a complete new cleanup
engine; capacity release, unlinking, provider confirmation, retries and
reconciliation belong to later packages. An unlinked retained object is not
automatically free or safe to delete.

## Read-only reconciliation preview

`previewAssetReconciliation` returns aggregate counts, known retained physical
bytes, unknown/unverified object counts, owner discrepancies and media without
variant links for one validated gallery. It does not return object identifiers,
contact a provider, list a bucket, download content or write a backfill.

Totals start from the physical inventory rather than a variant join, so two
links to one key count once. Unknown objects are reported explicitly; callers
must not treat the known-byte subtotal as an effective quota when that count
is nonzero. This is **not** the complete usage/allowance implementation:
reservations, failed legacy writes, profiles, reference documents, all retained
objects and beta-policy transition remain the next capacity package.

## Compatibility and rollback

No existing beta allowance, admin-owner exception, metadata priority, AI prompt,
matching threshold, worker or analysis schedule changes. No automatic backfill,
reanalyzing, object copying, original reconstruction or media rewrite occurs.

Before future activation, keep the old URL fields populated for compatible
readers. Roll back behavior by disabling new consumers, not by dropping tables
or deleting objects. Even during rollback, retain the routed-deletion guard
while inventory rows exist, or stop cleanup entirely. A reader rollback alone
does not make retained variants safe for legacy deletion.

## Objective verification

```sh
npm run check
npm run build
node --import tsx --test tests/media-asset.test.mjs tests/gallery-ownership.test.mjs
node scripts/test-image-downloads.mjs --enable-uploads \
  tests/media-asset-storage.test.mjs tests/media-objects.test.mjs \
  tests/gallery-ownership-storage.test.mjs tests/r2-new-upload.test.mjs \
  tests/image-download-routes.test.mjs tests/creator-upload.test.mjs \
  tests/video-delivery.test.mjs
```

The disposable runner creates a local database and local object fixtures,
never uses connected Development/Production data, and makes no live paid AI
calls. Assertions cover legacy image/video reads, optional title/unchanged
caption, provider/key/MIME/bytes/hash/version/lifecycle round trips,
one-key/multiple-link accounting, immutable revisions and retries, invalid
owner/source/format relationships, simultaneous competing key registrations,
unknown-size handling, restrictive deletes, legacy cleaner protection, and
complete/absent/partial foundation schema.

No claim of live recognition improvement, Production performance, RAW support
or complete marketplace capacity enforcement follows from these fixtures.

### Result, 15 October 2026

- TypeScript check and production bundle build passed.
- All six pure contract/ownership tests passed.
- All 31 selected disposable-database/storage regression tests passed, with no
  skips, including the ten foundation subcases and their parent test.
- The Development workflow restarted and the anonymous homepage rendered.
  The previously documented existing-media object-store upstream error (502)
  remains visible; no historical object investigation or repair was performed.
- Existing AI matching/prompt/worker files were not modified. The separately
  recorded conflicting historical AI assertions in `gallery-ownership.md`
  remain outside this package and are not counted among these passing tests.
