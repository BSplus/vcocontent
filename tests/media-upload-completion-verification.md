# Shared media upload completion

## Baseline

The original committed upload component was compiled and substituted only inside
an isolated 390px browser session. All API requests were intercepted with
synthetic creator, gallery, policy, media and analysis data; no real upload
request reached a server.

After a synthetic `201` response containing the saved media ID and event ID:

- One media record existed in the fixture.
- The dialog remained open.
- The file showed “Saved · Adding tags in the background…”.
- “Done — all files saved” was disabled.

This reproduces the UI defect, not a storage failure. It says nothing about any
previous real user upload. Baseline screenshot output is ignored in
`generated-artifacts/upload-baseline.jpg`.

## Regression checks

Run:

```sh
node --import tsx --test --test-concurrency=1 tests/media-upload-completion-ui.test.mjs
```

The tests use fresh Chromium profiles and intercept every API request, rejecting
unexpected writes. They never create database records or storage objects.

Both dashboards are exercised at 1280px and 390px:

- Single and multiple confirmed saves close automatically and announce the count.
- Saving is explicitly separate from AI analysis, safety checks and publication.
- Partial success preserves named rejected files and retry actions. A failed
  background analysis does not change confirmed storage success.
- Retry submits only a rejected file, and the final count includes earlier saves.
- Complete rejection leaves the dialog open with an actionable summary.
- Delayed responses prevent duplicate starts, selection changes, Escape,
  outside clicks, the X and cancellation.
- Preview URLs are revoked after close. Reopening clears selection, metadata,
  and the admin media type.
- The media-management entry refreshes visible media and storage usage.
- Lost connections, invalid success JSON, missing saved IDs and gateway failures
  remain unconfirmed without automatic retry or a success claim.

The separate `community-ui.test.mjs` and `event-save-ui.test.mjs` checks cover
existing dashboard behavior and unaffected dialog consumers.
