# Controlled Development video resumable-upload smoke

Date: 15 October 2026. Result: **PASS**.

## Scope and safety

Continuing the operator-approved Development checks, the existing smoke driver
was extended with a video mode. No application features, authentication logic,
schema, file limits or Production configuration were changed.

The existing target guard verified the Development database fingerprint and
exact Development R2 bucket. Two synthetic accounts used real authentication
with independent sessions. One temporary admin uploaded to an isolated hidden
official event; a separate Creator-owned draft gallery tested the video ban.
Internal official-event visibility fields are not accepted from the public
creation body, so only the newly created fixture was hidden by its exact
persisted ID before accepting any media. Input validation was not weakened.

The fixture was a generated three-second H.264 MP4, 256 × 144 at 10 fps,
between 1 and 2 MiB. Existing official video limits remained unchanged.

The Development upload gate was opened only for the upload phase and restored
to `false` in `finally`, before playback/delivery verification and cleanup.

## Actual results

| Check | Result |
|---|---|
| Authenticated upload initiation blocked before opening the gate | PASS |
| Creator video upload rejected in a Creator-owned gallery | PASS |
| Temporary admin also unable to bypass that gallery's video ban | PASS |
| First 1-MiB part acknowledged and reservation retained | PASS |
| Next streaming HTTP request interrupted; partial data not acknowledged | PASS |
| No media committed before completion | PASS |
| Application restarted; session and acknowledged part retained | PASS |
| Same actor resumed the remaining part successfully | PASS |
| Another Creator denied access to the upload session | PASS |
| Identical accepted-part replay remained safe | PASS |
| Finalization, completion replay and request-key recovery returned one item | PASS |
| Explicit caption preserved | PASS |
| Automatic video-analysis attempt completed | PASS |
| Current source and poster routes verified as R2-backed | PASS |
| Direct authenticated R2 source read matched original SHA-256 and size | PASS |
| Authorized admin retrieved protected source and current poster | PASS |
| Other Creator and anonymous source requests denied | PASS |
| HTTP `Range: bytes=0-63` returned `206`, correct Content-Range and exact bytes | PASS |
| Out-of-bounds Range request returned `416` | PASS |
| Native Chromium video decoded frames and advanced currentTime | PASS |
| Seek to 1.5 seconds followed by continued playback succeeded | PASS |
| No native media error | PASS |
| Official stored bytes included the source; unrelated Creator usage stayed zero | PASS |
| New initiation and part writes blocked again after closing the gate | PASS |
| Completed status/delivery/playback still worked with writes closed | PASS |
| Test accounts, galleries, media, upload receipt and local temporary data removed | PASS |
| All three tracked test R2 objects confirmed absent | PASS |
| Original user/gallery/media counts restored, including 34 original users | PASS |

## Poster scope and cleanup

The normal pipeline created three test-owned keys: the immutable original,
initial poster and analysis-generated replacement poster. The tracker admitted
keys only from this exact gallery's persisted reservations and media records,
not bucket listings, timestamps or guessed UUID ownership. Authorized metadata
was refreshed after analysis before requesting the current poster.

Deletion used existing application operations and the routed-object deletion
helper for those exact admitted keys. Missing/deleted routes were not an excuse
to fall back to another storage provider. Normal routing deletion tombstones
are retained by the application's existing deletion design; they are not
remaining R2 files or live test media.

## Current state and limits

- Development resumable feature flag: `true`.
- Development normal new-upload gate: `false`, verified after the test.
- No Production changes, publication or bucket-public-access changes.
- This demonstrates native browser decoding/seeking of the real protected
  Development source, not the application's complete video-preview dialog UI.
- Analysis completion on a synthetic pattern does not prove racing-number,
  driver/team, manufacturer or sponsor recognition accuracy on real footage.
- Subsequent real mobile Creator / desktop Admin upload-dialog checks passed;
  see `docs/resumable-development-ui-smoke.md`. Larger limits, RAW, multi-host
  failover and Production acceptance are not claimed.

Reproduction uses explicit phases of `scripts/dev-resumable-smoke.mjs` with
`video` as its third argument. It is never run by startup or Publishing.
