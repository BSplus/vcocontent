# Sebring 196: verified reference rejection and bounded correction

## Scope and evidence

Inspection: **15 October 2026**. Production was read-only throughout. No publish,
production writes, live retry, caption changes or paid provider calls.

The deployment metadata confirmed the public origin
`https://vco-content-studio.replit.app`. A GET of
`/api/media?q=Sebring%20bmw` reproduced medium **1559**, event **232**, position
**14** in the returned result (the supplied screenshot shows 14 of 37).
Its stored state was:

- `photoMatchStatus=no_unique_match`, `captionSource=photo_automatic`.
- Caption: `IMSA Esports Global Championship · Round 2 · Sebring International Raceway · iRacing · 11 October 2026 | BMW, Ford`.
- Four separate visual observations; only the second has number `196`,
  `numberEvidence=vehicle-crop-v2`, region `[307,432,324,350]`, checked make BMW,
  and `referenceConstraints=[{team:"Turner",vehicle:"",manufacturer:"BMW"}]`.
- The three other cars have no supported number. Their own `TMS Power` /
  `Motorsport` hints are not evidence about the numbered car.
- Read-only production SQL confirmed the job's cached `recognition` contains the
  same observations. Neither cached nor displayed observations contain independent
  team-lettering assessments.

### Applicable references, not an invented entry

The production event is official (`creator_id IS NULL`), series 1, reference
season 2026, date 11 October 2026; the photo's recognition session is null.
Using the loader's event/owner or season/series/year/owner predicates returned
**one document**: **54**, event scope, entry kind, no document session,
52 confirmed rows, updated `2026-10-15T15:44:38.471Z`.
There were **no applicable season documents** and **no legacy event-entry row
for 196**. The document's only 196 row is:

| Number | Official team | Registered vehicle | Registered lineup |
| --- | --- | --- | --- |
| 196 | BS TURNER | BMW M4 GT3 | Daniel Lafuente, Oskari Rinne |

Its row session/event-name fields are empty. Manufacturer is empty; the explicit
registered model supplies the vehicle. There are no conflicting same-number
rows and no second applicable team with the complete Turner suffix.

The event-entry row priority is **10** (event + no session + entry). There is no
higher-priority result/session override or competing applicable document in this
snapshot. Clearing **only** the stored `Turner` team hint in an isolated replay
produces the official match. Retaining it with the old proof leaves the number
intact but rejects enrichment. Thus the concrete rejection is the team-hint
comparison (`turner` versus `bs turner`), not number recognition, list scope,
vehicle appearance, or reference ambiguity.

Production queries used (parameters bound, read-only):

```sql
SELECT d.id,d.scope,d.kind,d.session,d.updated_at,
  jsonb_array_length(d.rows) AS row_count,
  (SELECT jsonb_agg(r) FROM jsonb_array_elements(d.rows) r
   WHERE r->>'number'=$4) AS number_rows
FROM reference_documents d
WHERE (d.event_id=$1 AND d.owner_id IS NULL)
   OR (d.scope='season' AND d.series_id=$2 AND d.season_year=$3
       AND d.owner_id IS NULL);
-- parameters: 232, 1, 2026, '196'
SELECT * FROM event_entries WHERE event_id=$1 AND number=$2;
-- parameters: 232, '196'
```

The full applicable document was also read to check all team names, priorities,
sessions and competing rows. Tests project its 196 row and team-name set rather
than copying unrelated registered lineups.

## Correction

No Turner/196 exception and no blanket removal of team vetos.

1. Reuse the independent full-image/source-car-crop branding audit in the
   existing request. No reference names or first-pass guesses are supplied.
2. Keep the commercial / team / team-and-commercial / unknown distinction.
   Literal Turner alone is **not** asserted to be a sponsor or competing team.
3. Record the separate `same-car-team-markings-v1` evidence only after all
   existing number/panel/geometry/unique-car gates succeed. Both complete
   assessments must agree on the entire set of literal markings and their kinds;
   any unknown, missing, conflicting, wrong-car or duplicate assessment fails
   closed for this addition.
4. An independently checked explicit team marking can omit a **2–3 uppercase
   letter prefix** from a registered name, but must cover its entire remaining
   core. Require a unique full official team spelling in the applicable team
   set, including checking other teams with that suffix. Do not accept arbitrary
   words, partial glyphs, fuzzy names or an unverified alias. This deliberately
   narrow rule addresses the actual `BS TURNER` / `Turner` shape.
5. Every independently checked explicit team marking also participates in veto
   checking, not just hints retained by the weak reader. A genuine rival marking
   cannot disappear because the weak reader omitted it. Commercial hints are
   cleared only by the separate existing exact commercial-evidence path.
6. Official identity, vehicle and registered lineup still come exclusively from
   the unique number-backed reference. Vehicle appearance is not authority over
   that registered car. No claim about the physical driver is made.

Evidence persists in the existing identification/recognition JSON; no schema
migration is required. The new marker changes only the added team-lettering
acceptance, not `vehicle-crop-v2`, the global recognition fingerprint or automatic
reconciliation. New audits strip caller-supplied team provenance first. Unsupported
number/source/geometry cannot reuse it.

Explicit selected-photo processing now runs a cache-only rematch even when the
reference revision is unchanged and the previous job completed. Running jobs
retain their leases; unselected completed jobs are not affected. Legacy cached
observations do not acquire the new marker or silently trigger paid recognition.

## Controlled development outcome

`tests/sebring-196-matching.test.mjs` reproduces the exact saved four observations,
actual applicable entry and applicable team-name set. It feeds synthetic pixels
and explicitly mocked independent provider responses. Network and database calls
are forbidden in that replay. The positive response deliberately models a
complete same-car explicit **team** marking `Turner`, not an assumed sponsor.

After the additional checked marking, the second car alone gets:

```text
source=reference, number=196, team=BS TURNER
vehicle=BMW M4 GT3, drivers=Daniel Lafuente, Oskari Rinne
photoMatchStatus=matched
IMSA Esports Global Championship · Round 2 · Sebring International Raceway · iRacing · 11 October 2026 | #196 BS TURNER — BMW M4 GT3 — Daniel Lafuente, Oskari Rinne
```

The other three cars remain unknown and receive no transferred identity.
The JSON round-trip retains the evidence and reproduces the match.
The database-backed worker test uses disposable local PostgreSQL, isolated storage
and mocked providers to verify persistence, automatic caption/status and selected
same-revision rematching with **zero additional provider calls**. Manual tags,
protected captions and manual identifications remain protected.

Negative controls cover commercial-only hints versus genuine competing teams,
unknown/dual-role/conflicting lettering, duplicate/absent/incomplete assessments,
other-car branding and number borrowing, shared car anchors, incomplete digits,
missing supplied-panel readings, same-number conflicting team/car/lineup rows,
ambiguous suffix teams, partial names, and wrong owner/event/series/year/session
contexts. Existing leading-zero, reference-priority and private-source controls
remain in the regression suites.

Two old diagnosis assertions still expected weak manufacturer/model guesses to
veto registered vehicle data. They were aligned with the already approved
entry-list vehicle authority; production vehicle-matching semantics were not
changed by this work.

### Verification

```sh
npm run check
npm run build
env -u MEDIA_STORAGE_ENVIRONMENT \
  DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture \
  node --import tsx --test --test-concurrency=1 \
  tests/sebring-196-matching.test.mjs \
  tests/photo-caption-omission-diagnosis.test.mjs \
  tests/photo-number-evidence.test.mjs tests/video-branding-evidence.test.mjs \
  tests/vehicle-captions.test.mjs tests/caption-proposal.test.mjs
node scripts/test-image-downloads.mjs --enable-uploads tests/photo-matching.test.mjs
node scripts/test-image-downloads.mjs tests/video-number-evidence.test.mjs \
  tests/video-output.test.mjs tests/recognition-reference-api.test.mjs
```

The video number suite needs disposable PostgreSQL even with mocked Vision:
its budget acquires a database lock. A first attempt with an intentionally dead
database failed at that lock, not at branding; using the proper isolated harness
passed. No production/development connected database was used for these tests.

## Explicit live boundary and remaining limits

- **Local replay and provider contracts:** successful as above.
- **Actual pixels:** only the operator's supplied screenshot was viewed. It shows
  196, but is not a new independent full-source/crop branding evaluation.
  No real provider classification of its Turner lettering was performed.
- **Production:** unchanged; no writes, publish, live rematch, revision update or
  global requeue. The code is on the task branch only.
- **For this existing live photo:** a pure rematch of its saved evidence still
  returns `no_unique_match`; it lacks the required independent lettering proof.
  A separately approved selected-photo image reanalysis would be necessary to
  acquire that evidence. It could confirm team/commercial lettering, but could
  also remain unknown; the offline positive is not a prediction of model output.
  The existing explicit reanalysis flow is separate from cache-only retry.
- The optional branding budget still covers at most three cars/three markings.
  Longer prefixes, other short-name shapes, uncertain text and ambiguous
  classifications intentionally remain unresolved. No new OCR/model project,
  paid live evaluation or new human confirmation UI is included.
