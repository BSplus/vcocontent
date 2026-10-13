# Final minimal R2 Development smoke — PASS

13 October 2026. Explicitly approved new-upload-only smoke; no migration.

## Scope and isolation

- Only the pinned, isolated Development database and private EU Standard
  `vco-content-media-dev` bucket. Only Development bucket-scoped S3 credentials.
- One new Creator photo/preview and one new official test video/initial poster,
  plus exactly one normal AI replacement poster: **five objects total**.
- Test actors 200/201, galleries 277/278, media 3880/3881. Original 75 media rows
  were fingerprinted before, during and after testing and remain unchanged.
- No Production credentials/database/bucket/settings, Worker deployment,
  existing Replit object operations, archive/reset or Production R2 activation.

The prepared runner was used with existing authenticated upload, gallery
metadata, file delivery, usage and protected download endpoints. An older
Development listener was stopped before the managed workflow restarted on
port 5000; this ensured requests used the intended configuration/code.

## Results

| Check | Result and evidence |
|---|---|
| Upload | PASS — both authenticated application uploads returned 201 |
| AI | PASS — both normal jobs completed on their first attempt; manual test tags retained |
| Fresh URLs | PASS — authorized gallery metadata refreshed after AI settled; one related replacement poster discovered within the approved budget |
| Photo/preview/current poster | PASS — authenticated HTTP 200; Creator original SHA matches uploaded bytes; both delivered previews decode as images |
| Video Range | PASS — 206, exact `bytes 0-1023/<size>` Content-Range, and first 1,024 bytes identical to source |
| Full video | PASS — delivered SHA matches upload; FFmpeg decodes without errors |
| Browser playback | PASS — authenticated existing Chromium, 320×240, duration 2 seconds, playback time advanced beyond 1 second, readyState 4, no media error |
| Access restrictions | PASS — anonymous original/private-preview requests denied; a second Creator cannot read the private photo; private draft-photo downloads remain 404 even for owner |
| Creator quota accounting | PASS — new Creator moved from 0 to exactly 1 photo / 19,377 bytes (14,573-byte original plus 4,804-byte preview), matching stored-byte accounting; usage endpoint 200 |
| Download statistics | PASS — successful official test-video download: link authorization counts 0; consumed transfer counts 1; repeating the same operation still counts 1, with exactly one history entry |
| Integrity | PASS — all five actual R2 objects read back; SHA-256, byte size and MIME match provider catalog; original photo/video also match submitted bytes |
| Cleanup | PASS — ownership/reference checks passed before deletion; all five exact keys deleted and individually verified absent; only test records removed |
| Gate | PASS — Development upload gate closed in the runner invocation's finally step; managed application restarted with the closed gate before cleanup |

Limits: this minimal run verifies quota **accounting**, not exhaustion of a real
Creator allowance. It verifies image responses/decoding and real browser video
playback, not a signed-in gallery layout screenshot. Statistics measure completed
server transfers, not saving to an end device. No unsigned-S3 “public exposure”
test was repeated; the completed manual bucket configuration review still applies.

## Exact cleanup allowlist

All five were present and verified before deleting; all five now absent:

1. `media-dbe8dd5e-f041-85f3-bd04-81824fc81c56.png`
2. `thumb-dbe8dd5e-f041-85f3-bd04-81824fc81c56.webp`
3. `media-76822ba8-7acf-406d-bb9d-0fcecd487165.mp4`
4. `thumb-76822ba8-7acf-406d-bb9d-0fcecd487165.webp`
5. `thumb-56ab94e4-ce28-4e40-9e49-b37c87a1d32c.webp`

Only this run's two media records, two galleries, two actors, two sessions,
two related rate-limit rows, five provider mappings, one retired-poster cleanup
entry and associated test analysis/download records were removed. Before
deletion, all database foreign-key relationships and external media/gallery
references were checked; any unexpected reference would have stopped cleanup.
An already-removed object would have been skipped, not deleted twice.

Restored database baseline:

- 75 media, 0 archived; all original row fingerprints unchanged.
- 34 users, 23 events; original download-counter sum remains 4.
- 0 R2 routing records, 0 pending cleanup records, 0 analysis jobs.

The ignored private `generated-artifacts/r2-smoke/evidence.json` holds request
stages/statuses, actual hashes, observed playback and guarded cleanup results.
The earlier failed smoke/cleanup evidence was preserved separately.

## Launch readiness

**No Development R2 upload/delivery blocker was observed in this smoke.** The
previous untraced 404 did not recur using fresh authorized poster metadata.

The next phase is the separately approved clean-library reset and Production
launch preparation—not legacy media migration. Remaining gates:

1. Explicit approval for the exact clean-library reset/archive scope; none has
   been executed, and existing Replit objects remain untouched.
2. Separately confirm Production-scoped configuration, database target guard,
   bucket credentials and operational rollback plan. Development configuration
   must never be assumed to populate Production.
3. Separately authorize Production checks/activation and rollout. This
   Development PASS is not a Production validation or deployment approval.

Current Development configuration remains staged for R2 with routing enabled
but **new uploads disabled**. No Worker or additional infrastructure is needed
for the tested protected proxy path.
