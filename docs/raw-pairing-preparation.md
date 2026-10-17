# RAW pairing — first P2-6 implementation slice

## Implemented, not activated

Internal pairing suggestions and explicit attachment checks now extend the
existing asset-variant repository. There is no RAW upload endpoint, new API,
Studio control, decoder or original-delivery permission
in this slice. No connected schema, environment or data changes are required.
This is not complete P2-6 or a claim of working RAW intake.
The subsequent isolated DNG container evaluator is documented in
`docs/raw-container-validation.md`; it is not connected to uploads or pairing.

### Suggestions

`server/raw-pairing.ts` accepts at most 200 candidates from an already
authorized, server-scoped selection. The eventual extractor must supply
validated, normalized capture timestamps and camera facts; browser metadata
is not trusted extraction. This helper does not read files or EXIF.

A suggestion needs all of:

- Same owner/category and gallery, a positive media/revision identity and a
  JPEG key/checksum.
- Matching filename stems after case/Unicode normalization; sequence numbers
  are not removed. Paths, controls and unsupported extensions are excluded.
- Capture timestamps within two seconds and the same camera make/model.
  Conflicting known camera serials veto the suggestion.

The two-second window is only a suggestion heuristic, not a file acceptance
rule. No timestamp/timezone is guessed. Missing or conflicting evidence means
manual selection is needed, not that an otherwise valid upload must fail.
Several matches stay ambiguous; array order does not choose a winner.
**Every result requires explicit selection**, including a single suggestion.
No filenames, capture facts or serials appear in suggestion output.

### Explicit attachment

`linkAssetObject` now requires an explicit RAW selection bound to the media ID,
source revision, JPEG key/hash and RAW key/hash. It rechecks these facts against
locked routes and the existing source relationship, alongside the existing
owner/gallery, format-coherence, quota and retained-state checks.

An exact retry returns the same variant. Stale selections fail without a
partial physical-object registration. RAW cannot be shared across two photo
identities, even within one gallery; the object-route lock serializes attempts.
The same photo's immutable revision rules are retained. Manual selection need
not agree with a heuristic filename suggestion.

This is an internal contract, not authentication or a browser-provided
`confirmed=true` authorization. Future endpoints must derive ownership,
authorize the manager and validate bytes/container and safety independently.
The selection hash does not substitute for verification of provider bytes.

RAW adds one delivery variant, not a second media/editorial row or vision job.
The existing physical-object accounting counts its bytes once. No captions,
manual tags, safety state, prices, entitlements or existing original bytes are
rewritten by pairing.

## Unchanged privacy and launch boundaries

- Generic object-key validation still rejects every candidate RAW extension.
  Pairing vocabulary does not open upload, inline viewing or downloads.
- JPEG publication approval is not approval of arbitrary RAW content.
- The existing optional-original privacy/consent policy is not activated.
- Candidate format names are not an approved/verified support matrix.
- The isolated 250 MiB transport ceiling is not a runtime RAW limit.
- RAW-only drafts, removal/reassignment, purchased snapshots and Studio controls
  still need the remaining lifecycle work; no destructive reassignment exists.

## Verification

```sh
npm run check
node --import tsx --test tests/raw-pairing.test.mjs tests/media-asset.test.mjs
node scripts/test-image-downloads.mjs --enable-uploads \
  tests/media-asset-storage.test.mjs tests/retained-storage-capacity.test.mjs \
  tests/native-jpeg-intake.test.mjs
npm run build
```

Unit cases cover multiple signals, ambiguity, scope, missing/conflicting facts,
bounded candidates, unsafe names, explicit revision/checksum selection and the
unchanged RAW object-key denial. Disposable database cases cover source/owner
guards, absent/stale selections, idempotency, one photo identity, no extra AI
admission, retained bytes and rejection of cross-photo attachment. Existing
JPEG/restart and capacity suites remain regression requirements.

Results: **13 unit checks and 71 disposable integration checks passed**, with
no failures/skips. TypeScript and the production build passed. The application
restarted normally and its public page rendered correctly. No signed-in Studio
UI was added or newly verified. No live provider, connected database,
Production, schema or environment changes were used.

## Next P2-6 work

Prepare representative, authorized camera fixtures to extend the initial
synthetic-DNG evaluator before choosing the initial allowlist. Then integrate
gated upload/explicit pairing controls into Studio, including uncertainty,
quota, cancellation, safe reassignment and delivery-policy handling.
Approvals for real formats/limits, connected schema/settings, original
availability and activation remain separate.
