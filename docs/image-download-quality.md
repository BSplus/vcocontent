# Photo quality and storage review

## Download contract checks

`node --import tsx scripts/test-image-downloads.mjs --enable-uploads` runs against disposable
local PostgreSQL and mocked storage, with uploads enabled only in that isolated
test environment. Filename tests include decomposed umlauts, header/path
characters, empty/long titles, UTC day boundaries and all supported MIME types.
Low-Res checks decode JPEG pixels, verify white transparency, EXIF orientation,
no enlargement, exact byte limits, bounded resolution fallback, original-byte
identity, temporary cleanup and native-work cancellation/concurrency.
A deterministic detail-rich noise fixture fits at 960 × 640 and retains
over 25 dB PSNR against the equivalently resized input. This is a mechanical
regression check, not a guarantee of professional photographic quality.

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
  original, never normally from the thumbnail. Oriented JPEG at most **1600px**
  long edge and **500,000 bytes**, no enlargement, minimum size or padding.
  Try quality 100/98/95/90/85/80; only if none fits, try 1280px then 960px
  at those steps. Historical decodable Base64 photos use their large field too;
  lost original detail cannot be recovered. Transparency is flattened onto white.
  JPEG uses 4:4:4 chroma sampling. Menu text is **Low-Res · JPEG · up to
  0.50 MB**; High-Res still displays actual stored bytes and provenance.
  The `lowBytes` database value remains *thumbnail storage*, not download size.
  No new object, persistent cache or quota/cleanup entry is created.
  All delivered files use `vco_YYYY-MM-DD_event-slug_m<ID>_<high|low>.<ext>`,
  e.g. `vco_2026-10-13_event-name_m797_low.jpg`. The date is the saved event
  date in UTC, never the download date or the server's local timezone.
  Event titles become lowercase ASCII slugs (ä/ö/ü → ae/oe/ue, ß → ss,
  accents removed), limited to 80 characters. Other characters become hyphens;
  empty slugs use `event-<event ID>`. Extensions follow the delivered MIME:
  Low-Res is always `.jpg` / `image/jpeg`; High-Res and video bytes and formats
  remain unchanged. Official, Creator and historical downloads share this rule.
  Credits remain available through the existing credit function, not filenames.
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


## Archived comparison before the first upload-path change

These are historical quality-90 measurements, not current optimized output.
The current script retains the legacy comparator but uses the actual current
preparer for its current output; the next section documents that newer policy.
Command: `node --import tsx scripts/compare-image-downloads.mjs`.
Outputs and side-by-side crops are excluded from Git/deployment under
`generated-artifacts/image-quality/`. The comparison creates no media records,
provider requests, jobs, bucket objects, reimport or deployment.

Both are actual previously supplied VCO motorsport PNGs, not upscaled recognition
fixtures. The first original is 5.8 MP and above 2560px; the second is a detailed
field/track scene. The old samples fit at the first legacy quality step (86);
the proposed samples fit at quality 90 without resizing.

| Photo | Source dimensions / bytes | Previous download dimensions / bytes | New download dimensions / bytes | Old / new preview bytes | Old / new total stored bytes |
|---|---|---|---|---|---|
| Stock car #89 (`attached_assets/#89_3.png`) | 2160×2700 / 11,511,713 | 2048×2560 / 937,474 | 2160×2700 / 1,630,464 | 23,888 / 23,714 | 961,362 / 1,654,178 |
| Wide field (`attached_assets/IMG_7464.png`) | 2560×1080 / 5,499,266 | 2560×1080 / 411,906 | 2560×1080 / 523,298 | 21,206 / 20,920 | 433,112 / 544,218 |

Measured additional storage compared with the old path: **692,816 bytes**
(stock car) and **111,106 bytes** (wide field). Each remains far below 5.1 MB.
Compared with copying each full input, the new downloads save approximately
9.88 MB and 4.98 MB respectively, without keeping a third file.
Creator storage will generally increase relative to the previous destructive
conversion: e.g. an exact-5-MB upload plus its actual preview, not a compressed
replacement. This is intentional, still charged against the unchanged quotas.

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

### Archived visual inspection of the first upload-path change

Replit Agent inspected original/previous/proposed crops independently of an AI
recognition result; this is not independently certified human ground truth.
The stock-car crop checks grille mesh, front light, bumper edges and the small
BS COMPETITION sponsor lettering. The proposed version retains edges and
lettering well; the old resized version is slightly softer.
The field crop checks track lettering/kerbs, distant cars, crowd and grass.
Both compressed versions slightly smooth fine grass/crowd texture compared with
the PNG, with less texture loss in the quality-90 candidate. No conspicuous
block artifacts or severe degradation was visible in these crops.

The comparison JPEGs concatenate original, old and proposed crops left-to-right;
the old stock image is enlarged **only for this comparison**, never in storage.
The initial visual crops were JPEG-encoded for inspection. The current script
instead writes lossless PNG panels to avoid an extra JPEG encode in the review.

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


## Supplied HiRes comparison: explicitly narrowed scope

The user supplied `1_VCO_31035_HiRes_1791756944089.jpg` and
`0_VCO_30912_HiRes_1791756944089.jpg` in response to the request for originals
authorized for this local quality comparison. After their dimensions and
pass-through behavior were established, the user explicitly chose to limit
completion to these supplied sim-racing files, with large camera originals
and compression fallbacks remaining unconfirmed. Neither source was modified.
The actual `preparePhoto(..., "official")` function was run locally, without
database, bucket, network, AI, or production calls. Measurements and resized
overview images are excluded from Git/deployment under
`generated-artifacts/image-quality/supplied-hires/`; the supplied sources are
also excluded from Git/deployment.

Reproduce with:
`node --import tsx scripts/compare-image-downloads.mjs --supplied-hires`.
This calls the actual production preparer, rather than a copied candidate
encoder. It asserts download/preview byte bounds, supplied-JPEG byte equality,
and source hashes unchanged after processing. Local measurements include
source, historical download comparator, current download, preview, crop
coordinates and SHA-256 hashes. Lossless PNG crops have panels in the order
**original / historical / current**. The historical download is enlarged
only for a same-coordinate display, never for application storage.

| Supplied file | Source and download dimensions | Source/download bytes (identical) | Preview dimensions / bytes | Total stored bytes |
|---|---|---|---|---|
| `1_VCO_31035_HiRes` | 3840×2160 | 2,471,047 | 640×360 / 41,986 | 2,513,033 |
| `0_VCO_30912_HiRes` | 3840×2160 | 2,895,490 | 640×360 / 42,636 | 2,938,126 |

For context only, the historical max-2560px WebP path would produce:

| Supplied file | Historical download dimensions / bytes | Historical preview bytes | Historical total bytes | Additional current total bytes |
|---|---|---|---|---|
| `1_VCO_31035_HiRes` | 2560×1440 / 828,340 | 43,090 | 871,430 | 1,641,603 |
| `0_VCO_30912_HiRes` | 2560×1440 / 874,636 | 42,800 | 917,436 | 2,020,690 |

Both historical downloads fit at quality 86. This historical comparison is
not a required fallback or a proposed product change.

Source and download SHA-256 equality was checked for each:

- `1_VCO_31035_HiRes`:
  `4111d0926a0cb1b19994a0c5aa85f6c2e1c8f9f554f31754967bee3085ee07ef`.
- `0_VCO_30912_HiRes`:
  `7f7298333d68cbfa0aa30cce4ed0103b572882675bf136fe11a45becb096eb60`.

Both are **8.2944 MP**, below the requested 20–40-MP coverage, and below the
5,000,000-byte download limit. Both JPEGs report an embedded profile and sRGB
colour space. The production path correctly retains them byte-for-byte, so
download colour, detail, existing compression and metadata are unchanged;
there is no additional download encode or required resolution fallback.
Combined download storage is **5,366,537 bytes**, preview storage **84,622
bytes**, and total storage **5,451,159 bytes**. These are prospective two-object
totals; no media objects were actually uploaded.

After integrating the newer dynamic Low-Res policy, the same comparison was
rerun through both production preparers. The supplied High-Res downloads,
thumbnails, hashes and stored totals above remain unchanged. On-demand Low-Res
downloads are now **1600×900 / 407,180 bytes** (`1_VCO_31035_HiRes`) and
**1600×900 / 415,784 bytes** (`0_VCO_30912_HiRes`), each below 500,000 bytes.
They are not persisted and do not add to the reported storage totals.
Measurements and additional high/low comparison PNGs retain both the
immediately preceding policy comparison and the older 2560px comparator;
these are explicitly distinct comparisons. No claim about large-camera
fallback quality follows from these additional measurements.

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

## Supplied HiRes visual review and scope limits (continued)

Four 512×512 source-coordinate crops were inspected as original / historical /
current lossless PNG panels. This is an agent visual inspection, not independent
human certification or a print-colour assessment.

- Sebring car, `(1550, 790)`: number 91, TDK and bumper sponsor lettering,
  wheel and livery edges. Original and current are visually identical, as
  their byte hashes require. The historical enlarged panel softens small
  lettering, fine asphalt texture and curved wheel/body edges.
- Sebring flag/fence, `(850, 440)`: wire mesh, yellow lane marking, concrete
  marks and black/white flag edge. Current retains the original fine lines;
  historical resizing smooths the mesh and surface texture.
- Field car, `(2240, 1320)`: purple/green livery, small sponsor lettering,
  wheel spokes, tyre lettering and grass. Current matches original; the
  historical panel is softer at thin lettering, spokes and grass edges.
- Grandstand, `(2040, 690)`: brightly coloured clothing, faces and narrow
  metal rails. Current matches original; historical fine edges and texture
  are softened. These rendered crowd details are not camera face evidence.

No additional download colour shift or compression artifact is introduced by
the current pass-through; any source artifacts remain unchanged. No severe
block artifacts or gross colour shift was apparent in the historical crops,
but this does not establish perceptual quality outside these regions. The
640×360 WebP previews are intentionally reduced and are not high-resolution
download-quality evidence. Under the newer download policy described above,
these are stored gallery thumbnails, **not** the dynamic Low-Res download.

The inspected overviews show rendered sim-racing scenes (a car at Sebring with
an iRacing-shirted marshal; cars and a grandstand). They are not evidence of
large physical-camera sensor originals, dark sensor noise, or colour-critical
camera workflows. They confirm the suitable-JPEG pass-through only. Forcing
their recompression, upscaling, or adding noise would not exercise a required
production fallback on a real large camera original. The visual
20–40-MP optimization/fallback comparison is **not completed by this evidence**;
it would need a separately authorized follow-up with appropriate sources.
Quality 80 and the 70%-of-each-dimension floor remain technical limits, not
a visual quality guarantee. Neither is reached by either supplied image.

Verification: both script modes ran successfully; the existing five focused
checks in `tests/media-objects.test.mjs` passed, including synthetic quality /
resolution fallback and rejection. Those synthetic tests verify mechanical
bounds only, not professional visual quality. No product code, limits,
historical library, source file, connected database or production was changed.
Following integration with the newer quality and Low-Res implementation, both
script modes passed again and all six current media-object checks passed.
The default-mode current measurements match the newer policy table above.
