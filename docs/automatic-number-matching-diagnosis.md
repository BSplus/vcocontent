# Automatic number matching: read-only live diagnosis

Inspected on 14 October 2026. Target: Production event 230,
“IMSA Esports Global Championship, Round 2, Sebring”.
The deployed application was reported as successfully built and publicly accessible.

## What actually ran

- Saved entry document 52 contains 52 event-scoped rows, with no session restriction.
  The old `photo_matching_enabled=false` flag does not disable the current
  automatic applicable-entry-list workflow.
- Recognition, reference matching and caption persistence are working. At
  **11:02:16 UTC**, 137 photos comprised **22 matched**, **63 completed without an
  accepted match**, and **52 queued/running**. This is a changing snapshot, not a
  final gallery result.
- Completed automatic captions are stored with `photo_automatic` provenance.
  Pending photos still have Nextcloud filename placeholders.
- In the initial sample there were no manually protected identifications or
  captions at the 1,000-character limit. These are not the explanation for the
  sampled omissions. Protected editorial captions can legitimately remain
  unchanged even after identification succeeds.
- The matching controls poll active jobs, invalidate gallery queries when saved
  captions change, and keep editor drafts protected. The individual editor polls
  queued/running analysis and receives persisted caption/identification results.
  The existing browser fixture passed; this is not a physical-device or
  authenticated live-browser refresh certification.

## Source-pixel review and bounded replay

Seven originals were retrieved through the existing authorized test account and
the protected file-delivery route. No download-operation endpoints were invoked.
No credentials, cookies or signed URLs were persisted in the report or fixtures.
Inspection files are in ignored `generated-artifacts/number-diagnosis/`.

| Media | Actual finding | Local outcome after the focused fix |
|---|---|---|
| 1225 | Clear #110 BMW and MAHLE branding; entry says MAHLE RACING TEAM | Exact unique team-core match accepted |
| 1232 | #115 with EMM branding; entry says EMM Esports | Exact unique team-core match accepted |
| 1234 | #121 Mercedes with AMG branding; entry car is Mercedes-AMG GT3 2020 | Manufacturer badge no longer treated as a different team |
| 1240 | #124 positive control, already accepted as TC Esports | Unchanged accepted caption |
| 1241 | #125 visible; saved weak team hint says SORACING.NET, while the registered team is SDR SIMRACING | Remains rejected; no fuzzy website/team correction |
| 1216 | Clear #107 Ferrari; weak hints say model “535” and GARAGE61 | Remains rejected due to conflicting model/team hints; pixels reveal a weak-reader false negative, not a missing reference |
| 1243 | Clear #126 Lamborghini; weak team hint says Squadra Corse, entry says UNI-G Racing | Remains rejected; no blanket sponsor/branding exemption |

Local replay used **11 frozen saved photo observations** and the applicable
reference document, without provider calls or database writes. It recovered six
previously rejected matches: media **1220, 1223, 1225, 1226** (#110), **1232**
(#115), and **1234** (#121). The other MAHLE photos were replayed from their saved
evidence; the seven-image original review did not independently re-read every
pixel of all four MAHLE photos.

The two already accepted #124 controls stayed accepted. The three remaining
rejected cases stayed rejected. This demonstrates a matching-rule improvement
on the bounded sample, not improved AI recognition accuracy across the archive.
The larger original #125 image shows SDR-style branding, but the wrong saved
hint cannot safely be repaired by inventing a team alias.

## Scope of the Development fix

- Allow an exact, unique team core of at least three characters after removing
  terminal organisational suffixes. No substring, fuzzy or one/two-character
  abbreviation acceptance.
- Treat literal AMG as manufacturer branding only when the registered car is
  explicitly Mercedes-AMG.
- Preserve complete independently checked numbers, car-local evidence,
  owner/season/session restrictions, ambiguous-team rejection, explicit
  manufacturer/model conflicts, manual identities and caption protection.
- Do not change recognition models, database schema, analysis fingerprints,
  evidence policy markers or automatic historical retry behaviour.

## Videos are a separate result

At the final snapshot:

- Media 1214 (“race start.mp4”) completed with five saved frame observations but
  no accepted vehicle numbers. Its existing filename caption is protected
  `preserved` text; the photo-caption workflow does not rewrite it.
- Media 1215 and 1219 both remain queued after **two attempts**, reporting
  `result_parsing / AI_OUTPUT_INVALID`, with no successfully saved recognition
  frames. Neither is a completed match. The persisted diagnostic does not
  distinguish malformed JSON, missing frame indices, truncation or invalid
  field shape, so the exact provider-response cause is not established.
- Two later imported videos (1339, 1340) are queued with zero attempts.

No video re-analysis, raw provider-payload collection or paid comparison was
triggered by this investigation.

## Verification and release boundary

- TypeScript check passed.
- 25 pure caption/evidence checks passed.
- All 24 photo-workflow integration checks passed against a disposable local
  PostgreSQL database and isolated object storage, with provider calls mocked.
  This includes direct upload with tagging disabled, later entry-list admission,
  restart recovery, preserved/manual text, reference boundaries, and automatic
  single-word-core rematching with saved-caption responses.
- 15 video-number/failure checks passed, including invalid-output retries and
  checked-frame evidence boundaries.
- One browser matching-controls check passed, including automatic status,
  polling, protected captions and retry behaviour.
- The first integration invocation omitted the disposable runner's upload
  opt-in and its real-upload fixture correctly failed. The corrected invocation
  used `--enable-uploads` only for the isolated test process and passed. Production
  upload settings were never changed.

**Nothing was published or corrected in Production.** Already completed
Production jobs are not silently requeued by this code change. After an approved
publish, new analysis/rematching uses the corrected rules. Applying the fix to
existing completed photos requires a separately authorized targeted action;
no archive-wide re-analysis is part of this task.
