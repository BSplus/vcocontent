# Continuous media analysis: development validation and hosting choice

## Approved scope and operational recommendation

After reviewing the development results, the operator approved implementing the
recommended single-VM configuration. The `.replit` deployment target is now `vm`,
with the existing `npm run build` / `npm run start` commands. The production-only
environment variable `MEDIA_ANALYSIS_CONCURRENCY=1` is configured; development
retains its existing default. No additional service was created or published.
The **0.5 vCPU / 2 GiB machine size must be selected in Publishing → Adjust
settings → Machine configuration**; the available configuration tools do not
set the hardware size. Confirm the displayed price and click Publish to activate
the configuration. These preparation changes alone do not start a paid VM.
Replit's deployment service reported `isDeployed: false`, no production URL or
deployment type, and no successful active build. This describes this project's
reported publishing status, not proof that no other project hosts the site.

Recommend **one 0.5 vCPU / 2 GiB Reserved VM with one active analysis job** for
occasional batch uploads, subject to a short check on the actual VM after the
operator publishes. This is the smallest supported option we evaluated.
It is a more evidence-based, lower-cost recommendation than the earlier tentative
1 vCPU / 4 GiB recommendation. Do not create a separate paid worker deployment.

The existing application starts its own durable worker. A Reserved VM keeps that
process running without visitor traffic, unlike Autoscale which can scale to zero.
A workspace workflow is only a development runner, not a production always-on
worker. Scheduled deployments support periodic work but do not give this existing
combined website continuous processing.

### Current documented compute prices

Consulted Replit documentation on 10 October 2026:

- 0.5 vCPU / 2 GiB: **$0.0208/hour**, approximately **$15.18/730-hour month**.
- Dedicated 1 vCPU / 4 GiB: **$0.0486/hour**, approximately **$35.48/730-hour month**.
- These are gross compute estimates before credits/taxes. Database, storage,
  transfer and managed OpenAI are separate; switching compute does not eliminate
  them. Incremental compute cost equals the VM charge minus current Autoscale
  compute spending, which was not available. The final publishing quote controls.

Sources:

- https://docs.replit.com/billing/aug-cloud-billing-updates
- https://docs.replit.com/features/publishing/machine-configuration
- https://docs.replit.com/features/publishing/deployment-types

## Focused experiment

Run with the preview and other queue consumers stopped, no pending development
analysis/import jobs, and the existing additive development schema applied:

```sh
node --import tsx scripts/apply-dev-process-schema.mjs
node --import tsx scripts/validate-media-worker.mjs
```

The runner refuses to consume existing pending jobs and removes its disposable
users/events/media, objects and temporary files. Both harness processes reject
production mode. The result is written to the ignored
`generated-artifacts/media-worker-validation.json`; fixture data stays in `/tmp`.
The current development DB was initially missing the already implemented
`video_evidence` column; the existing additive development setup fixed it.
No production schema setup was run.

The worker child runs the real Express upload routes, PostgreSQL persistence,
queue claiming/heartbeat/fencing, Sharp conversion and FFmpeg sampling. Storage
is an isolated local-file transport. The OpenAI transport returns deterministic
valid responses after two seconds: **no billable requests**. Test authentication
exists only in the loopback fixture process, never in application startup.

Fixtures:

- Two supplied VCO PNG photos: 2160×2700 / 11,511,713 bytes and
  2560×1080 / 5,499,266 bytes.
- Two uploads of a changing, decodable 60-second 1920×1080 MP4 at 5 fps,
  24,075,426 bytes each. Each retained eight frames.
- Another supplied photo uploaded while video work was actively running, with
  the same photo uploaded idle for comparison. Default image uploads remained
  unanalysed unless explicitly opted in.

Each scenario used a fresh route/worker process. Process-group RSS was sampled
every 50 ms, **including FFmpeg children**, excluding the client, fixture generator
and remote database. CPU is the group's aggregate CPU time, including reaped
children, with roughly one-second peak windows (100% = one fully busy core).
Production Vite is not required; this harness includes real route modules but not
the exact deployed HTTP/static/session stack.

One-core affinity was enforced with `taskset`. The half-core approximation pauses
and resumes the entire process group in alternating 100 ms periods. It is
**not an actual Replit CPU quota or Reserved VM**, and no 2 GiB memory cap was
enforced. Shared CPU contention, live storage/database latency, production
networking, high-frame-rate/4K codecs, 40-megapixel uploads, many concurrent HTTP
uploads and live provider variability were not benchmarked.

### Measured results

| Scenario | Image peak RSS | Video + upload peak RSS | Image/video peak CPU | Two-video completion | Idle / during-video photo upload |
|---|---:|---:|---:|---:|---:|
| Two jobs, one core | 257 MiB | 581 MiB | 99% / 102% | 14.66 s | 0.47 / 1.37 s |
| Two jobs, half-core approximation | 245 MiB | 529 MiB | 50% / 52% | 27.13 s | 1.05 / 2.57 s |
| One job, half-core approximation | 239 MiB | 412 MiB | 51% / 51% | 45.08 s | 0.96 / 1.65 s |

All scenarios completed with **zero failed jobs**. Sequential half-core processing
used 1.96 CPU-seconds for the photo phase and 11.08 CPU-seconds for two videos plus
the concurrent photo upload. The photo pair completed in 32.45 s sequentially
versus 6.60 s with two jobs on half-core; this includes the worker's existing idle
polling delay, not just provider/CPU time. Sequential processing trades completion
speed for lower peak memory and better upload responsiveness. Upload responses
did not wait for analysis completion. These small samples support occasional
batch use, not a throughput SLA.

### Real crash/restart recovery

1. Uploaded a video to the real route and allowed the first four-frame batch to
   persist successfully in PostgreSQL.
2. Held the second provider response and sent **SIGKILL** to the worker process
   group. No graceful cleanup or queue reclassification was performed.
3. Started a fresh process with a different PID and waited for the **real
   90-second lease** to expire. No timestamps were backdated.
4. The startup/timer worker completed the job **99.15 seconds after restart**,
   on attempt two, with eight saved frames.
5. The restarted process sent exactly **one** request. None of its frame hashes
   overlapped the previously successful batch. Repeating an ordinary analyze
   request for the completed job produced no further provider request.
6. Confirmed cleanup of this run's abandoned temporary directory after aging
   only that directory beyond the existing five-minute cleanup threshold.

Recovery is durable but not instantaneous. Three attempts remain the limit.
Persisted successful batches are reused; a provider response lost before its DB
commit may be billed and repeated. This is not an exactly-once external API
guarantee. A hard-killed process cannot run `finally`; stale cleanup handles its
temporary files. Real production instance replacement remains untested because
production changes were explicitly withheld.

## Low-resource setting and preserved behavior

`MEDIA_ANALYSIS_CONCURRENCY=1` lowers the active job limit to one without changing
the architecture. Its allowed values are 1 or 2; the unchanged default is 2.
The development experiment used this override only in its validation children.
Following approval, the production environment now has the one-job setting;
development settings are unchanged. All processes connected to the same queue
must use the same setting.

The claim limit remains database-wide and transaction-locked. The shared
two-request provider budget remains unchanged and also protects captions/OCR.
Heartbeat renewal, worker-token fencing, attempt budgets, pending-job ceiling,
manual edits, image opt-in/tag-only defaults and temporary cleanup remain intact.
This setting is a concurrency limit, **not a monthly spending cap**.

The approved configuration uses the existing `npm run build` and `npm run start`
on one Reserved VM, with the production one-job setting and unchanged
database/storage/secrets. Verify FFmpeg availability when publishing. Before publishing,
recheck deployment status so any previously unknown live deployment is not
replaced unintentionally. Do a short actual-VM upload/queue check and increase
capacity only if resource pressure, upload latency or decoder deadlines justify
it. The deployment target is prepared; no live hosting was changed at this stage.
