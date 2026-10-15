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

**Verified transport bytes are not a registered asset.** Even verified or
provider-aborted checkpoints keep their reservation pinned in this preparation.
Do not manually delete journal rows as a cleanup procedure.

## Actual evidence

The newest journal suite passed **15 scenarios / 16 Node-reported tests**, with no
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

The unchanged provider transport (including the isolated 250-MiB case), R2/private
delivery, browser-client protocol, HTTP resumable and retained-capacity regression
suites also passed. TypeScript and the production bundle build passed.

The database tests deliberately stay within current application file policy.
The 250-MiB provider-engine fixture is **not** a 250-MiB application upload test.
There were no live bucket, connected database, paid AI or Production calls.
All fixtures were removed.

```sh
node scripts/test-image-downloads.mjs --enable-uploads \
  tests/r2-multipart-journal.test.mjs
```

`--enable-uploads` opens uploads only in that disposable runner's child process,
with its loopback database and test storage. It changes no workspace settings.

## Remaining before any activation

1. Atomic media/object registration and reservation handoff must verify the
   current owner, provider route, byte/version/hash identity and content/safety
   decisions before unpinning the journal. Reuse existing finalization and
   idempotent media/analysis admission; transport verification alone must not
   publish or trigger duplicate AI.
2. Make existing temporary-file/session cleanup native-journal aware **before**
   wiring any application endpoint. Current legacy cleanup does not honor the
   native lease before removing local staging; the reservation FK alone does
   not solve that source-file lifecycle issue.
3. Reconcile uncertain initiation/completion conservatively. No guessed provider
   IDs, broad cleanup, blind completion replay or capacity release.
4. Prepare authenticated HTTP/UI integration and end-to-end restart/cancel/error
   coverage without nested work-budget acquisition or changed product limits.
5. Obtain explicit approval before making this schema active/applying Development
   changes, running a connected Development smoke or opening upload gates.
   Production schema and publishing remain separately approved steps.

Normal upload routes do not import or use this journal. No new upload setting,
limit, subscription, RAW workflow or Creator-video permission was activated.
