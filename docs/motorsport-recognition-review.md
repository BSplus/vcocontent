# VCO photo recognition review — 10 October 2026

## Scope and authorization

The user supplied ten photos and authorized “EVERYTHING from
https://photos.vco-esports.com”. Sixteen bounded, metadata-free inputs now cover:
cockpit and helmet details, standalone pit-side/paddock atmosphere, GT3/GT4
body families, prototypes, stock cars, two readable numbers in one photo,
unmatched numbers, distant numbers, natural spray/motion blur and a controlled
partially obscured number. Inventory, provenance, SHA-256 hashes and expectations
are in `tests/fixtures/motorsport/reviewed.mjs`.

Expectations were recorded by **Replit Agent's direct visual inspection before
the provider runs**, not derived from model responses. This is not independent
human certification. Three images are explicit crop/occlusion derivatives, not
new originals. The GT4 source is an 864px public thumbnail, not the full-resolution
original. Body-family context from site captions does not establish visible
class evidence and is never submitted to AI.

## Live method

- Same managed provider and `gpt-4.1-mini` in both runs.
- Same exact pixels and reviewed expectations for all sixteen inputs.
- Sixteen sequential requests per run, 32 total; no SDK retries.
- Existing database-wide `withVisionBudget` used; the production queue,
  concurrency, automatic tag-only path and caption workflow were not modified.
- No media/entry-list writes, no production-wide reanalysis, no captions published.
- `max_tokens=1000`, high image detail, 25-second timeout retained.
- All 32 requests returned parsed observations; no unavailable/busy results.
- Each all-check pass requires expected visible subjects, exact reviewed number
  set, unsupported tags absent and unknown-field/vehicle-count constraints.
  **These are diagnostic counts on a small purposive set, not population accuracy.**

Manifest SHA-256 shared by both runs:
`d35b7d46ddfdfc32e1c91faa7e4799986f27aba2529a803007927b6978d48afa`.

Recognition-source SHA-256 at baseline:
`632d710004da7fd14d4fbe961f268e36a6bd9e086904af2643643ecd4fc5cf7b`.

Recognition-source SHA-256 at candidate:
`237e36295e078f4abc886a84b2d22ccf022c0ce4710feb89c7d9483458924abc`.

The complete local run reports are ignored test artifacts under
`generated-artifacts/recognition/{baseline,candidate}.json`. This document retains
the outcomes; the rerunnable evaluator fails explicitly on quality misses.

## Results

| Reviewed input | Existing prompt | Candidate prompt |
| --- | --- | --- |
| cockpit-driver | Pass | Helmet and Steering Wheel omitted |
| multiple-readable | Numbers 107 and 5 correct; Group omitted | Numbers correct; unsupported `GTE` class |
| prototype-field | Unknown numbers retained; Prototype and Group omitted | Pass |
| wet-prototypes | Unknown numbers retained; wet conditions correct; Group omitted | Pass |
| formula-cockpit | Number unknown; Steering Wheel omitted | **Gear 5 treated as race number**; Steering Wheel omitted |
| esports-ceremony | No entries invented; Trophy omitted | Pass |
| sunset-atmosphere | Numbers unknown; Sunset omitted | Pass |
| gt3-side | Number 107 correct; GT Car omitted | Same omissions |
| prototype-cockpit | Numbers unknown; Steering Wheel omitted | Same omissions |
| helmet-onboard | Numbers unknown; Helmet and Steering Wheel omitted | Helmet omitted |
| stock-89 | Pass: 89, conservative Race Car, no GT Car | Pass: 89, Stock Car |
| wide-group | Numbers unknown; Group omitted | Same omissions |
| gt4-front | GT Car omitted; readable 477 missed | Same omissions |
| helmet-detail | Pass; no vehicle/person identity invented | Helmet omitted |
| paddock-tents | Pass; no racing entries invented | Pass |
| partial-number | **Prefix 10 incorrectly accepted as complete number**; GT Car omitted | Same unsafe prefix and omission |

All-check passes: **4/16 baseline, 6/16 candidate**. Both runs left physical-driver
identity empty on every observation. Both retained unknown numbers in the distant
group and wet/motion-obscured inputs. Neither completed the masked prefix to 107,
but both incorrectly accepted the visible prefix itself as the whole number.

The candidate explicitly requested an entire readable number panel, an
obscuration flag, exclusion of dashboard/equipment digits, no entries for posters,
prioritization of Helmet/Steering Wheel/Trophy/Group/Sunset, separation of generic
body tags from marked classes, and at most twelve distinct observations.
**Rejected:** the improved aggregate count did not outweigh the new dashboard
number and unsupported class. The original production prompt has been restored;
model/provider remain unchanged.

Additional qualitative cautions, not included in the frozen pass count: baseline
called the red GT car's discipline “Prototype” and read GARAGE61 as its team;
GARAGE61 branding does not establish a registered team. Several visibly rendered
scenes were called Real Motorsport. The evaluator is deliberately limited and
does not certify every optional team/model/discipline string.

## Retained safeguards and offline verification

The parser still requires `numberReadable`, valid 1–4 digit syntax and
`classReadable`; it strips arbitrary driver/person claims and unsupported GT3/GT4
tags. A backward-compatible defensive `numberObscured` flag now suppresses a number
even if the provider contradicts itself with `numberReadable=true`. Missing
flags behave as before; this **does not solve unreported visual obstruction**.

Offline tests now verify all image hashes/coverage, handwritten expected-response
parser contracts, unknown fields, class/number gates, multiple independent
vehicle entries, matched and unmatched numbers, team-only ambiguity, managed
request limits and sanitized failures. Comparison tests reject changed
expectations/pixels, missing samples and duplicate IDs.

Source-list names are tested as **registered entry lineups** with
`source=reference`, never as visually identified people; `source=visual` always
has empty drivers. No reference-matching or identity UI behavior was changed.

Offline parser/request tests and live accuracy are reported separately.
Handwritten test responses cannot establish that a model correctly sees a photo.
Future prompt/model candidates must use the same reviewed expectations and
must not trade number/class safety for a higher aggregate score.
