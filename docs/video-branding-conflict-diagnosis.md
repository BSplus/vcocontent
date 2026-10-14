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

## Recommended next implementation, not performed

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
