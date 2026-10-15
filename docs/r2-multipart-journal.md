# Durable native multipart journal — prepared, not activated

15 October 2026. Continuation of P2-5 in the unified marketplace specification.

## Delivered in this package

`server/r2-multipart-journal.ts` supplies a real PostgreSQL implementation of the
prepared provider engine's journal contract, plus fresh authorization callbacks.
It reuses the existing upload session and media reservation rather than creating
a second storage balance.

- Dedicated PostgreSQL **session** advisory locks exclude competing sessions and
  destination writers across application connections. No long SQL transaction
  wraps R2 network work: checkpoints commit independently before provider writes.
- Session identity, actor, gallery, owner classification, server-created request
  fingerprint, MIME, size, SHA-256, destination and expiry must match persisted
  records. The owner revision is the session request fingerprint, **not** a new
  ownership-transfer epoch. Ownership transfer with in-flight uploads remains
  disallowed; no transfer feature was introduced.
- Existing Creator approval, suspension, management rights, current file limits,
  premium prohibition and Creator-video prohibition remain enforced.
- Upload progress checks current capacity, including held reservations, against
  the persisted gallery's owner. Admin uploads into Creator galleries do not
  become official storage. A narrowly opt-in ownership-accounting argument also
  prevents an admin-owned Creator gallery bypassing its quota; existing beta
  callers retain their current policy.
- Read/recovery and provider cancellation do not require open upload gates.
  Read-only inspection/cancellation with no write intent creates no journal row.
- Checkpoint compare-and-swap and immutable-header predicates fence stale writers;
  illegal phase rollback and receipt rewriting are rejected.
- Loss of the leased database connection aborts the worker's signal. Session
  locks are never returned to an idle connection pool: the connection is destroyed
  on exit. A two-connection worker pool uses the same captured, verified runtime
  database connection configuration as the application pool.
- Client query/connect deadlines and server statement/lock timeouts bound waiting.
  A heartbeat detects an interrupted lease. SQL/provider identifiers, connection
  strings and checkpoint contents are not included in public errors.

## Schema intentionally inactive

The new declaration is in **`shared/r2-multipart-schema.ts`**, not the active
`shared/schema.ts` entry point. It is not discovered by the existing schema-push
runner, is not created at startup and was not applied to connected Development
or Production.

The prepared additive table has one row per session, a unique provider
scope/destination, an immutable binding, revision counter and JSON checkpoint.
Restrictive foreign keys pin both the existing session and its reservation.
This prevents ordinary abandonment from deleting the reservation and freeing
quota while the provider outcome is uncertain. Failed abandonment rolls back
its attempted cleanup-accounting changes too.

**Verified transport bytes are not a registered asset.** Verified or
provider-aborted checkpoints keep their reservation pinned until the private
lifecycle repository confirms registration or completed staging cleanup.
Do not manually delete journal rows as a cleanup procedure.

## Atomic asset handoff and staging lifecycle

`server/r2-multipart-lifecycle.ts` is prepared, **not imported by upload routes**:

- `registerValidatedMultipart` consumes server-trusted output of the existing
  content/derivative validation pipeline, not browser metadata. Transport
  verification is not image/container validation or a safety decision.
- Existing `finishMedia` performs one transaction. Its optional internal
  pre-release hook checks the current actor/gallery/session and the verified
  source hash, size, MIME and object version, plus the reserved thumbnail route
  and actual distinct byte/object totals. Unknown or conflicting routes fail.
- The same transaction removes the restrictive journal, removes the reservation,
  links physical asset objects/variants, checks final Creator usage, admits the
  existing analysis job once, and completes the session. Asset linking accepts
  the existing transaction instead of opening a nested independent transaction.
  Creator safety remains pending under existing policy; no safety is bypassed.
- A minimal server-only receipt in the existing session metadata replaces the
  journal atomically. Lost commit responses and concurrent retries return that
  same media item; they do not create another asset/job or require open gates.
  Deleted media cannot be recreated by replaying its receipt.
- Actual bytes replace reserved bytes without counting both during final
  capacity enforcement. Original and generated thumbnail physical objects are
  counted once, under persisted gallery ownership.
- `cleanupMultipartStaging` takes the same cross-connection session/key lease.
  Registered receipts permit only local staging cleanup. Held reservations are
  released only after a known abort, another provider multipart/destination
  absence check and confirmed local directory removal. Unknown initiation or
  completion never permits source removal or release.
- Native adapters must keep **all parts and assembled native sources** under the
  fixed UUID session directory supplied by `upload-session-staging.ts`; no
  arbitrary cleanup path is accepted. An adapter must close source readers before
  cleanup. The native engine finishes before registration/cleanup is called.
- Legacy expiry selection excludes native journals and terminal receipts before
  its batch limit. Discard/expiry recheck the fence under reservation/session
  locks. Initial authorization and journal insertion hold those same row locks
  through one short transaction, closing the pre-insertion cleanup race.

### Validated JPEG preparation bridge

`server/r2-multipart-jpeg.ts` now connects actual JPEG validation/preview
preparation to this private lifecycle. It uses the existing `preparePhoto`,
byte/pixel policy and processing budget, preserves source bytes/checksum and
orientation metadata, and stages an auto-oriented, metadata-stripped WebP under
the existing 640-pixel/100,000-byte preview ceilings. Current Creator/official
limits are not raised. Source paths must resolve inside the owned UUID staging
directory, and source keys must preserve the established official/Creator
provenance conventions used by private delivery. Registration enforces those
JPEG key conventions too.

An explicit preparation fence pins staging before decoding. Its **NULL
checkpoint is not an initiating provider intent**: preparation performs no
storage write or AI call. It must finish/release its processing slot and lease
before transport opens a fresh context, avoiding nested work-budget acquisition.
Preview installation is atomic and cannot overwrite an existing differing
preview. Source hashes and existing previews are checked on retry.

Known no-write preparation can be cancelled with closed write gates: the
repository requires a matching NULL fence, no original/thumbnail route indicating
any persistence attempt, and confirmed absence of the source destination before
removing staging and atomically releasing the reservation. Missing rows or an
initiating checkpoint are **not** interchangeable with this positive no-write
proof. Any conflicting route or uncertain provider result retains capacity.

**Current integration update:** the bridge's source/thumbnail descriptors now
feed the existing authenticated finalizer behind disabled Development-only
gates. Mode selection, assembly, ordinary thumbnail persistence, registration,
safety/AI dispatch and native status/recovery are covered by disposable HTTP
tests. See `docs/native-jpeg-intake.md`; interactive acceptance and ordinary
physical-inventory deletion remain activation blockers.

These helpers neither implement content parsing nor dispatch paid AI/safety
calls independently; JPEG preparation reuses the existing photo parser.
The intake adapter reuses those existing workflows, validated
derivatives and policy decisions, and must not run a legacy and native finalizer
for the same session.

## Actual evidence

The newest journal suite passed **34 scenarios / 35 Node-reported tests**, with no
failures or skips. It used a newly initialized, disposable loopback PostgreSQL
database and synthetic R2 commands backed by temporary disk files:

1. Verified transfer and fresh-context replay preserve one reservation.
2. Separate connections exclude both same-session and same-destination writers.
3. A real child process is SIGKILLed after a committed intent but before lease
   cleanup; a new context observes the intent and never duplicates initiation.
4. Lost initiation responses retain capacity; legacy abandonment is blocked.
5. Lost part responses resume from database state without retransmission.
6. Lost completion recovers without local bytes or open upload gates.
7. Known provider abort succeeds with closed gates; staging capacity stays held.
8. Changed ownership, actor and server request revision fail closed.
9. Admin-to-Creator and admin-owned Creator capacity checks cannot bypass quota.
10. Closed gates create no intent; no-intent cancellation is read-only.
11. Current image limits, Creator video denial and official admin video coexist.
12. Stale checkpoint revisions and illegal rollback are rejected.
13. Changing immutable journal bindings fences an already-running writer.
14. A deliberately stalled SQL insert fails around five seconds without issuing
    any provider write, rather than waiting for the complete stalled statement.
15. Terminating the PostgreSQL lease aborts the worker; saved intent remains.
16. Atomic registration preserves creator text, transfers usage once and permits
    terminal replay/cleanup with closed gates without another analysis job.
17. Original/thumbnail relationships and actual byte accounting are committed.
18. Failure after journal removal rolls back media, route and reservation changes.
19. A lost database completion reply recovers one committed asset/job.
20. Invalid source identities or byte totals retain the verified reservation.
21. Known abort removes actual source staging before releasing capacity.
22. Unknown initiation cannot remove source staging or release capacity.
23. Legacy expiry preserves native staging/reservations.
24. Native terminal receipts remain protected after the journal is removed.
25. An intentionally delayed first insert races real expiry cleanup; cleanup
    waits on the reservation/session locks and then honors the committed fence.
26. Concurrent registration cannot duplicate media or analysis jobs.
27. Missing generated derivatives prevent registration without freeing capacity.
28–29. Actual Creator and official JPEGs preserve source bytes, auto-orient the
       stripped preview, reuse validation and progress from a preparation fence
       through transport/atomic registration. Synthetic storage supplies the
       thumbnail's verified route; this is not a live-thumbnail upload smoke.
30. Malformed JPEG has no provider writes and its known no-write fence cleans.
31. Changed source hash or differing immutable preview cannot pass preparation.
32. Closed gates and non-owned source paths cannot start preparation.
33. A persistence-route conflict prevents no-write cleanup/capacity release.
34. JPEG preparation never retries an uncertain provider initiation.

The final affected runs cover **56 passing tests**: 35 journal/JPEG tests and
21 existing HTTP resumable/retained-capacity checks. After correcting the
fixture's official actor and preserving explicitly requested collision keys,
the full 35-test journal run passed with no failures/skips; the unchanged
21 regression checks had passed in the preceding batch. The earlier unchanged
provider transport (including the isolated 250-MiB
case), R2/private delivery and browser-client protocol checks also passed.
TypeScript and the production bundle build passed.

The database tests deliberately stay within current application file policy.
The 250-MiB provider-engine fixture is **not** a 250-MiB application upload test.
There were no live bucket, connected database, paid AI or Production calls.
All fixtures were removed.

```sh
node scripts/test-image-downloads.mjs --enable-uploads \
  tests/r2-multipart-journal.test.mjs tests/resumable-uploads.test.mjs \
  tests/retained-storage-capacity.test.mjs
```

`--enable-uploads` opens uploads only in that disposable runner's child process,
with its loopback database and test storage. It changes no workspace settings.

## Earlier integration checklist

The list below predates the gated HTTP adapter. Current activation blockers,
including native-aware deletion, are in `docs/native-jpeg-intake.md`.

1. Integrate validated, original-preserving intake and derivatives, independent
   safety and existing AI dispatch with the prepared private registration
   boundary. Codec/metadata correctness is not proven by opaque transport files.
2. Reconcile uncertain initiation/completion conservatively. No guessed provider
   IDs, broad cleanup, blind completion replay or capacity release.
3. Prepare authenticated HTTP/UI integration and end-to-end restart/cancel/error
   coverage, native staging ownership and maintenance cleanup dispatch without
   nested work-budget acquisition or changed product limits.
4. Obtain explicit approval before making this schema active/applying Development
   changes, running a connected Development smoke or opening upload gates.
   Production schema and publishing remain separately approved steps.

Normal upload routes do not import or use this journal. No new upload setting,
limit, subscription, RAW workflow or Creator-video permission was activated.
