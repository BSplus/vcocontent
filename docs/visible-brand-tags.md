# Visible brand tags — Development preparation

## Behaviour

New requested photo and video analyses can add searchable tags such as
`Brand: MOZA RACING`. Only literal commercial lettering independently assessed
on the same car in the source full frame and labelled source crop is eligible.
Unknown abbreviations, uncertain purpose, invalid geometry or missing/disagreeing
assessments do not produce a tag.

Brand proof is separate from number proof: unnumbered cars and photos without
entry lists can receive brand tags, but never a guessed team/driver identity.
Explicit team text beside a confirmed commercial logo still blocks unsafe
entry-list matching; the commercial logo can independently be searchable.
Only the existing narrow, checked commercial-hint correction releases a team
hint. Vehicle/manufacturer/uniqueness/session/owner gates remain.

Brand names use bounded, case-normalized literal text, no sponsor aliases or
global brand allowlist. AI tags remain subject to existing editorial suppression
and manual-tag preservation. The metadata is displayed as **Visible brands**,
not as proof of contractual sponsorship.

The shared photo/video preview separates brand chips from ordinary scene tags.
A brand link closes the preview and opens `/search?q=NAME&fields=tags`. The
existing public tag search and its permission/publication boundaries are reused.

## Cost and storage

Brand assessment shares the existing full-frame/car-crop audit wherever that
audit already runs. Photos that previously needed only scene tagging can now
need one additional bounded crop audit when the first pass supplies car geometry.
Previously unchecked unnumbered video frames can now consume the same bounded
localization/audit pair, inside the existing maximum four frames/eight requests.
No separate sponsor-recognition service or unbounded per-logo requests.
The subsequent online-existence gate has a separate small, cached web allowance;
the four-frame/eight-request limit describes the visual pipeline, not all online
verification traffic. See `docs/brand-online-verification.md`.

Optional output stays capped at three cars and three markings per view, with
existing numeric deadlines/token/image/request budgets. Invalid optional branding
leaves brands unknown rather than failing valid numeric output. Analysis remains
independent of committed upload and publication safety.

Brand evidence uses existing JSON metadata and the existing tags array. No table,
column, index or schema migration is required. Old completed media is not
automatically reanalysed or assigned brands. Existing captions remain protected.

## Checks and limits

- TypeScript and the production build passed; Development restarted and the
  homepage rendered. A pre-existing Development media-resource 502 remains
  outside this change; no startup crash was observed.
- Disposable local database regression: 97 of 98 checks passed in the combined
  run; the existing leading-zero OCR test hit its unchanged processing deadline.
  The single failed check passed on an isolated rerun, without changes to OCR,
  its deadline or the numeric safeguards. All 98 distinct checks have a passing
  result.
- Coverage includes persisted photo brands, tag search, no-number/no-reference
  cases, editorial suppression, caption/manual metadata preservation, video frame
  provenance, reference conflicts, output budgets and real local video extraction.
- The local Chromium fixture check passed for both photo/video preview groups,
  keyboard link activation, dialog closure, tag-only search URLs and empty groups.
  It does not verify authenticated Production video playback.
- Provider responses were mocked. Real-provider brand-classification accuracy
  and specific live video improvements still require separately approved testing.

For that initial visual-tag preparation, no Production mutations,
credential/configuration changes, paid live AI calls, publishing or historical
bulk reanalysis were performed. Subsequent Development-only online verification
checks and their limits are reported in `docs/brand-online-verification.md`.
