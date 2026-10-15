# Controlled Development resumable-upload smoke

Date: 15 October 2026. Result: **PASS**.

## Scope and safeguards

- Operator explicitly approved temporarily opening Development uploads.
- Verified the existing runtime-managed Development database and exact
  Development R2 bucket through the existing fail-closed target guard.
- Two isolated synthetic Creator accounts used real password authentication
  with independent sessions; no authentication bypass or emails were used.
- One private draft gallery and one 1,048,832-byte JPEG. Existing limits and
  Creator restrictions were not changed.
- Production schema, settings, credentials and publishing were untouched.
- The upload gate was managed in a `finally` block and restored before
  read-only delivery verification and cleanup.

## Actual checks

| Check | Result |
|---|---|
| Authenticated initiation blocked before opening the gate | PASS |
| First 1-MiB part acknowledged and reservation retained | PASS |
| Next part interrupted by aborting an actual streaming HTTP request | PASS |
| Interrupted part not acknowledged; no media prematurely committed | PASS |
| Application restarted with staged data and database state retained | PASS |
| Same authenticated session resumed at the acknowledged offset | PASS |
| Another Creator could not inspect the upload session | PASS |
| Remaining part accepted; identical accepted-part replay remained safe | PASS |
| Finalization, request-key lookup and completion replay returned one media item | PASS |
| Explicit Creator caption preserved | PASS |
| Source and thumbnail routes verified as R2-backed | PASS |
| Direct authenticated R2 source read matched input SHA-256 and size | PASS |
| Owner could retrieve protected source and thumbnail | PASS |
| Other Creator and anonymous source requests denied | PASS |
| Creator usage recorded one photo and at least its original byte size | PASS |
| New initiation and part writes blocked again after closing the gate | PASS |
| Completed status and delivery still worked with writes closed | PASS |
| Test gallery/media, upload receipt, rate keys and accounts removed | PASS |
| Both test R2 objects confirmed absent after deletion | PASS |
| Original user/gallery/media counts restored, including 34 original users | PASS |

The test driver is `scripts/dev-resumable-smoke.mjs`. Its phases are explicitly
invoked; it is not a startup task, public endpoint, migration or authorization
system. Private temporary cookie/state files were removed after successful
cleanup. Credentials and session cookies were not printed.

Two initial setup attempts failed before opening uploads because the test
accounts did not yet have isolated sign-in sessions. Their fixtures were
removed. The corrected five-phase run passed completely.

## Current state and limits of this evidence

- Development resumable feature flag: `true`.
- Development normal new-upload gate: `false`.
- No permanent widening of upload access; no Production activation.
- This was a real HTTP/API JPEG and R2 test, not a new signed-in browser UI test.
  Mobile Creator and desktop admin UI behavior was checked separately using
  isolated intercepted browser fixtures.
- No live video upload/playback, RAW intake, >100-MiB acceptance, multi-host
  failover, filesystem replacement or Production behavior was tested here.
  Existing disposable video/Range tests do not substitute for those live checks.

A subsequent controlled live video smoke passed; see
`docs/resumable-development-video-smoke.md`. The table above records this earlier
JPEG-only run, not that later video check.
