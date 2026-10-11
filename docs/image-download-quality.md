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
  at quality **90, 85, 80 in original dimensions first**. Only if none fits,
  try 85% and then 70% of the original dimensions at the same quality steps.
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

## Small comparison performed before changing the upload path

Command: `node scripts/compare-image-downloads.mjs`.
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

### Visual inspection

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
These visual crops themselves are JPEG-encoded for inspection.

### Acceptance bounds and remaining coverage limits

Quality 80 is an encoder floor, not a universal perceptual-quality guarantee.
Quality 90 does not mean lossless. Reduced dimensions discard fine details,
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
home/top-shot actions and the detail page. Low-Res behavior is unchanged.

Moderation recognizes all four static formats and converts its bounded
provider input to correctly labelled WebP without altering the stored original.
Recognition still gets an oriented max-1600px WebP. Protected downloads never
become public bucket URLs.

## Focused checks

`node scripts/test-image-downloads.mjs` creates disposable local PostgreSQL,
pushes the current schema only there, and runs the focused media-object,
route, quota, Creator, Nextcloud and download-access checks serially. Storage
and external providers are local mocks; the real app routes/ledger/streaming
execute against synthetic accounts. Temporary database/storage are removed.
PostgreSQL tools must be installed; no connected or production schema is changed.

Checks include SHA-256 equality for JPEG/PNG/WebP/GIF and exact-limit uploads,
owner/admin actual download routes, false MIME/corruption/animation, no
upscaling, >5-MB VCO input, quality and resolution fallback, preview byte cap,
two writes, actual summed usage, parallel reservations, failed-write cleanup,
historical labels, blocked/premium/anonymous access, completed delivery counting
and downloads after a mocked Nextcloud outage. Type check and production build
are separate (`npm run check`, `npm run build`).

The initially connected database lacked a pre-existing photo-matching column
already required by the current code. Rather than apply unrelated DDL, checks
use the disposable local schema. Any setup needed for the normal preview is
separate from this image change and must follow the existing development/
publishing workflow. No live AI evaluation, production deployment or benchmark
suite was run.

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
