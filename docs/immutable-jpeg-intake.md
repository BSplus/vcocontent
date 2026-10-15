# Immutable JPEG intake

## Scope and activation

Implemented for new uploads only. No migration, historical rewrite, Production
configuration change or publication is included. Professional EXIF/IPTC/XMP
extraction, enrichment, RAW sidecars and marketplace activation remain separate.

Existing limits are unchanged: Creator photos up to 5,000,000 bytes, official
photos up to the configured `MEDIA_IMAGE_MIB` (32 MiB by default), and the
configured pixel limit (40 MP by default). Larger upload sessions are not part of
this phase. Existing non-JPEG formats and historical optimized sources retain
their compatibility behavior.

## Source and derivative contract

- Validated JPEG input is kept byte-for-byte for official uploads, Creator
  uploads (including admin actions into a Creator gallery), and Nextcloud JPEG
  intake through the same storage helper.
- Full decode, MIME/format coherence, byte and pixel checks precede persistence.
  Missing EXIF/IPTC/XMP is valid. No new metadata extraction or metadata approval
  requirement was added.
- Orientation, embedded metadata and the source checksum remain unchanged.
  Rotation, resizing and metadata removal affect the derivative, not the source.
- Two persistent objects remain sufficient: original/source and bounded WebP
  display thumbnail (up to 100,000 bytes and 640 px). No permanent third object is
  added simply for downloading.
- Official standard High-Res downloads are temporary, metadata-stripped JPEG
  exports, using the existing quality-first 5,000,000-byte ladder and at most
  the existing bounded dimension reduction. Failure to fit produces an explicit
  download error, never a silently degraded or overwritten original.
- Standard official exports spool bounded input to temporary disk, share the
  processing concurrency/queue budget, honor cancellation and deadlines, retain
  the slot until native work settles, and clean up the temporary directory.
  There is no unbounded persistent export cache. Repeated High-Res requests
  therefore incur rendering work; any later cache must remain bounded and keyed
  by source version and export policy.

## Provenance and permissions

New official JPEG keys use UUIDv7; Creator's existing UUIDv8 source convention is
unchanged. Historical UUIDv4 sources are not relabelled as uploaded originals.
The compatibility asset reader distinguishes these sources without a database
backfill or a requirement to install the optional asset-foundation tables.

Markers establish provenance only, never ownership or permission. Gallery
ownership, authentication, premium/visibility/safety and archival checks remain
authoritative.

- An official gallery manager/admin may retrieve its exact original through
  the existing protected file route.
- Other signed-in visitors receive a metadata-stripped standard export from
  that same official file URL, not the newly retained original metadata.
- Official standard High-Res downloads remain signed-in only; anonymous
  official Low-Res downloads retain the existing access policy.
- Creator exact-source downloads retain their existing behavior in this phase.
  General Creator original-availability settings and privacy-filtered editorial
  exports still require the separately approved metadata workflow.
- No new enriched metadata, copyright or licensing fields are invented.
- Download option text reports the official export ceiling, not the potentially
  much larger preserved original's size.

## Accounting, integrity, AI and lifecycle

The reservation includes the entire retained JPEG plus its thumbnail. Saved
`highBytes`, `lowBytes` and `storedBytes` describe those persistent objects.
Temporary exports do not consume a permanent storage allowance. Persisting a
future download variant must instead use the retained-object accounting.

With provider routing enabled, the existing object store verifies the whole-file
SHA-256 and size against the stored object and records its version. Existing
write-once, private delivery and cleanup mechanisms remain in use; originals and
thumbnails are deleted together through the existing guarded deletion paths.

AI continues to derive its bounded recognition input from the validated source
and its context input from the thumbnail. No second recognition job, RAW job,
matching pass or safety bypass was introduced. Optional recognition failure
still does not determine upload validity.

## Verification

All tests use synthetic users, disposable local PostgreSQL and local/mock
storage/provider transports. No live R2 bucket or paid AI service was exercised.

- Immutable JPEG cases pass: both operating models, source bytes/SHA-256,
  orientation and EXIF retained only in originals, metadata-free images,
  malformed/truncated/spoofed inputs, 40-MP boundary, oversized pixels,
  exact byte ceilings and over-limit rejection, cancellation and temporary-file
  cleanup.
- Route cases pass: actual multipart upload at the official byte boundary,
  unauthorized official upload, Creator/admin source preservation, standard and
  anonymous Low-Res delivery, archive access denial and private originals.
- Isolated R2 checks pass: verified route SHA-256/size, exact JPEG retrieval,
  metadata-stripped export, absence from the Replit fixture store, and cleanup.
- Asset compatibility, download labels, caption/vehicle recognition and capacity
  checks pass. TypeScript and production build pass.

The combined targeted run initially had 73 passes and two failure records
(the capacity parent and one child) because an archived route fixture prevented
its gallery cleanup. Restoring that synthetic fixture before deletion fixed the
isolation issue; the route-plus-capacity run then passed all 11 checks.

A broader initial run had one OCR-control failure. The untouched baseline's
targeted control passed; the current full number-evidence suite then passed all
15 cases separately. This is not proof of a fixed OCR/runtime issue or a live
recognition-quality improvement. The previously documented unrelated
Creator-caption/queue baseline failures were not changed by this work.
