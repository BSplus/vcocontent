# Retained storage accounting and reservations

## Scope

Development implementation of the capacity foundation from the unified
marketplace specification. No new schema, migration, historical backfill,
provider write, subscription activation, RAW upload endpoint or Production
configuration change is introduced.

The existing beta limits, bounded quota exception and admin-owner exemption
remain unchanged. Official galleries have measured operational usage but no
Creator subscription dependency. Admin uploads into an ordinary Creator gallery
use that gallery owner's existing allowance.

## Authoritative inventory

Count unique physical keys across legacy originals/thumbnails, registered asset
objects, reference documents, inline profile/cover images and pending cleanup.
Archived/hidden media remain stored and therefore remain charged. Distinct
logical variant links do not duplicate bytes. Shared identical inline payloads
also count once. Registered RAW is counted like any other persistent asset;
this does not enable RAW intake.

Verified route sizes take precedence over older media-row estimates. Unmeasured
objects are reported as unknown, not treated as free space. Missing additive
asset tables use legacy inventory; partially installed tables fail explicitly.
Accounted asset objects require their verified route measurement even if a
legacy row also references the same key.

In-progress objects are covered by their reservation once. Reserved capacity is
the greater of the original reservation and already measured retained bytes for
its keys; a smaller reservation cannot hide larger partial writes. Pending
cleanup retains capacity until confirmed removal. Durable asset objects still
protected by the existing deletion fence remain charged; this package does not
implement their later lifecycle deletion workflow.

Temporary download caches are not persistent asset inventory. Future persistent
sidecars must join this inventory explicitly when their storage support is
implemented; no sidecar or export system is created here.

## Atomic write boundaries

- Owner row locking serializes Creator reservations across galleries and
  database connections. Lock the owner before the gallery in both reservation
  and finalization paths.
- Finalization validates server-provided byte totals and rechecks additional
  capacity if generated output exceeds the reserved amount. Technical event
  limits remain applicable to official uploads as well.
- Physical variant registration takes the same owner lock and verifies current
  capacity after registering, in the same transaction. A failed budget check
  rolls back the registration.
- Failed finalization retains its reservation for the existing cleanup path.
  Successful finalization replaces reserved capacity with actual file usage.
- Reference replacements reserve the full new source while the old source is
  retained, including when an admin acts on another Creator's gallery. A full
  account must free capacity before replacing a file; an unconfirmed deletion is
  not replacement credit. Duplicate reuse of the same source still adds nothing.
- Existing original bytes, AI evidence, matching/caption policies, free-download
  access and independent publication-safety rules are unchanged.

## User-visible reporting

Creator usage includes stored bytes, upload reservations, known available space,
unknown-size state, pending cleanup, per-type and per-gallery retained usage.
Unknown sizes produce no claim of a known available balance. At 80% usage the
existing dashboard warns about capacity. Per-gallery retained summaries exclude
account-level profiles, unattributed cleanup and uncommitted reservations; those
remain in the account total.

The admin storage panel exposes separate official retained/reserved usage.
Its pre-existing media-row summaries are explicitly labelled as partial summaries
rather than presented as complete physical inventory. No per-Creator N+1
inventory scan is added to the admin dashboard.

## Verification

Run only through the disposable PostgreSQL/object-store fixture runner:

```sh
node scripts/test-image-downloads.mjs --enable-uploads \
  tests/retained-storage-capacity.test.mjs \
  tests/gallery-ownership-storage.test.mjs tests/media-asset-storage.test.mjs \
  tests/media-budget.test.mjs tests/image-download-routes.test.mjs \
  tests/creator-upload.test.mjs tests/creator-profiles.test.mjs \
  tests/public-beta.test.mjs tests/community-studio.test.mjs \
  tests/creator-event-association.test.mjs tests/photo-matching.test.mjs \
  tests/video-analysis.test.mjs tests/video-delivery.test.mjs
```

Coverage includes retained archived/hidden files, key deduplication, RAW and
derivative accounting, authoritative sizes, unknown-state blocking, owner
isolation, official accounting, partial-write reservations, cross-gallery
concurrency, output overage, registration bypass, successful commit and
legacy-schema compatibility. Providers are mocked; this is not a Production
inventory, paid-AI quality check or approval to publish.

### Verification results

- Focused ownership, asset inventory, reference API and capacity suites:
  **39 passed, zero failed, zero skipped**.
- Targeted real reference-capacity flow: **one passed**; 17 unrelated cases were
  intentionally filtered out by name. This verifies confirmed CSV import,
  same-source reuse, full-account rejection for both owner and admin,
  replacement after freeing space, and final deletion accounting.
- Creator Studio browser suites: **two passed**, covering Creator/admin views at
  desktop and mobile widths, storage text/type breakdown, no horizontal overflow,
  loading/error navigation and no mocked API writes. These are synthetic
  authenticated browser fixtures, not verification of a signed-in live account.
- TypeScript and production build passed.

The broad mixed run initially passed 150 of 154 assertions. One failure was the
reference API's existing replacement-status expectation; preserving that status
was fixed and the focused reference suite passed afterward. The other three
failures reproduce against an untouched isolated repository baseline: two
`community-studio` checks expecting automatic background captions and one
`public-beta` queue-neighbor fairness check. They remain unresolved, not weakened
or described as passing. The older reference-capacity fixture was updated to
submit required confirmed rows and assert the new retained-source safety rule.

The preview homepage renders, but an existing media request still reports an
upstream storage 502. No historical object or Production data was repaired.
