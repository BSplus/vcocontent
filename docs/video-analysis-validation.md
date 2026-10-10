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

## Explicitly unavailable evidence

- No authorized reviewed motorsport video set was supplied. No live video recognition calls were made; no broad accuracy claim is made.
- Actual provider billing information was not available. Cost is stored as `null` (unavailable), never estimated as actual billing.
- This task does not change autoscale behavior or guarantee work continues while an instance is idle. The durable queue resumes when a worker runs again.
- Development schema changes were applied using the existing additive script. No production schema changes or deployment were performed.
