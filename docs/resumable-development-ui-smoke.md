# Real Development resumable-upload UI checks

Date: 15 October 2026. Result: **PASS** for both tested paths.

## Test setup

- Actual running Development application, database and private R2 bucket.
- Existing target guard checked the runtime database fingerprint and exact
  Development bucket before each run.
- Independent synthetic authenticated accounts; one private Creator-owned draft
  gallery per run. The desktop actor was a temporary admin, exercising the
  existing admin dashboard's Creator-gallery Manage Media / Upload Media path.
- Chromium with trusted touch events at 390 × 844 for Creator and trusted mouse
  events at 1280 × 844 for Admin. This was mobile emulation, not physical iOS.
- Actual filesystem JPEG selected through the browser's file input. Generated
  64 × 32 image, padded to 3 MiB + 256 bytes, below existing file limits.
- Real network throttled to 128 KiB/s upload; no Fetch interception, mocked API
  responses, fake sessions, injected application transport or auth bypass.
- Development normal-upload gate verified closed before setup, opened only
  during upload, then closed in `finally` and the application restarted before
  delivery/integrity verification. Production untouched.

## Actual results

| Check | Creator mobile | Admin desktop |
|---|---|---|
| Actual dashboard and upload dialog opened | PASS | PASS |
| Trusted touch/mouse could reach and activate controls | PASS | PASS |
| Tested controls unobstructed and at least 24 × 24 CSS pixels | PASS | PASS |
| Pause after first 1-MiB server acknowledgment | PASS | PASS |
| One acknowledged part retained, zero committed media while paused | PASS | PASS |
| Same-dialog “Resume / check status” | PASS | PASS |
| Pause after second 1-MiB acknowledgment | PASS | PASS |
| Two acknowledged parts retained, still zero committed media | PASS | PASS |
| Close, full document navigation, reopen and reselect same file | PASS | PASS |
| Original session recovered; only one initialization | PASS | PASS |
| Successful part acknowledgments exactly `[0, 1, 2, 3]` | PASS | PASS |
| First acknowledged part never retransmitted | PASS | PASS |
| Exactly one saved media item and visible “1 file saved” feedback | PASS | PASS |
| Original caption, credit and manual tag preserved after reopening | PASS | PASS |
| Paused dialog and page fit horizontally | PASS | PASS |
| No uncaught browser exceptions | PASS | PASS |
| Writes blocked again after closing gate | PASS | PASS |
| Completed receipt, source retrieval and thumbnail still usable | PASS | PASS |
| Direct R2 size and SHA-256 match immutable source | PASS | PASS |
| Source/current thumbnail routes verified as R2-backed | PASS | PASS |
| Other Creator and anonymous source requests denied | PASS | PASS |
| Stored usage includes original bytes | PASS | PASS |
| Test media, objects, galleries, accounts and private temp data removed | PASS | PASS |
| Baseline user/gallery/media counts restored, including 34 users | PASS | PASS |

An initial mobile fixture selector assumed list markup; the responsive Creator
view uses a different presentation. That run failed before any upload. The gate
was closed and fixtures removed. The test now locates the exact fixture title
and its own action container without assuming a particular responsive layout.
No application change was needed.

## Usability observation

After reopening and reselecting a paused file, the primary action initially
still says **Upload 1 file**, not **Resume / check status**. Activating it does
correctly recover the existing upload and retain its original metadata, despite
the fresh dialog's blank metadata fields. This is a wording/state-visibility
improvement opportunity, not a failed transport check. No UI changes were made
as part of this test.

## State and limits

- Development resumable flag remains enabled; normal uploads are closed.
- No Production settings/data, schema, file limits or Creator video permissions
  changed. No publication.
- This is not Safari/Firefox, an OS file-picker usability test, browser-crash
  recovery, multi-host acceptance, larger-file acceptance or Production approval.
- Test-only additions are in `scripts/dev-resumable-smoke.mjs` and
  `scripts/helpers/resumable-live-ui.mjs`; they do not run during startup/build.
