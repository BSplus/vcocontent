# Native-upload diagnostics — read-only Development preparation

## Location and scope

Admin → Media Management → Native-upload diagnostics.
The existing active-admin middleware protects
`GET /api/admin/native-upload-diagnostics`; unauthenticated, non-admin and
suspended-admin requests are rejected.

This is an aggregate diagnostic sample, not an object-store inventory, proof of
provider integrity or release-readiness report. No public/Creator diagnostics,
new authorization system, DDL, migration or activation is introduced.

## Safety and cost

- Outside explicit `MEDIA_STORAGE_ENVIRONMENT=development`, return
  `not_development` without inspecting the sessions or provider.
- Check the existing optional schema without creating it. Missing tables return
  `schema_unavailable`, not a misleading zero-backlog success.
- Run SELECTs in a read-only transaction; each statement has a two-second limit
  and locks have a 500 ms wait limit. Use dedicated connections to the already
  verified runtime database, not the application or multipart lease queues.
- Admit one diagnostics operation per process without a waiting queue.
  A 6.5-second client deadline or browser disconnect destroys the acquired
  diagnostic connection; late acquired connections are destroyed without SQL.
  Existing dedicated-pool limits also bound connection acquisition and individual
  queries to five seconds. No global database timeout/pool policy is changed.
- A timed-out acquisition/query retains its admission until the underlying
  promise settles. Repeated refreshes get a sanitized 503 rather than accumulating
  connections. If transport never settles, diagnostics remain unavailable in that
  process instead of manufacturing new work; this is not an automatic reconnect
  or cross-instance coordination guarantee. Deadlines assume a responsive Node
  event loop and are not hard real-time resource guarantees.
- Sample at most 200 oldest uncleaned native JPEG sessions, reading one extra
  row only to indicate truncation. Do not label this sample as system totals.
- The sample covers receiving, finalizing and completed-awaiting-cleanup states.
  Held, expired and retry/due counts overlap those states.
- Sum only sampled reservations, using integer arithmetic and a decimal string
  at the API boundary. Reservations are not measured remote storage usage.
- Allowlist reason labels. Unknown values become `other`; no raw provider errors,
  session/actor IDs, object keys, filenames, captions, credits, email addresses,
  tokens or credentials are returned or logged by this feature.
- No bucket access, publication, recovery invocation, retry/unhold button,
  quota release or deletion. Existing maintenance behavior is unchanged.
- Send `Cache-Control: no-store`. Query failures return a sanitized 503.
- The UI reads only while Media Management is active, has no polling/focus
  refresh, no automatic transport/query retries, and an eight-second request
  deadline. Manual refresh performs one GET. After a refresh error, hide cached
  success data rather than representing it as current.
- Configuration flags are not readiness checks. A disabled native flag does
  not hide existing Development backlog. A closed upload gate still stays closed.

## Operator interpretation

Held integrity/ownership/permission conflicts and unknown initiation/expired
ambiguity require investigation; this screen cannot resolve or safely discard
them. An expired session does not prove that remote bytes are absent.

Retry-scheduled and due counts describe recorded eligibility, not guaranteed
execution. Active finalizers, gates, admission limits and leases can delay work.
Inspect the sampled timestamp and truncation notice before drawing conclusions.

Broader cross-object integrity inventory, per-case investigation, reviewed
resolution procedures, real-provider/restart/stall/resource acceptance and
RAW/video integration remain separate specification work. Nothing here authorizes
Production inspection, schema changes or upload activation.

## Verification

```sh
npm run check
npm run build
node scripts/test-image-downloads.mjs --enable-uploads tests/native-jpeg-intake.test.mjs
node --import tsx --test --test-concurrency=1 tests/native-upload-diagnostics-ui.test.mjs
node --import tsx --test tests/native-diagnostic-read.test.mjs
node scripts/test-image-downloads.mjs --enable-uploads \
  tests/native-diagnostic-read-network.test.mjs tests/native-jpeg-intake.test.mjs
```

HTTP/DB cases use disposable loopback PostgreSQL and synthetic storage only.
Browser cases intercept every API before navigation and reject unexpected
writes, covering the real admin component at 390 px touch and 1280 px desktop.
They are not signed-in acceptance against a connected account/provider or proof
of Safari/device behavior.

Verified on 16 October 2026: **46 native HTTP/DB checks and two browser cases
passed, with zero failures/skips**. TypeScript and the production build passed.
The workflow restarted cleanly; mobile/desktop synthetic-admin screenshots and
the public homepage were visually checked. Production, connected schemas,
storage credentials and upload flags were not changed.

The bounded-read acceptance extension covers synthetic never-settling/late acquisitions,
lost replies, disconnects, connection errors and burst rejection; a loopback
WebSocket/PostgreSQL proxy exercises silent startup and suppressed query replies.
It does not make claims about a real provider/network or whole-upload-worker
resource acceptance.

This extension passed **seven reader tests plus 50 combined network/native
HTTP/DB checks, zero failures/skips** on 16 October 2026. TypeScript, production
build, restart and public-page rendering passed. The loopback checks confirmed
silent-startup admission stays bounded, dropped SELECT replies destroy their
dedicated socket, a later request recovers, and PostgreSQL enforces the two-second
statement limit and rejects DDL inside the read-only transaction.
No frontend changes were needed; the previously passed synthetic mobile/desktop
panel tests were not repeated. A connected signed-in UI was not verified.
