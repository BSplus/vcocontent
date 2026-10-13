# R2 Development live smoke — FAIL / blocked

**Superseded by the separately approved final smoke:** see
[final Development smoke — PASS](r2-final-development-smoke-report.md).
This document retains the earlier failed attempt and its cleanup evidence.

**Diagnostic follow-up:** see [delivery investigation](r2-development-delivery-investigation.md).
The saved failure did not identify which request returned 404. Calling it a
confirmed *photo* failure was inaccurate. A stale AI-replaced video-poster URL
reproduces the 404 locally; the original historical request cannot be proven
without a trace. The prepared runner now refreshes metadata and records stages.

**Cleanup follow-up, 13 October 2026: PASS.** The operator explicitly approved
five-object Development cleanup. All five exact keys below were deleted and
individually verified absent; associated test records were removed. The earlier
smoke remains FAIL/incomplete because an untraced request in the grouped
photo/video-preview check returned 404 and later checks did not run. This cleanup
does not establish a delivery fix.

13 October 2026. Executed only against private EU Standard
`vco-content-media-dev` and independently verified managed Development database.
No Production credentials/database/bucket/settings, deployment, archive/reset,
existing-media migration or existing Replit object deletion.

## Results

| Check | Result | Evidence / limitation |
|---|---|---|
| Development isolation/configuration | PASS | Offline namespace, exact bucket, EU endpoint, DB pin and absence of Production credential names verified before live operations |
| Upload | PASS | One new Creator PNG and one new two-second H.264 MP4 uploaded through the existing authenticated app upload endpoint; photo preview and video poster generated |
| R2 read-back/integrity | PASS | Actual signed reads of the four initial keys matched catalog SHA-256, byte length and MIME; photo/video source hashes equal input bytes |
| Photo/video-preview delivery group | FAIL / incomplete | An authenticated GET in this group returned HTTP 404; the original runner did not capture its path. It cannot be attributed specifically to the photo |
| Video playback/HTTP Range | NOT RUN | Stopped after the earlier delivery failure |
| Permissions | NOT RUN | No conclusions drawn from the authenticated 404; negative access checks were not reached |
| Creator quota | PARTIAL | Read-only accounting: 19,377 bytes, one photo, one gallery, zero unknown bytes/pending Creator cleanup. Endpoint/boundary tests not reached |
| AI processing | PASS | Existing automatic photo and video analysis jobs both completed on their first attempt; photo gained a “Sim Racing” tag and both retained the supplied manual tag |
| Download statistics | NOT RUN | Authorization/completion/deduplication checks were not reached; historical counter sum on the original 75 rows remains 4 |
| Initial four-object cleanup safeguard | Correctly stopped | Video AI generated a fifth replacement-poster key outside the initial scope |
| Subsequently approved five-object cleanup | PASS | Exact five-key allowlist, ownership/FK/reference checks, per-object absence verification and targeted associated-record deletion |
| Original 75 records | PASS | All 75 row fingerprints exactly match the pre-test baseline; no archive or changes |
| Upload gate | PASS | Reclosed to `MEDIA_STORAGE_NEW_UPLOADS_ENABLED=false` and Development workflow restarted |

“PASS” on AI confirms normal processing completed, not recognition accuracy for
a synthetic test image. No anonymous unsigned S3 test was repeated. The prior
manual bucket review remains configuration evidence, not a new live public-access
test. No browser playback or signed-in visual UI check was completed.

## Allowlist and remaining fixtures

Created test media IDs **3878 (photo)** and **3879 (video)**, test events
**275/276**, and dedicated test users **198/199**. No existing accounts were used.
Generated inputs, authentication passwords/cookies stayed private; credentials
are not included in this report.

Initial four verified keys:

| Key | Bytes | MIME | SHA-256 |
|---|---:|---|---|
| `media-9c700761-7fb3-8441-8d87-3482d9378088.png` | 14573 | image/png | `b1b52bbbde35d83a33482b9c0ef38743280d88950be273838f414367f8477a14` |
| `media-969d7b88-c2cd-4df1-8f0d-dd5285537dd5.mp4` | 43959 | video/mp4 | `a94529fe1ef2b678d403001427ca15e0af93a628a4914b4f818024690f18f15a` |

Photo preview and initial video poster:

- `thumb-9c700761-7fb3-8441-8d87-3482d9378088.webp`
- `thumb-969d7b88-c2cd-4df1-8f0d-dd5285537dd5.webp`

Their actual byte sizes/hashes/MIME were verified and are preserved in the
private, ignored `generated-artifacts/r2-smoke/evidence.json`.

**Unexpected follow-up key:**
`thumb-c92cf876-b69b-40d5-a52c-40856b1cfe62.webp`.
The ordinary video-analysis workflow assigned this replacement poster to test
media 3879, leaving its original poster in `media_cleanup`. The catalog showed
five verified Development R2 keys at the stopping point. No new storage system
or migration tooling was introduced.

At the initial stopping point, no explicit cleanup/deletion had been performed.
After separate five-key approval, isolation and ownership were rechecked before
network deletion: exact Development namespace/bucket/endpoint, upload gate closed,
test-user names/run IDs, gallery ownership, exact media URLs/current poster,
completed analysis workers, R2 provider/metadata/version and absence of outside
references. Every current foreign-key relationship was audited before any object
was deleted. Only these five named R2 objects were accessed/deleted; there was no
bucket listing, prefix sweep, global cleanup, Replit delete or Production access.

All five objects were present at cleanup preflight, then deleted and individually
confirmed absent. Targeted Development database cleanup removed:

- 2 test media rows and their 2 completed analysis jobs via the verified FK;
- 5 provider-catalog rows and the 1 test-poster cleanup queue row;
- 2 test galleries, 2 test users, 2 test sessions and 2 test-user rate-limit rows.

Final verified state: **75 media, 0 archived, 34 users, 23 events, download counters
4, 0 provider mappings, 0 cleanup rows and 0 analysis jobs**. Original 75
fingerprints still exactly match the pre-test baseline. The upload gate remains
closed and the prepared R2 routing configuration remains unchanged. Old media
continues to resolve through Replit. Cleanup evidence is retained privately in
`generated-artifacts/r2-smoke/evidence.json`, without credentials/session cookies.

## Remaining work — separate approval required

The approved five-key cleanup is complete; no smoke fixtures remain.

The separately approved read-only investigation and isolated local reproduction
are now documented in `r2-development-delivery-investigation.md`. The prepared
runner is corrected, but a final live smoke still requires approval and has not
run. Before it, agree the five-key budget for the initial four objects plus one
automatic replacement poster, including cleanup of the retired original poster.
Do not silently expand that allowlist. Archive/reset and Production activation
remain separately unapproved.
