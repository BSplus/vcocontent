# Vehicle context in automatic captions

## Operator-approved behaviour

Both photos and videos:

1. A securely number-matched entry supplies the registered model alongside
   `#number Team`. If the model is missing, use the registered manufacturer.
2. A new optional **Single vehicle or make** field is available when creating
   and editing an event. Leave it empty for mixed-vehicle events. It supplies
   event-wide caption context and a fallback where the matched entry lacks
   vehicle information; it never overrides registered model/make information
   or acts as identity/matching evidence.
3. Without a matched entry or explicit one-vehicle context, automatic captions
   may include independently checked vehicle manufacturers. No inferred exact
   models, team names, driver lineups or race numbers are added this way.
4. Unclear makes leave the event-context caption intact. Manual captions,
   deliberately empty/editorial text and manual identification remain protected.
   This feature does not initiate historical bulk reanalysis.

Examples:

- `Event context | #27 Example Team — Porsche 911 GT3 R — registered lineup`
- `Event context | #27 Example Team — Porsche`
- `Event context · Vehicle: Porsche 911 GT3 Cup`
- `Event context | Vehicle make: Porsche`

## Recognition and protection

The existing independent whole-image/frame and same-car source-crop audit now
optionally assesses manufacturer information. Clear factory logos/badges or
distinctive recognizable vehicle shapes are allowed; generic silhouettes,
equipment brands, sponsor logos and model guesses are not.

A clear, readable factory logo on the car is sufficient in either the full view
or its source crop. No second positive manufacturer reading, readable race
number, external lookup or user confirmation is required. A clear factory badge
takes priority over a different shape-only suggestion. The optional audit field
manufacturerBasis distinguishes factory_logo, shape and uncertain; it cannot
turn a sponsor/equipment logo into a car manufacturer.

Shape-only recognition still requires agreeing confident readings. Car
association remains automatic; ambiguous geometry or two conflicting factory
badges leave the make out rather than block the upload. Partial cars can supply
manufacturer evidence from their visible portion. Number/entry matching keeps
its separate checks. Source-bound video checkpoints retain this evidence;
legacy/stale frames cannot claim it.

This shares the existing audit request and numeric/video request budgets.
There is no new model/provider verification service or make-specific web call.
The small manufacturer vocabulary covers common car/race-chassis makes and
ordinary manufacturer aliases; unknown names are omitted, not guessed.

No-entry-list photos use the checked observations to construct the caption
without turning a tags-only job into cached number recognition. Video frame
observations flow through the same caption builder. Complete caption segments
and lineups retain the existing 1000-character limit/fallback.

The event vehicle field is included in Creator text safety review, metadata
versioning and relevant context revision checks. Automatic caption changes still
use existing independent media safety review.

## Persistence and publishing

- Source schema change: **one nullable text column, events.vehicle**.
- The actual Development runtime connection was read-only checked against the
  managed Development database before applying this additive Development change.
- Existing events default to null; no events, media, users, roles or settings
  were rewritten/deleted. Recognition provenance additions use existing JSON
  metadata, not new database columns.
- `migrations/event-vehicle.sql` is included only in the existing guarded
  Development/post-merge preparation script, never in app startup or deployment
  build commands.
- Production remains unchanged. Publishing must review/apply the additive
  `events.vehicle` schema diff. Leave database-copy/overwrite **unchecked**;
  do not run custom DDL on the managed Production database.

## Checks

- TypeScript and production build passed.
- Combined disposable-database/AI-mocked suite: 91/92 passed initially. The
  only failure was a new no-list-photo fixture returning an entirely empty car
  description, which the existing recognition parser intentionally discards.
  Correcting that fixture to describe a visible `Race Car` made the isolated
  no-list-photo and event-vehicle checks pass; no recognition safeguard changed.
- An additional real local video decoding/worker check passed, saving a
  checked-make-only caption without an entry list or fabricated model/entry.
- All 93 distinct regression checks now have a passing result across these
  runs, not a claim of one clean combined 93-test run.
- Isolated desktop and 390px mobile browser fixture passed for create payload,
  edit prefill, trimming, clear-to-null, max-length errors, cancel/reopen and no
  horizontal overflow. API requests were mocked; no real API mutations.
- Regression recognition responses were mocked. The later live check below adds
  two positive real-provider examples, not broad manufacturer-accuracy evidence;
  neither set of checks guarantees every car is recognized correctly.

The initial implementation used no paid live calls. A subsequent operator-approved
live Development check is recorded below. Production, publishing and historical
retagging remain unchanged.

## Authorized live Development check — 14 October 2026

Two frozen original sources were visually inspected before testing:

- Photo: `generated-artifacts/number-diagnosis/1216.jpg`, with visible Ferrari
  factory badging.
- Video: `generated-artifacts/video-branding/1219-frame-0.jpg`, the side-view
  Porsche race car from the existing Sebring “Kinetic Move” sample. The frozen
  JPEG hash matched its saved source-sampling metadata. The car crop excludes
  the broadcast advertising banner.

The application’s real photo recognizer and video frame/bounded audit pipeline
were called using the existing managed provider. No gallery was created, uploaded,
changed or reanalysed. No database writes or Production access/settings changes.
Caption context was explicitly synthetic, without an entry list or preset vehicle.

Initial photo result: first pass identified Ferrari but omitted vehicle geometry,
so the independent audit did not run and the make was correctly withheld. The
photo prompt’s JSON template omitted vehicleRegion while its prose treated it
as optional. The focused correction includes a nullable location in the template
and explicitly requests localization even without a readable number. Parser and
independent verification rules were not relaxed.

Only the same photo was rerun. Final results:

| Source | Independently checked make | Generated no-list caption ending |
| --- | --- | --- |
| Photo | Ferrari | `Vehicle make: Ferrari` |
| Video frame | Porsche | `Vehicle make: Porsche` |

Both have current `same-car-make-v1` evidence. Exact models, teams and driver
names were not invented; checked number readings do not enter these no-list
captions. The video result has a source-bound verified checkpoint.

Across the initial check and photo-only recheck: **6 real provider requests**,
all HTTP 200, approximately **28.9 seconds combined request time**. Reported
usage total: **17,684 prompt tokens and 1,795 completion tokens**. Actual billing
cost was not available; these are not dollar estimates.

Sanitized source hashes, request status/usage, observations and generated
captions are in `generated-artifacts/vehicle-live/results.json` and
`generated-artifacts/vehicle-live/photo-recheck.json`. No credentials, request
headers/URLs or raw provider responses were logged.

These two positive live samples establish that both paths can work end to end
through recognition/audit/caption generation. They do not measure overall
manufacturer accuracy or constitute a live upload/persistence or Production test.
