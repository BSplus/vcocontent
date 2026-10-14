# Video number evidence review — 14 October 2026

## Scope and result

New uploads and explicitly requested video reanalysis now reuse the existing
photo number localizer and independent source-pixel vehicle/panel verifier.
The weak video batch remains separate; a frame's number is not eligible for
automatic reference matching until both independent steps finish successfully.
No new model/provider, frame selection UI, tracking, captions, production writes,
publishing, or paid evaluation requests were introduced.

This is a demonstrated **safety-policy improvement under isolated contract
tests**, not a measured improvement in live recognition accuracy or recall.
Provider bounding boxes remain approximate. The shared photo verifier is not a
proof against every partial-number error (see `photo-number-evidence-review.md`).

## Before/after on existing frozen pilot evidence

Input: unchanged `video-analysis-live-results.json`, five completed clips,
25 SHA-256-addressed, timestamped observations from 10 October. Their editorial
verdicts remain pending. This comparison executes the new aggregation locally;
it does **not** rerun recognition or invent independent pixel review.

| Clip | Previously saved number strings | New local historical-evidence replay |
|---|---|---|
| BS+ IMSA round 1 007 | 31, 110, 112, 196, 105 | No number eligible for automatic reference identity |
| Snippet #99 | 99, 9 | Neither unverified 99 nor unverified 9 is eligible |
| Gran Turismo 7 | 48; 65 omitted | Neither 48 nor the disputed 65 is certified retrospectively; unknown car observations remain |
| Sebring 16 | 16 | No retrospective certification |
| Top of the hill | 16, 199, 144 | No retrospective certification |

The #9 hint is in frame hash
`9ca0da18863fda2d841b0c62fb650b20c15eb99b9c65d81db8c13b9d1ba0c667`
at 6.3666664s. Earlier weak frames proposed 99. The implementation no longer
allows repeated earlier digits or a different car's number to certify that
last frame. This does not establish whether #9 is actually false.

The Gran Turismo first frame
`f6105f88da875cd1fc0068dec1e59653baae86e5c1181832617655f47d133dad`
at 0s proposed 48 and 65; several later frames also proposed 65. Baseline
aggregation dropped 65 following contradictory branding. New aggregation
retains unknown observations instead of deleting them, but the historical
record cannot establish a correct #65 detection.

Rejecting these historical observations also rejects potentially **real**
numbers, including the 99, 16 and IMSA candidates. This is the cost of refusing
to treat unreviewed old readings as independent evidence, not a recall gain.
Existing completed videos are not globally reanalysed or immediately rewritten.
Only a requested local rematch applies this historical gate.

## Positive and negative contract controls

`video-number-evidence.test.mjs` uses frozen synthetic JPEG pixels and mocked
localizer/audit responses. It demonstrates:

- Exact printed `007` remains `007`; only reference lookup normalizes it to `7`.
- A checked numbered car survives beside an unknown car.
- A clipped `7` reread cannot certify a proposed `007`.
- A genuine number on the other side of the frame cannot certify the first car.
- Empty/blurred readings and repeated weak observations never certify identity.
- Conflicting vehicles with normalized equal digits remain unknown; their
  metadata is never merged into one secured identity.
- Conflicting references and wrong sessions do not produce registered lineups.
- Failed audit retains successful localization; retry resends only the audit.
- Policy/hash/timestamp changes, raw forged provenance, and unfinished
  checkpoints cannot authorize reference identity.
- Frame, request, elapsed-time and payload guards fail closed.

These controls validate plumbing and fail-closed policy, not model vision.
Existing photo tests additionally exercise reviewed real-image pixels for
cross-car borrowing; those tests still use mocked provider responses.

## Budget and measured requests

Selection is deterministic: first four sampled frames proposing at least one
weak number. Up to eight extra requests across all retries, each under the
existing database-wide vision budget. No OCR subprocess is added in the video
path. Localizer deadline: 25s; verifier: 35s; cumulative additional provider time
budget: 240s, reserving 35s before another request. Each extra request allows at
most 25 image inputs and 4,000,000 JSON bytes; source JPEGs remain at most
524,288 bytes with unchanged SHA-256. A rejected payload never calls the model.
An exhausted budget produces unknowns, not identities.

The deterministic 60s worker retry fixture measures 11 mocked requests:
three weak batch attempts (one transport failure) plus eight successful number
checks. Available response usage totals 2,000 prompt / 1,000 completion tokens;
one failed request has unavailable usage. Its previous version used three
requests and 400 / 200 known tokens but had no independent pixel checks.
These are mock usage numbers, not actual billing.

The single-frame positive fixture measures two extra requests, 222 / 44 mock
tokens. Audit transport failure followed by retry measures three attempts,
222 / 44 available tokens and one unavailable-usage request, with localization
sent only once. Cost remains `null`. Available usage is also recorded before
JSON validation so malformed provider output does not erase returned usage.

Persisted `numberElapsedMs` counts additional provider wall time (including
failed requests); `samplingMs` counts extraction; job `durationMs` includes all
work in its latest attempt. These are not aggregate end-to-end latency across
queue wait/backoff/retries, and no actual-VM throughput claim is made.

## Evidence gaps and future authorized comparison

The old pilot's original clips/review thumbnails are not present in this
workspace. The exported frame hashes and pending editorial notes are not
independent reviewed ground truth. No new paid run is authorized by this task.
Accordingly there are **zero new live requests, no new live token/cost values,
and no live recognition accuracy/recall measurement**.

A subsequent explicitly authorized comparison should freeze the original
source hash and frame pixels, independently label complete/car-owned numbers
(including positive controls, #99/#9 and #65), run unchanged weak observations
against the new steps, repeat suspicious negatives, and report false identities
and missed true numbers separately. Never use production mutations as a test.

## Reproduce without connected databases

```sh
node scripts/test-image-downloads.mjs --enable-uploads \
  tests/video-number-evidence.test.mjs tests/video-analysis.test.mjs \
  tests/video-ingestion.test.mjs tests/photo-number-evidence.test.mjs \
  tests/photo-matching.test.mjs tests/recognition-reference-api.test.mjs
npm run check
npm run build
```

The wrapper creates and deletes a disposable local PostgreSQL database and
local object storage. Queue consumers have exclusive fixture scope. No
development/production database, storage originals, or actual AI service is
used. Worker tests preserve concurrent tags, manual identity, captions, preview
fencing, creator permissions, source/policy transitions and local rematching.
