# Authorized VCO recognition fixtures

These are small **actual image inputs**, not generated drawings or mocked
photographs. `reviewed.mjs` records permission, provenance, exact hashes,
coverage, visual evidence and expected results. Original uploads are excluded
from Git/deployment; only these bounded, metadata-free derivatives are retained.

## Review and limitations

On 10 October 2026 the user supplied ten images and explicitly authorized all
content from https://photos.vco-esports.com for this evaluation. Previously
supplied stock-89 and wide-group images are retained. The additional GT4 image
uses the public VCO thumbnail linked from search result 27841.

Replit Agent visually inspected the inputs independently of model results.
**This is agent visual review, not independently human-certified ground truth.**
Class names in site captions establish body-family *coverage* only: they are
never fed to the model, and cannot satisfy the readable-class requirement.
Registered entry-list names never identify a physical person in a photograph.

Most originals are resized with the same max-1600px/quality-82 WebP policy as
manual recognition. The GT4 public thumbnail is only 864px wide; this is a
known input-quality limitation, not evidence that all original GT4 photos fail.
Helmet-detail and paddock-tents are standalone crops, not additional original
photos. The paddock crop depicts pit-side tents/trucks; Pit Lane is accepted
alongside Paddock. Partial-number uses an explicitly documented opaque mask
over one digit. Wet/sunset photos additionally provide natural obscuration.

Expectations are fixed **before** a provider run. Change an image only after
visually reviewing it and updating its hash, provenance and expectations.
Never change expected results just to accept the model's output. Do not use
filenames, captions, the unmasked sibling or reference lineups to complete
partially visible numbers.

## Checks

Offline parser/request/reference regression checks (no real AI requests):

```sh
node --import tsx --test tests/motorsport-recognition.test.mjs
```

This verifies the fixture inventory/hashes, evidence gates, ignored physical
identity claims, controlled tags, independent vehicle matching and registered
lineups. Hand-authored provider responses in these tests **do not measure
image-recognition accuracy**.

Explicit live evaluation, at most 16 sequential managed-provider requests,
using the existing shared vision budget, timeout and zero SDK retries:

```sh
node --import tsx scripts/evaluate-motorsport-recognition.mjs --live \
  --output generated-artifacts/recognition/baseline.json
```

After a proposed prompt/model change, compare only the same reviewed set:

```sh
node --import tsx scripts/evaluate-motorsport-recognition.mjs --live \
  --output generated-artifacts/recognition/candidate.json \
  --compare generated-artifacts/recognition/baseline.json
```

Changed targets/pixels, missing samples and duplicate IDs invalidate a
comparison. Quality misses produce a nonzero exit status; they must not be
reported as successful recognition. Busy/provider failures are explicit,
sanitized failures, not fabricated observations. Outputs are ignored build/test
artifacts, and the script never creates media, queues a reanalysis, edits
references or publishes captions. Production provider/queue configuration is
unchanged. See `docs/motorsport-recognition-review.md` for the actual first runs.
