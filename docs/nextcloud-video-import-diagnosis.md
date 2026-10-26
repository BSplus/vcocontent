# Nextcloud video import: isolated diagnosis

## Result and remaining blocker

The historical failures for event 234 are **not diagnosed conclusively**.
The old rows contain only a generic error, and the supplied screenshot contains
14 filenames/sizes, not decodable video data. The current workspace's saved-source
lookup for this event returned zero sources. No production source, configuration,
media row or import was changed, and no production retry was performed.

An affected original, provided as a file or through already-authorized read-only
source access, is still required to establish whether the historical failure was
download, signature, probe, codec, poster, storage or reservation related. Do not
present a successful synthetic test as proof that those 13 original failures have
been repaired. Do not infer source-transfer bytes from stored JPEG totals.

## Reproduced paths

- The unmodified local pipeline successfully decoded real MP4, MOV and WebM
  containers using FFmpeg/FFprobe 6.1.1. Tool presence here does not prove their
  availability or compatibility in the published runtime.
- Generated, decodable MP4 containers with trailing ISO `free` boxes were
  transferred through the full import path at 51 MiB and 234.5 MiB. These are
  streaming size tests, not evidence about the codec complexity of the originals.
  Originals and real WebP posters were stored in disposable local object storage.
- A reproducible reservation defect rejected a video when its original and
  already-generated poster fitted the remaining event budget but a blanket
  100 KiB poster reservation did not. Reservation now uses the actual generated
  poster length. This is a concrete repair, not an attribution of the historical
  failures.
- An injected incompatible FFmpeg executable produced a poster-stage failure.
  After restoring the real executable, resume downloaded only the failed video.
  The saved photo, manual caption/tags/credit, and existing media identity stayed
  unchanged; subsequent gallery update downloaded only a newly added video.
- Corrupt signatures, header-only MP4s, unavailable downloads, empty/truncated
  responses, failed poster storage and failed database commit produce distinct
  safe diagnostics and release reservations. Temporary paths and failed objects
  are cleaned up, using the existing durable cleanup queue for reserved keys.

## Failure contract

`server/nextcloud-failures.ts` holds a closed set of English operator messages and
codes. The existing private per-file `message` column contains a versioned envelope
of **stage and code only**, not exceptions, URLs, passwords, decoder stderr or
provider bodies. This avoids a production schema dependency. The status endpoint
decodes it into human-readable `message` plus structured `failure`; old historical
messages are preserved, not reclassified without evidence.

Stages distinguish download, content validation, video probe, poster generation,
reservation, object persistence and database commit. Known decoder setup failures
(missing tool, denied execution, unsupported option, unavailable codec, timeout)
remain actionable. Unknown errors get a stage-specific message rather than a
fabricated diagnosis. The admin dialog shows message, stage and code.

Saving and analysis remain independent: a durable analysis request accompanies
successful persistence; unavailable admission or later analysis failure does not
mark a saved file as an import error or redownload it.

## Budget definitions

Defaults remain 300 MiB per video and 2048 MiB per event. No upload permissions,
Creator video settings, content/decode policy, global import lease, two-file
concurrency, work queue, transfer deadline or import deadline was relaxed.

1. **Single source file:** configured image/video size, checked at discovery,
   response headers, streaming and media validation. Oversized advertised files
   remain skipped by discovery as before.
2. **Source transfers per run:** the finite configured event-byte allowance,
   without an additional hidden 2048 MiB clamp. Discovery charges only sources
   that are not already saved; actual downloaded bytes include failed attempts
   in that run. Resume starts a new bounded transfer run and skips saved files.
   Neither declared source lengths nor source sums represent stored event usage.
3. **Stored event capacity:** existing media plus active reservations plus the
   actual new original/processed image and poster/thumbnail, under the existing
   transactional event lock. A source-transfer check never replaces this check.

The status response exposes the configured limits with separate labels in the
admin dialog. A 4096 MiB isolated discovery test accepts 3000 MiB of sources;
the default 2048 MiB budget still rejects them. No multi-gigabyte persistent test
objects are needed for these arithmetic checks.

## Verification

Run with disposable PostgreSQL, temporary files and local fixture object storage:

```sh
node scripts/test-image-downloads.mjs --enable-uploads \
  tests/nextcloud-video-recovery.test.mjs \
  tests/nextcloud.test.mjs \
  tests/video-preview.test.mjs \
  tests/video-ingestion.test.mjs \
  tests/video-upload-policy.test.mjs
npm run check
npm run build
EVENT_LAYOUT_BUILD=1 node --import tsx --test --test-concurrency=1 \
  tests/event-dialog-layout.test.mjs
```

The recovery suite scopes automatic analysis consumers away from all media, so
it exercises durable admission without paid provider requests. The existing
ingestion suite uses a synthetic provider. Generated large files live only in the
runner's temporary directory and are removed afterward. Existing Nextcloud
assertions use persisted import/media identity instead of treating a generated
caption as an original filename.

Final checks: all five backend suites passed in the final targeted runs
(44 tests including nested cases), TypeScript and the production build passed,
and all nine production-build dialog checks passed at desktop and mobile
viewports. Dialog fixtures assert the safe poster diagnosis and the separately
labeled 300-MiB file and 4096-MiB example transfer/storage budgets without
saving, resuming, or downloading anything from a real account. The running
preview's public home page was also visually checked. An actual signed-in admin
session and the published runtime were not tested.
