# MAHLE #110: missing on-car brand — 15 October 2026

## Read-only evidence

The supplied `attached_assets/IMG_6410_1792092012948.png` matches public media
1501 in event 232. The public thumbnail was also retrieved, without downloading
an original or invoking AI: 640×360, the same white/green side-view BMW, with
readable MAHLE lettering on the door and number 110. This is a human inspection
of actual pixels, **not** a new model-recognition result.

Public `GET /api/media?q=Mahle` and a narrowly scoped read-only Production query
of `media_analysis_jobs` for 1501, 1502, 1504, 1499 and 1776 confirmed:

| Media | Saved visual brand evidence | Stored generated/public brand tags |
| --- | --- | --- |
| 1501 | none; number 110 certified; region [224,486,415,221] | none |
| 1502 | BMW: MAHLE; other car: BROSE | MAHLE, BROSE |
| 1504 | BMW: MAHLE, AMD; other car: CASTROL | MAHLE, CASTROL |
| 1499 | MAHLE | MAHLE |
| 1776 (event 233) | none; number 31 certified | none |

1501's saved visual observation also has a weak `referenceConstraints.team`
value MAHLE. That is not an independent commercial-logo assessment. The public
caption/reference identity MAHLE RACING TEAM explains a general search hit, not
a successful logo detection. The positive neighbours are comparisons, not
permission to transfer logos between photos. 1776's MICHELIN building remains
outside the on-car scope.

## Diagnosis by stage

1. **Localization/input resolution.** The current first pass requests each car's
   normalized rectangle; numbered photos also pass the independent number
   localizer. Recognition jobs use an original when supported, resized to at
   most 1600×1600 (WebP quality 82); tags-only jobs use the thumbnail. Audits use
   the full supplied image plus crops of its actual pixels (WebP quality 90),
   never an imagined high-resolution crop. 1501 has usable saved geometry and
   certified digits. Its exact historical input resolution/crop bytes and
   first-pass output are not retained: a missed or blurred logo reading is
   **unknown**, not excluded by a readable current thumbnail.
2. **Independent reading/classification.** The audit binds full-image and crop
   records geometrically, then accepts complete, matching literal commercial
   text from both views. Historically it could only classify a marking as
   commercial, team or unknown. Raw per-view lettering/classifications,
   completeness, rejected candidates and finish details are not persisted.
   Missing output, partial reading, classification as team/unknown, overflow of
   three markings, malformed optional branding or disagreeing readings can all
   omit a brand. Which occurred for 1501 is **unknown**.
3. **Avoidable code paths, controlled reproductions.**
   - The mutually exclusive team/commercial enum could not represent a literal
     logo with both meanings. New `team_and_commercial` permits explicit,
     independently assessed dual meaning without dropping the team-identity
     veto. `team` alone still cannot produce a brand. A standalone brand logo
     may be commercial even when a team shares its name; do not strip words
     from a longer team identifier to invent a brand.
   - The brand branch also required number agreement between the full and crop
     numeric readings, despite its separate literal logo agreement and unique
     car geometry. Remove only this digit dependency. Number certification and
     reference matching keep every prior digit/panel/geometry gate. Because
     1501's saved number is certified, this numeric mismatch is **not a supported
     explanation for that historical result**; it is a separate reproducible
     omission.
   These are fixture-reproduced limitations, not a claim that either explains
   the historical MAHLE omission or that a model now reads these pixels better.
4. **Optional errors.** Invalid optional branding produces no brands while valid
   numeric evidence survives. Main audit transport/truncation failures still
   follow the existing bounded analysis retry policy; uploads are already
   committed independently. No new calls, retries, token limits or lower
   evidence thresholds were added.
5. **Web filter.** Only visually derived tags enter the existing simple online
   existence check. It accepts a matching website or named search result, uses
   one uncached candidate per analysis, and can omit other uncached brands,
   failed/negative/expired results or concurrent different-name checks.
   It does not remove `visibleBrands` from visual observations. Thus 1501 is
   missing accepted visual evidence **before** this filter; web filtering alone
   does not explain it. 1504's saved AMD evidence without an AMD tag illustrates
   a later-stage omission, but its exact historical web decision is unknown.
6. **Persistence/display.** 1501's job recognition already lacks brands, its
   generated tags lack brands, and public metadata agrees. No evidence of a
   brand lost solely by storage or UI. The worker retains visual evidence apart
   from filtered tags, merges manual tags, honours AI suppressions, protects
   editorial captions/manual identities, matches references separately and
   retains independent publication safety. The existing preview displays
   `Brand: NAME` tags under Visible brands; caption text and untagged
   `identification.visibleBrands` do not synthesize that group. No UI/search
   rewrite or cache invalidation is needed.

## Verification and limits

- `npm run check` and `npm run build`: passed.
- Disposable PostgreSQL/provider-mocked tests cover literal MAHLE overlap,
  no brand derived from a caption, stored evidence and tags, unchanged reference
  identity/number/editorial caption/manual tags, suppression and failed web
  checks. The broader photo/video suites exercise uploads, bounded sampling,
  reference conflicts, manual changes, retries and independent safety.
- Source-crop contract tests cover numeric disagreement with agreeing logos,
  missing/unknown/incomplete logo readings, wrong/ambiguous/shared cars,
  duplicate/missing crop records and malformed optional branding. The image
  processing is real; provider answers are mocked. These prove pipeline
  acceptance/rejection, not pixel-reading accuracy.
- The production-build Chromium fixture checks Visible brands, MAHLE beside
  MAHLE RACING TEAM, absence for a caption-only result, keyboard activation and
  tag-only search navigation. Fixture responses are not live search results.
- Initial combined run: 89/91 passed; two upload checks were invoked without
  the disposable harness's required `--enable-uploads` switch (502 vs 201).
  Correctly configured photo/video rerun: 49/49 passed. This was test setup,
  not a change to the application's upload gate.
- Final photo/crop run including the added invalid-optional-output and competing
  team checks: 51/51 passed. Online-verifier and branding unit suites passed
  21 and 20 checks respectively; Chromium preview test passed. Development
  restarted, listened on port 5000, and the public home page rendered; a
  signed-out `/api/user` 401 is expected. No authenticated UI claim is made.

No paid real AI or web lookup, Production mutation, publish, automatic
reanalysis, historical backfill, schema change or credential change was made.
A separately authorized bounded real-provider evaluation on reviewed MAHLE
pixels is still needed to measure recognition improvement. Live media 1501 is
intentionally unchanged.
