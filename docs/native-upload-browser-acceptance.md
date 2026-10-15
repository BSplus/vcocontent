# Native upload browser controls — isolated acceptance

16 October 2026. Preparation within P2-5/P2-9, not activation approval.

## What was exercised

The actual existing Creator Studio and Admin upload components run in fresh
Chromium profiles at **390px and 1280px**, for both roles. Primary native-case
actions use coordinate-based touch or mouse input, with measured CSS viewport,
visible bounds and reachable button checks.

All API requests are intercepted before navigation. Synthetic session responses
model the native backend contract; unexpected writes are rejected. No connected
account, database, upload gate, storage provider or AI service is used. This is
interactive client acceptance, **not** a browser-to-real-R2 or Safari/iPhone
Mail/device claim. Real server/provider behavior is covered separately by the
disposable native HTTP tests and still needs approved connected acceptance.

Four native browser cases each exercise:

- An active finalizer is checked without another completion request.
- After close/reselect, a server-approved inactive finalizer resumes the same
  session without re-uploading accepted parts or replacing its original caption.
- A committed save with a lost response is recovered by status lookup, without
  another completion or duplicate media.
- A conflict is unconfirmed, not a claimed rejection; there is no automatic retry.
- Refused cancellation preserves both the selected file and browser receipt.
  Only a later positive cancellation reply clears them.
- A closed upload gate rejecting finalization cannot erase the receipt, claim
  success or cause a legacy upload fallback. Later permitted recovery stays in
  the same session.

The existing twelve browser regression cases also cover ordinary Creator/Admin
uploads, explicit rejection/retry, dismissal and duplicate-submit protection,
pause/reselect, saved-count refreshes, preview cleanup and lost/invalid replies.

## Focused fixes

`client/src/lib/resumable-upload.ts` no longer treats failed finalization HTTP
responses as proof that nothing was stored. This includes 403, 409, 410 and 502.
It retains the receipt and original metadata for Resume / check status instead
of cancelling, clearing recovery state or offering a fresh upload.

Conflicts outside finalization are conservative as well. Explicit pre-save
rejections retain their existing behavior. A subsequent authoritative terminal
session state, rather than an HTTP failure alone, can resolve the uncertainty.

The upload footer now distinguishes expiring paused transfers from uncertain
saves that may still retain reserved space. No design, limits, authentication,
API, schema or storage-routing changes were introduced.

## Verification commands

```sh
node --import tsx --test --test-concurrency=1 tests/media-upload-completion-ui.test.mjs
node --import tsx --test tests/resumable-upload-client.test.mjs
npm run check
npm run build
```

Coverage: **16 browser cases and 11 protocol tests**. Protocol tests additionally
verify original caption, credit and keywords survive error recovery.

The application workflow was restarted after the code batch. Native multipart
remains disabled, normal uploads remain closed, and Production is untouched.
Bounded uncertain-upload recovery/diagnostics, real provider/resource/restart
evidence and separate schema/settings/publishing approvals remain release gates.
