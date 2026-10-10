# Continuous media analysis: development validation and hosting choice

## Approved scope and operational recommendation

After reviewing the development results, the operator approved implementing the
recommended single-VM configuration. The `.replit` deployment target is now `vm`,
with the existing `npm run build` / `npm run start` commands. Following explicit
preparation approval, `MEDIA_ANALYSIS_CONCURRENCY=1` is configured in both
production and development so consumers use the same queue limit.
No additional service was created or published.
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
Following preparation approval, both production and development environments
have the one-job setting. All processes connected to the same queue must use the
same setting.

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

## Actual-VM acceptance remains pending

Preparation approval is not restart approval. Following the operator's publishing
confirmation, the deployment check on 10 October 2026 reported an active private
Reserved VM with a successful build. Startup logs confirm the server listening
on port 5000 after initial startup health-check failures. Deployment metadata does
not expose machine capacity, so 0.5 vCPU / 2 GiB still needs confirmation from
Publishing settings. An unauthenticated live request redirects to Replit sign-in.
The read-only production queue summary returned no analysis jobs; there is no
live persisted-batch or idle-processing evidence yet. Secure external access and
an authorized Creator test account are needed for real live upload checks.
Do not treat the development-only harness as a production validation tool.

The operator subsequently approved a one-time check with one small image and
video, upload timing, background completion during a request-free interval, and
cleanup of only the check's content. They explicitly prohibited production
restarts, configuration/privacy/authentication changes, changes to existing user
content, load testing and additional operations without approval.

The replacement Production access token reached the application, but application
login returned HTTP 401 with invalid credentials. No uploads, provider calls or
cleanup mutations were performed. An explicitly authorized read-only account
check confirmed production contains users and approved Creators. A credential-free
username-match check found that the supplied test username corresponds to an
administrator, not the intended restricted Creator test identity. Do not use
that account for validation, reset it or change its roles without separate
authorization. A working restricted production Creator test account remains
required; no passwords or password hashes were read for this check.

After the operator reported the replacement account ready, application login
succeeded (HTTP 200, session issued). The replacement identity is not an
administrator, but has neither the Creator role nor approved Creator status.
Under its current permissions the upload check remains blocked. No test event,
media upload, provider request, restart or production-settings change was made.
Creator approval must be supplied separately; validation must not grant itself
additional privileges.

After user-initiated publishing:

- Confirm the live deployment is a healthy Reserved VM and verify its selected
  capacity, concurrency setting and FFmpeg availability.
- Use a small authorized photo/video upload sample through the real live routes;
  confirm uploads remain responsive and analysis completes while no visitor
  traffic is keeping the website active.
- Observe the VM's CPU and memory during that sample; record actual measurements,
  not the development half-core approximation.
- Obtain explicit approval for a brief live-site interruption before testing
  restart recovery. Confirm a successful video batch has been persisted before
  restarting, then verify recovery after lease expiry and reuse of that saved
  batch without another provider request for its frames.
- Preserve existing user data; remove only disposable check fixtures after the
  operator approves cleanup. Record evidence and limitations here.

## Authorized one-time live check — 10 October 2026

After Creator approval, the restricted test account logged in successfully with
no administrator rights. Exactly one disposable event, one resized authorized
photo and one 1.8-second test video were created via the real published routes.
The check made no production configuration, visibility, authentication or
existing-content changes and did not restart production.

| Observation | Actual result |
|---|---|
| Image upload, 72,479 bytes | HTTP 201 in 1.679 seconds |
| Image background analysis | Completed on attempt 1; server-reported duration 1.028 seconds, five generated tags |
| Video upload, 75,506 bytes; 640×360, 5 fps | HTTP 201 in 3.141 seconds |
| Video background analysis | Running before the quiet interval; failed after three automatic attempts; last-attempt duration 8.110 seconds |
| Test-client quiet interval | 90.031 seconds, zero application requests from this client |
| Manual test tags | Preserved on both media items |
| Cleanup | Own test event deletion returned HTTP 200; event and both media-status endpoints then returned HTTP 404 |
| Read-only cleanup confirmation | Zero remaining test event/media/job rows and zero pending cleanup entries for the four test object keys |

The raw credential-free measurement report and one-time runner are under the
ignored `generated-artifacts/` directory. Session cookies and credentials were
kept in process memory only. Local fixture files were removed.

### Conclusion and limits

The live image path and asynchronous processing worked. The worker continued
attempting the video during the test client's request-free interval, but the
video did **not** complete successfully. No manual retry, second upload sample
or additional analysis was requested. The normal worker performed its own three
automatic attempts. Provider token/cost counts were not captured before cleanup;
do not infer that failed video attempts were unbilled.

The targeted deployment-log check did not expose the video failure cause.
The last-attempt duration alone does not establish a decoder timeout or a
provider failure. Diagnose before proposing a fix or larger machine.

This was not a load test. Client upload timings include network/response time;
the sample is too small to establish throughput or capacity. Other visitors
were not controlled, so the quiet interval means no requests from this test
client, not proof of globally idle HTTP traffic. Machine capacity and live
CPU/RAM metrics were not available through the accessed tools. FFmpeg-dependent
video upload succeeded, but full video analysis compatibility remains unproven.

Production restart recovery and reuse of saved successful video batches were
not tested because the operator explicitly prohibited a restart. Development
recovery evidence does not substitute for this missing live check.

**Continuous, reliable video analysis on the actual small VM is not confirmed.**
Further live diagnostics, resource checks, restart tests or retests require
separate operator approval. Revoke the temporary external access token after
the one-time check.
