# Efficient video analysis validation

## Implementation and bounds

- Only trusted private original keys (`media-<uuid>.mp4|mov|webm`) are read. No provider receives the video or audio. Temporary originals are byte-limited to the configured video upload limit.
- FFmpeg/FFprobe are project Nix dependencies. Processes use argument arrays, no shell, file-only protocols, supported-container demuxing, one decoding/filter thread, bounded output, and an 8-second wall-clock timeout.
- Sampling has a 75-second deadline, validates duration (up to six hours) and input dimensions against the existing pixel policy, and creates at most one 512 KiB JPEG at a time. No extra permanent video/poster objects are written.
- Short clips (up to 30 seconds) target 5 frames; medium clips (up to 180 seconds) target 8; longer clips target 12. Clips shorter than two seconds target 3. Samples cover equally distributed temporal bands; a scene-change frame in a bounded one-second local window is preferred, otherwise a temporal frame is used. This is not an exhaustive scene scan.
- A small RGB signature rejects near-duplicates. Static and very-short clips may retain only one unique frame. Actual decoded presentation timestamps are saved, not just seek offsets.
- At most four reduced-resolution frames (960px maximum edge, without upscaling) share one request to the existing managed `gpt-4.1-mini` connection. Output is limited to 2,400 tokens and 24,000 response characters; schema/readability/taxonomy checks are mandatory.
- Existing database-wide limits remain two active jobs, two vision requests and 1,000 pending jobs. Queue-owned attempts remain capped at three (busy provider slots do not spend an attempt). Video requests have a 25-second deadline; a worker-token-fenced heartbeat renews the 90-second lease every 15 seconds.
- Temporary files are removed on success and ordinary failures. A terminated process cannot run `finally`; stale directories are swept on worker startup and subsequent queue ticks after five minutes. Live work's bounded duration is below that threshold.
- A four-directory admission threshold also bounds interrupted-original accumulation during rapid restarts. With two database-wide workers, a simultaneous admission race can produce at most five temporary originals; further sampling fails safely until cleanup makes room.
- Source keys are immutable and distinct from shared posters. The requested-job fingerprint includes the original source key, sampler and recognition versions. A SHA-256 digest of the downloaded video validates partial evidence before reuse. The pipeline never automatically requests the existing library.
- Partial successful batch observations survive ordinary retries. Explicit reanalysis clears partial evidence for a new generation but preserves the last successful saved tags/identification if that generation fails. Reference revisions rematch successful saved observations locally without provider calls.
- Manual tags, AI-tag suppressions, confirmed identification, captions and concurrent edits are reconciled under a media row lock. Multiple entries remain separate observations; matching names are registered lineups, not physically identified drivers.

## Reproducible checks

Run database/queue tests serially with the preview worker stopped:

```sh
npm run test:video-analysis
node --import tsx --test --test-concurrency=1 tests/media-processes.test.mjs tests/motorsport-recognition.test.mjs tests/analysis-tag-reconciliation.test.mjs tests/nextcloud.test.mjs tests/recognition-reference-api.test.mjs tests/ai-tagger.test.mjs
```

Run the real browser editor regression with the preview serving:

```sh
node --import tsx --test tests/editor-tag-roundtrip.test.mjs
```

The video checks generate decodable synthetic clips in temporary directories and mock the managed OpenAI HTTP transport. Ingestion checks use isolated role fixtures and in-memory App Storage transport; the application authentication is not bypassed. They cover automatic uploads, unchanged originals, opted-in import behavior, permissions, deduplication, unavailable/full queues, partial retries, reference-only matching, manual edits, failed reanalysis, lease renewal/recovery/fencing, static deduplication, corrupt inputs and temporary cleanup. The editor check covers image and video tags, removed tags and refreshed identification on desktop and touch viewports.

## Observed extraction and mocked usage

One serial local run produced:

| Synthetic clip | Unique frames | Extraction time | Sample timestamps (seconds) |
|---|---:|---:|---|
| 1s static MP4 | 1 | 0.55s | 0 |
| 12s static MP4 | 1 | 0.78s | 0 |
| 20s changing MP4 | 5 | 0.92s | 0, 4, 8, 12, 16 |
| 60s changing WebM | 8 | 1.49s | 0, 8, 15, 23, 30, 38, 45, 53 |
| 181s changing MP4 | 12 | 2.74s | approximately 0, 16, 31, 46, 61, 76, 91, 106, 121, 136, 151, 166 |

Timings are environment-specific, not a throughput guarantee. A 60-second retry fixture retained eight successful frame observations with three provider requests: one successful four-frame batch, one failed second batch, then only the remaining four-frame batch. The mock returned 400 known prompt tokens and 200 known completion tokens across the two successful responses; usage for the failed request was unavailable. These are deterministic mock values, **not measured live OpenAI usage**. Known available usage is retained even if another request has unavailable usage.

## Authorized live pilot — 10 October 2026

The operator supplied seven clips and five reference files, authorized the existing
managed AI connection, and explicitly chose a lightweight provisional review
instead of requiring a pre-annotated benchmark. Five originals fit the unchanged
50 MiB video policy; the 63.94 MiB Finish edit and 57.06 MiB #196 IMSA clip were
excluded without transcoding or changing defaults.

All five eligible clips completed through the real queue, sampler, managed
`gpt-4.1-mini` recognition, aggregation and database-save path. A pilot-only
App Storage reader served the supplied local originals; no originals were
uploaded to storage or sent to AI. Saved values and timestamped evidence were
exported before removing only the disposable pilot events/media/jobs.
The existing additive development schema script was needed before this run;
no production database or deployment was changed.

| Clip | Duration | Frames / requests | Prompt / completion tokens | Saved numbers | Reference match |
|---|---:|---:|---:|---|---|
| BS+ IMSA round 1 007 | 8.38s | 5 / 2 | 4,902 / 1,190 | 31, 110, 112, 196, 105; also team-only Mahle | None |
| Snippet #99 | 7.83s | 5 / 2 | 4,902 / 485 | 99, 9 | None |
| Gran Turismo 7 | 19.69s | 5 / 2 | 4,902 / 787 | 48; 65 omitted after conflicting branding | None |
| BS Sebring Clip 16 (MOV) | 7.17s | 5 / 2 | 4,902 / 437 | 16 | None |
| Top of the hill GTDs slow mo | 15.38s | 5 / 2 | 4,902 / 741 | 16, 199, 144; also team-only observations | None |

Total: **25 analyzed frames, 10 requests, 24,510 prompt and 3,640 completion
tokens**. All ten requests supplied usage; zero unavailable-usage requests.
These are actual response usage values, not deterministic mock values or
billing amounts. Actual cost remains `null` because no billing evidence exists.
Extraction times for the queue run were 12.62s, 3.41s, 6.08s, 3.01s and 5.38s
respectively; timings are environment-specific.

`docs/video-analysis-live-results.json` preserves saved tags, separate identities,
raw aggregated recognition, individual frame evidence, timestamps and usage.
`generated-artifacts/video-review/editorial-review.html` is a self-contained
human-readable review with thumbnails and per-tag/per-identity
Correct/Incorrect/Uncertain selectors plus a local CSV export. All verdicts start
pending; selections are not uploaded or auto-saved.

### Provisional quality flags, not human ground truth

- #99 also produced a separate #9 in the cropped last sample. Review whether this
  is a partial-number hallucination, not a distinct car.
- Gran Turismo #65 was present in frame evidence but dropped from saved
  identification because team readings conflicted (`ARTASANA` / `ATLASIAN`).
  The surviving #48 / `VITALITY` and `GT2` class need review.
- Review small/distant numbers, sponsor-versus-team text, specific manufacturer
  claims, and real-versus-sim labels. The game replay did not receive Sim Racing;
  the Sebring clip received Real Motorsport. No automated editorial verdict is
  assigned here.
- Team-only and numbered observations remain separately recorded, but are not
  evidence of distinct physical cars. Numbered observations are not physical
  driver identifications.

### Reference boundaries and coverage

The development database had no reference documents. No verified association
between a supplied clip and an existing event/session/season was available.
Consequently no list was attached or globally pooled, no teams were reference
matched, and all listed drivers remained empty. Visual team text in the results
must not be presented as a matched registered team.

The supplied lists were inspected: ERL's list was generated 24 August 2025;
INFINITY has 24 race-specific sheets; Le Mans Virtual's provisional list is
dated 23 May 2020 and has no driver lineup; the nominated ERL workbook is for
Live for Speed; the Michelin 240 PDF's actual heading is Daytona, 12 January
2025, despite its 2024 filename. Filename/number coincidence is insufficient to
authorize an association. No Result List was supplied.

This set covers short action, multi-car scenes, a game replay with camera cuts,
and an exterior view of an open-cockpit prototype. It has no dedicated onboard,
pit/paddock, static racing or long (>30s) clip. Synthetic fixtures continue to
cover static/long extraction technically, not live accuracy.

Technical checks passed serially with the preview worker stopped:
13 `npm run test:video-analysis` checks and 19 checks across
`tests/motorsport-recognition.test.mjs`,
`tests/recognition-reference-api.test.mjs` and
`tests/analysis-tag-reconciliation.test.mjs`. These cover scoped private owner /
series / season boundaries, session and result precedence, ambiguity, registered
lineup semantics, saved tags and retry behavior. The test suite's printed
`liveRecognition: unavailable` refers to its mocked fixtures, not this separate
authorized live pilot.

The desktop/touch editor tag-roundtrip browser regression also passed. The
generated report was checked in a real browser: all 59 review selectors started
pending, sampled thumbnails loaded, verdict changes reached the CSV export, and
the 390px layout had no page-level horizontal overflow. A screenshot confirmed
the rendered summary. This is report usability evidence, not editorial review.

Reproduce inspection without AI calls:

```sh
python .agents/scripts/inspect-video-references.py
node --import tsx scripts/inspect-video-clips.mjs
```

The live script is **not an automated test**. It requires operator approval,
stopped preview worker, idle development queue, originals at the supplied paths,
the additive development schema and explicit `--authorized-live`:

```sh
node --import tsx scripts/validate-authorized-videos.mjs --authorized-live
node scripts/render-video-review.mjs
```

It refuses to overwrite an existing live-results file to prevent accidental
repeat billing. Preserve/review existing evidence before deliberately rerunning.
Generated frames, report and large originals are excluded from Git/deployment;
small structured evidence is retained in the docs. Providers, recognition
prompts and automatic image defaults were not changed.

## Remaining unavailable evidence

- Editorial review is pending. AI results are not human-reviewed ground truth;
  no validated accuracy or broad recognition claim is made.
- Actual provider billing information was not available. Cost is stored as `null` (unavailable), never estimated as actual billing.
- This task does not change autoscale behavior or guarantee work continues while an instance is idle. The durable queue resumes when a worker runs again.
- Development schema changes were applied using the existing additive script. No production schema changes or deployment were performed.
