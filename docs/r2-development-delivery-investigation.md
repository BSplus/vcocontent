# R2 Development delivery investigation

**Follow-up:** the separately approved [final Development smoke](r2-final-development-smoke-report.md)
passed using fresh authorized metadata, including real browser video playback,
integrity, access restrictions, statistics and exact five-object cleanup. The
upload gate is closed. Historical request attribution remains unproven.

13 October 2026. Limited approved investigation/cleanup verification only.
**No new Development uploads, live smoke, reset/archive, Production access,
deployment or Replit object deletion. Upload gate remains closed.**

## What caused the reproducible 404?

The prior report called it an authenticated *photo* 404. That attribution was
not supported by the saved evidence: the runner used the same unlabelled
`status == 200` assertion for the photo original, its preview and the video's
poster, and only recorded the generic failed assertion—not its request path.

The verified database history showed that video AI replaced the initial poster: XY

- The upload response referenced `thumb-969d7b88-c2cd-4df1-8f0d-dd5285537dd5.webp`.
- Completed video analysis changed media 3879 to
  `thumb-c92cf876-b69b-40d5-a52c-40856b1cfe62.webp`, queueing its initial poster.
- The runner later fetched the stale upload-response poster URI.

The file route intentionally requires a current, non-archived media association
before checking owner/public permission and opening its assigned provider.
Once a poster is replaced, its old URI is no longer a current media association
and returns 404—even if its R2 bytes remain temporarily until cleanup. This is
an ownership/revocation boundary, not an R2 read failure or public exposure.

**Evidence limit:** this demonstrates a concrete race in the old runner and a
reproducible 404 cause, but cannot establish the exact historical failed request.
The original fixtures/log trace no longer exist. We do not claim conclusive proof
that the photo endpoint itself failed or that every live delivery path is fixed.

## Fix and verification

No backend provider fallback, private-key alias, authorization relaxation or
storage infrastructure was added. The delivery architecture remains unchanged.
The prepared, ignored smoke runner now:

1. Refuses to run without a new explicit approval argument and an open
   Development upload gate; neither has been used in this investigation.
2. Waits for automatic AI to settle, then uses the existing authorized gallery
   metadata endpoint to refresh both newly created media records.
3. Accepts only one related video replacement poster beyond the initial four
   keys—a proposed maximum five-key scope, not permission to run it now.
   Unexpected photo replacement, extra keys or changed original URLs stop it.
4. Verifies active originals/previews through R2; treats only a proven retired
   initial poster's normal deletion as expected. Missing active objects and
   authorization/configuration errors still fail, without Replit fallback.
5. Records method, path, stage and HTTP status separately, never credentials,
   cookies or signed-operation query strings. Photo and poster failures are no
   longer combined into an ambiguous “photo display” diagnosis.

Focused regression uses **disposable local PostgreSQL and disk-backed mock R2**,
real Express/Passport login/session handling, and no cloud upload:

| Case | Result |
|---|---|
| Authenticated Creator photo original | 200 |
| Authenticated Creator photo preview | 200 |
| Initial video poster before replacement | 200 |
| Old poster after simulated AI mapping replacement | 404, despite bytes still present |
| Photo original/preview after replacement | 200 / 200 |
| Refreshed poster from authorized gallery metadata | 200 |
| Anonymous private refreshed poster | 404 |

`npm run test:r2`: **10/10 PASS**, including this focused regression. Prepared
runner syntax check PASS. These are local results, not a new live smoke or
signed-in browser visual/playback proof.

## Cleanup recheck — PASS, no duplicate deletion

The separately approved five-object cleanup had already passed. Before this
recheck, the Development database target/hash, private EU bucket, absent
Production credential names and closed gate were verified again.

This investigation performed **five exact-key existence checks only** against
`vco-content-media-dev`:

- `media-9c700761-7fb3-8441-8d87-3482d9378088.png`: absent
- `thumb-9c700761-7fb3-8441-8d87-3482d9378088.webp`: absent
- `media-969d7b88-c2cd-4df1-8f0d-dd5285537dd5.mp4`: absent
- `thumb-969d7b88-c2cd-4df1-8f0d-dd5285537dd5.webp`: absent
- `thumb-c92cf876-b69b-40d5-a52c-40856b1cfe62.webp`: absent

**Zero new delete requests**; no bucket listing or prefix sweep. Media 3878/3879,
events 275/276, users 198/199, their sessions, provider mappings and cleanup
records remain absent. No fixture was recreated.

All original **75 media row fingerprints still match the pre-smoke baseline**.
Private read-only recheck evidence is in the ignored
`generated-artifacts/r2-smoke/cleanup-recheck.json`. The earlier verified restored
baseline remains 34 users / 23 events / 75 media / 0 archived / download counters 4.

## Remaining gates for the minimal final Development smoke

- New explicit approval for one photo/preview, one short video/initial poster
  and **at most one automatic replacement poster**, including cleanup of all
  five related keys/test records and idempotent treatment of an already-retired
  poster. Never silently enlarge the scope.
- Temporarily open the Development upload gate only after approval, then close
  it after testing/cleanup. No new credentials or Worker infrastructure needed
  for the existing protected proxy flow.
- Verify live authenticated photo/preview/current-poster display, browser video
  playback/Range, access controls, quotas and completion/deduplication statistics,
  with per-request evidence. These live checks remain incomplete from the
  original attempt and must not be inferred from local tests.

Original dummy-data reset and every Production action remain separately gated.
No further legacy-media migration or extensive legacy testing is required.
