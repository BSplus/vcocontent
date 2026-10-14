# Video branding conflicts — 14 October 2026

## Scope and actual verification

Read-only investigation of Production media 1215 and 1219, event 230.
No reanalysis, paid AI calls, settings changes, metadata writes or publish.
Originals were read through the existing authorized protected delivery route,
not the counted download endpoint. Locally regenerated source hashes and all
eight frame hashes/timestamps per clip exactly matched persisted evidence.

## Visible source evidence

- At 10.861 seconds in the horizontal clip, the camera car has a clear printed
  **96** and prominent **MOZA RACING** branding on its bodywork.
- At 21.722 seconds in the vertical clip, the camera car likewise shows **96**
  and **MOZA RACING** on its bodywork.
- At time zero in both clips, a blue Porsche has **132** on its door and
  ARRC-like lettering. The horizontal weak reader saved ARRC; the vertical
  weak reader saved AIRC. These strings do not establish a different registered
  team, nor does this inspection establish a verified alias for Bleu Mercure.
- These relevant markings are on the cars, not merely unrelated broadcast
  banners. Calling every conflict an overlay error would be incorrect.

Entry document 52 registers #96 as Tatum Res-Tech NordVPN, Cadillac V-Series.R
GTP, and #132 as Bleu Mercure Esport, Porsche 911 GT3 R (992).
Visible branding and the full registered team name are different concepts.
The inspected pixels support the numbers; they do not independently prove the
registered identity or justify a blanket exemption for these brands.

## Exact blocking mechanism

The independent number reader validates digits and car geometry, not team
identity. Weak first-pass team hints survive as veto-only reference constraints.
Strict reference matching rejects any nonempty team hint that does not agree
with the registered team, except the existing narrow literal manufacturer and
unique terminal-suffix normalization cases.

Thus MOZA RACING vetoes the #96 NordVPN reference, and ARRC/AIRC vetoes the #132
Bleu Mercure reference. Successful number checks do not clear those constraints.
Even when the displayed team is empty, the saved constraint can still veto.

## Local causal replay, not a Production correction

Replayed all seven saved checked observations for these two numbers against
document 52 using the existing strict matcher and required number evidence:

- Unmodified observations: all seven stay visual, reproducing the live result.
- Diagnostic copies with only team hints cleared: all seven become references.
- With number provenance removed: numbers remain unknown and do not match.
- With a conflicting Ferrari manufacturer: references remain rejected.
- With a different registered team hint: references remain rejected.
- With conflicting same-number reference rows: references remain rejected.

This isolates the team-hint veto as the cause for this frozen fixture.
Hypothetical hint removal is not measured improvement, an approved policy change
or proof that ignoring branding is safe across other media.

## Recommendation at the end of the read-only diagnosis

Distinguish sponsor/brand text and uncertain lettering from an independently
supported contradictory team identity. For a number-backed match blocked only
by a weak team hint, a bounded same-vehicle verification could resolve whether
the marking is a sponsor, explicit competing team name, or uncertain.

Keep independent number checks, geometry association, reference uniqueness,
event/session/owner boundaries and real vehicle/manufacturer/team conflicts.
Unresolved contradictions must remain unmatched. Do not add global sponsor
allowlists, force these numbers into a team, overwrite protected captions or
reanalyse the archive automatically.

Any such correction requires separate implementation and evaluated positive
and negative controls before claiming better matching accuracy.

## Subsequently approved Development preparation

This section describes the first, video-only correction. The subsequently
approved searchable-brand extension for photos and videos is documented in
`docs/visible-brand-tags.md`; its photo workflows opt into brand assessment too.

The operator approved preparing the focused correction, without publishing or
Production reanalysis.

Video number audits now request an optional, bounded branding assessment inside
the existing independent full-frame/source-crop request. No additional provider
round trip, new model, migration, credentials or Production configuration.
Ordinary photo audits retain their previous behaviour.

A weak hint is cleared only after:

1. The existing independent numeric full-frame, car geometry, crop and any
   original panel checks accept that exact printed number.
2. Exactly one full-frame assessment for that accepted car and one labelled
   crop assessment both report complete, unambiguous commercial-only markings.
3. Both assessments contain the same literal weak hint, allowing only existing
   punctuation/case/accent normalization, not partial/fuzzy names.
4. Neither assessment includes explicit team text or uncertain identity-like
   lettering. Those cases retain the old veto.

Only the confirmed commercial team-hint strings are cleared. Other team hints,
manufacturer/model constraints and reference uniqueness/session/owner gates stay
intact. Raw first-pass hints remain in their original frame records; the verified
frame checkpoint records the exact commercial hints resolved.

Optional branding is limited to three candidate cars and three markings per
view, within the existing numeric token/deadline/request/image budgets. Missing,
oversized or malformed branding assessments do not fail otherwise valid number
checks or uploads; they simply leave the matching conflict unresolved.

### Verification and release boundary

- The five-suite disposable local database regression run passed all 90 checks,
  including real video extraction, checkpoint reuse, upload fallback, caption/
  manual metadata preservation, and event/session/season/owner boundaries.
- After tightening optional branding caps, both affected suites passed all 38
  checks, including three new excessive-output/dense-frame cases.
- TypeScript, production build and whitespace checks passed.
- Provider responses were mocked. These checks establish contract/guard behaviour,
  not real-provider sponsor classification accuracy or recovered live matches.
- No numeric evidence policy/fingerprint was bumped and no existing archive was
  requeued or recertified. An approved publish and separately authorized targeted
  full reanalysis would be needed to obtain fresh branding assessments for the
  two already-completed clips. A reference-only rematch cannot invent them.
- Protected captions are still not overwritten by video identification.
- No Production mutations, paid live AI calls or publishing were performed.
