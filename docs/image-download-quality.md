# Photo quality and storage review

## Previous behavior and the new contract

Every new photo formerly became a max-2560px WebP, trying quality
86/76/64/52/40 until below 4 MiB. This discarded Creator originals too.
Previews used a 100-KiB rather than decimal 100,000-byte boundary.

New photos keep the existing private two-object model and authorized streaming,
download counting, premium restrictions, moderation, durable reservations and
cleanup. The gallery's persisted owner decides the strategy; an admin uploading
into someone else's Creator gallery does not change it or bypass that owner's
Free quota.

- **Official VCO:** high-resolution download at most **5,000,000 bytes**.
  Suitable static JPEG/WebP already within budget is retained without another
  lossy encode. Other sources try WebP (JPEG for JPEG sources, 4:4:4 chroma)
  at quality **100, 98, 95, 90, 85, 80 in original dimensions first**.
  The first fitting candidate wins; quality 100 is not lossless. Only if none
  fits, try 85% and then 70% dimensions at the previous 90/85/80 steps.
  Additional encodes remain inside the existing 60-second optimization budget
  (each encode at most 20 seconds or the remaining budget, whichever is less).
  No upscaling. If the budget still cannot be met, reject with the explicit
  quality/resolution trade-off; do not go below quality 80 or 70% dimensions.
  A smaller static PNG/GIF is retained if converting it would inflate storage.
- **Creator:** valid static JPEG, PNG, WebP or GIF at most **5,000,000 bytes**
  remains byte-for-byte unchanged, including EXIF orientation and metadata.
  No browser-side conversion occurs: local selections and expanded ZIP entries
  send their original bytes; object URLs are only local previews.
  Multi-frame/animated sources remain forbidden, for owners and admins alike.
- **Web preview:** one separate oriented WebP, usually max-640px long edge,
  at most **100,000 bytes**, derived directly from the input. Existing preview
  quality ladder is retained; smaller edges are a bounded fallback if necessary.
  There is no lower-size target and no enlargement.
- **Low-Res download:** on demand from the saved high-resolution file or Creator
  original, never normally from the thumbnail. Oriented WebP at most **1600px**
  long edge and **500,000 bytes**, no enlargement, minimum size or padding.
  Try quality 100/98/95/90/85/80; only if none fits, try 1280px then 960px
  at those steps. Historical decodable Base64 photos use their large field too;
  lost original detail cannot be recovered. Menu text is **Low-Res · up to
  0.50 MB**; High-Res still displays actual stored bytes and provenance.
  The `lowBytes` database value remains *thumbnail storage*, not download size.
  No new object, persistent cache or quota/cleanup entry is created.
  Sources are capped at the existing historical 100-MiB limit and configured
  image pixel limit (40 MP by default). Modern inputs spool to bounded temporary
  disk, cleaned on success, error or abort; historical Base64 decoding remains
  bounded in memory. Processing shares two CPU slots and at most eight waiting
  jobs with uploads/imports; queued requests do not open sources. Queue, read
  and conversion share a 45-second cancellation deadline; encoding has a
  30-second budget and individual Sharp operations at most ten seconds.
  Disconnects remove queued work and abort reads. Sharp's native promise-based
  encode cannot be interrupted by stream destruction: cancellation discards
  the result and stops further steps, keeping the CPU slot until the current
  bounded operation settles (up to ten seconds of cancellation grace).
  Bounds are per process.
  Too-busy requests return 503; input byte limit 413; unreadable/over-pixel-limit,
  cancelled/timed-out or unfit photos return 422; missing/failed storage returns
  502. These errors do not count as downloads.
- **Accounting:** download bytes + preview bytes exactly once; at most
  **5,100,000 bytes per new photo**. Actual totals are reserved before either
  object write. Failed partial writes retain one conservative reservation total
  in cleanup until deleted, including a photo token for JPEG/PNG/GIF as well as
  WebP. Free quotas, parallel reservations and unknown historical sizes still
  fail closed. No permanently saved input copy for VCO.
- **Sources:** Nextcloud's existing 32-MiB/photo input, 40-MP pixel,
  duration, concurrency and total-import limits are unchanged.
  The download budget is separate from this input budget.
  The application issues only GET/PROPFIND; neither remote files nor source
  references are rewritten. Once imported, neither browsing nor download needs
  Nextcloud. Video, event-image and profile-image policies are unchanged.

## Small before/after comparison of this download change

Command: `node --import tsx scripts/compare-image-downloads.mjs`.
Outputs and side-by-side crops are excluded from Git/deployment under
`generated-artifacts/image-quality/`. The comparison creates no media records,
provider requests, jobs, bucket objects, reimport or deployment.

Both are actual previously supplied VCO motorsport PNGs, not upscaled recognition
fixtures. The first original is 5.8 MP; the second is a detailed field/track
scene. “Before” means the immediately preceding full-resolution quality-90
conversion and its stored thumbnail used as Low-Res. Both new High-Res samples
fit at quality 100 without resizing; both new Low-Res samples fit at quality
100 and 1600px. This is a small offline comparison, not the separate
20–40-MP camera evaluation.

| Photo | Source dimensions / bytes | Previous High-Res dimensions / bytes | New High-Res dimensions / bytes | Previous Low-Res dimensions / bytes | New Low-Res dimensions / bytes |
|---|---|---|---|---|---|
| Stock car #89 (`attached_assets/#89_3.png`) | 2160×2700 / 11,511,713 | 2160×2700 / 1,630,464 | 2160×2700 / 2,948,620 | 512×640 / 23,714 | 1280×1600 / 343,472 |
| Wide field (`attached_assets/IMG_7464.png`) | 2560×1080 / 5,499,266 | 2560×1080 / 523,298 | 2560×1080 / 1,037,938 | 640×270 / 20,920 | 1600×675 / 416,938 |

The thumbnails remain byte-identical: **23,714 / 20,920 bytes**.
For *new conversions only*, total two-object storage changes from
1,654,178 to **2,972,334 bytes** (stock car) and 544,218 to **1,058,858 bytes**
(wide field). The dynamic Low-Res bytes above are not stored or charged.
Each remains below 5.1 MB. No historical objects are changed.
Creator storage will generally increase relative to the previous destructive
conversion: e.g. an exact-5-MB upload plus its actual preview, not a compressed
replacement. This is intentional, still charged against the unchanged quotas.

### Visual inspection

Replit Agent inspected original/previous/proposed crops independently of an AI
recognition result; this is not independently certified human ground truth.
The stock-car crop checks grille mesh, front light, bumper edges and the small
BS COMPETITION sponsor lettering. The new Low-Res keeps noticeably clearer
lettering, grille and headlight outlines than the enlarged old 640px thumbnail.
The High-Res difference is subtler: quality 100 retains fine surface/mesh detail
slightly better than quality 90, with no conspicuous new artifacts.
The field crop checks track lettering/kerbs, distant cars, crowd and grass.
New Low-Res preserves car shapes, track lettering and kerb boundaries much
better than the old thumbnail; distant crowd/grass detail is still limited by
1600px. Both High-Res versions look close to the source at these crops, with
slightly less fine grass/crowd smoothing at quality 100. Neither is lossless.

The comparison PNGs concatenate source, before and after crops left-to-right.
For Low-Res, the source and old thumbnail are aligned to the new download's
dimensions; the thumbnail is enlarged **only for inspection**, never in storage
or delivery. High-Res crops use identical source coordinates without resizing.

### Acceptance bounds and remaining coverage limits

Quality 80 is an encoder floor, not a universal perceptual-quality guarantee.
Quality 100 does not mean lossless. Reduced dimensions discard fine details,
even at high encoder quality. The bounded fallback can discard up to 30% of
each dimension (51% of pixels); sources still too large receive a clear error
requesting an approved smaller source. There is no automatic/manual approval
of this trade-off hidden in the application.

This is two real photographs, not a broad benchmark. It does not establish
quality across modern 20–40-MP camera originals, all dark/high-noise scenes,
fine print, moiré, colour-critical print workflows, ICC profiles or every
transparency case. Synthetic high-detail images exercise quality adjustment,
resolution fallback and explicit failure; they do not prove visual quality.
Converted VCO images auto-orient and strip metadata as before, without
promising print colour-profile fidelity. Creator originals keep metadata:
photographers should remove unwanted personal/location metadata themselves
before submitting; the service must not silently change their original bytes.
Static PNG/GIF can be preserved for storage efficiency when a conversion would
be larger. Official animated inputs are flattened as in the former path;
Creator animation restrictions remain in place.

## Reliable provenance without a database migration

Historical media objects were generated with Node's `randomUUID()` (UUIDv4).
Only the server's new Creator-original path creates application-specific
UUIDv8 keys (the version nibble changes, the remaining random bits remain).
The existing key format/regex supports them, so no schema or historical update
is needed. This marker survives restarting, listing, streaming and metadata
edits, works for uploaded WebP originals too, and is not inferred from the
extension, creation date, admin role or gallery label. Client request fields
cannot select it. It is provenance only, never access authorization.
Do not use UUIDv8 for other media strategies without explicitly revisiting this
contract. Existing v4 Creator downloads remain labelled **High-Res Download ·
optimized**, never “Original”. New marked files are **Original Download ·
uploaded file**; shared labels include actual stored size throughout grids,
home/top-shot actions and the detail page. Dynamic Low-Res displays its upper
bound instead of misrepresenting the persisted thumbnail size.

Moderation recognizes all four static formats and converts its bounded
provider input to correctly labelled WebP without altering the stored original.
Recognition still gets an oriented max-1600px WebP. Protected downloads never
become public bucket URLs.

## Focused checks

`node scripts/test-image-downloads.mjs` creates disposable local PostgreSQL,
pushes the current schema only there, and runs the focused media-object,
route, quota, Creator and download-access checks serially, including photo
Nextcloud import and offline delivery through the route test. Storage
and external providers are local mocks; the real app routes/ledger/streaming
execute against synthetic accounts. Temporary database/storage are removed.
PostgreSQL tools must be installed; no connected or production schema is changed.

Checks include SHA-256 equality for JPEG/PNG/WebP/GIF and exact-limit uploads,
owner/admin actual download routes, false MIME/corruption/animation, no
upscaling, >5-MB VCO input, quality and resolution fallback, preview byte cap,
two writes, actual summed usage, parallel reservations, failed-write cleanup,
historical labels and large-source Low-Res delivery, EXIF orientation, exact
500,000-byte limit and fallback ordering, empty/corrupt/truncated/pixel-bomb or
over-byte-limit sources, abort/timeout/read-error cleanup, bounded queue and CPU
slots, no download storage writes, blocked/premium/anonymous access, completed
delivery counting and failed-delivery non-counting, plus downloads after a mocked
Nextcloud outage. Type check and production build
are separate (`npm run check`, `npm run build`).

The initially connected database lacked a pre-existing photo-matching column
already required by the current code. Rather than apply unrelated DDL, checks
use the disposable local schema. Any setup needed for the normal preview is
separate from this image change and must follow the existing development/
publishing workflow. No live AI evaluation, production deployment or benchmark
suite was run.

The broader optional `tests/nextcloud.test.mjs` suite was also attempted: its
mixed-video fixture currently expects three 12-byte container signatures to be
imported as real videos, but the current decoder rejects them (0 versus 3).
That unrelated video-fixture regression is not changed by this photo task and
is excluded from the focused runner's defaults. Explicit file arguments still
allow running the broader suite. No video behavior was relaxed to make it pass.

## Existing library and a possible later reimport

**No existing media, tags, captions, assignments, import records or remote
sources were replaced, deleted or automatically reprocessed.**

Official photos with an accessible unchanged higher-resolution Nextcloud source
may benefit from a later explicitly approved, selected reimport. The current
“Update gallery” intentionally skips saved source paths, including changed
files at the same path; clicking it does not upgrade historical downloads.
A future controlled tool would need to map each confirmed source to the
existing media identity, preserve all captions/manual and AI tags,
identification, gallery assignment and download statistics, authorize the
replacement, atomically swap the two objects and retire old objects safely.
This task does **not** perform or add that operation.

Historical compressed Creator files cannot regain discarded detail. The
photographer must supply their original again; do not relabel, upscale or
re-encode the historical file as a recovered original.
