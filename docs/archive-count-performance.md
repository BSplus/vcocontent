# Large-archive count measurements

## Boundary and reproduction

All writes and index builds in this measurement use a disposable, loopback-only
PostgreSQL database. No connected development or production database is seeded,
migrated or queried by the benchmark. No original media files are opened.

```sh
VCO_ARCHIVE_BENCHMARK=1 node scripts/test-image-downloads.mjs tests/archive-counts-benchmark.test.mjs
```

Default corpus: 500,000 media records, 2,000 events, 10,000 users, 500,000
favorites, 500,000 download records and approximately 200,000 follow relations.
There are two 25,000-item galleries (official and creator), skewed account
collections, videos, premium content, draft/hidden events, suspended/rejected
creators, pending safety reviews and stale approved versions.

Each scenario captures the actual API's COUNT SQL and bind values, inspects
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, warms the endpoint and measures three
rounds of eight concurrent requests. Before and after phases share the same
database, corpus, transport and application. The before phase drops only the
five new indexes and removes only the redundant JSON prefilter. It retains a
typed, always-true parameter expression so the original placeholder numbering
still works. Total counts, page metadata and ordered page IDs must match after
the migration. Account following also records its page query's per-creator
follower counts.

The full SQL, plans, index sizes and measurements are saved to the ignored file
`generated-artifacts/archive-counts-benchmark.json`. Logs and build output also
remain in `generated-artifacts/`, not in Git or deployments.

These are local synthetic measurements, not published-VM capacity guarantees.
Wall-clock thresholds are deliberately not ordinary test assertions. Do not run
other CPU-heavy tests/builds during the timed phases. Short and very broad
substring searches still require examining many accessible records to return
exact totals; no approximate counts, time-based truncation or cross-user caches
were introduced.

## Recorded result (12 October 2026)

Milliseconds; `p95` is the complete warm HTTP request at eight concurrent
requests, not just SQL. Each count has identical before/after totals and page
contents. Following lists both the top-level count and its page/follower query.

| Scenario | COUNT before → after | HTTP p95 before → after |
| --- | ---: | ---: |
| Unfiltered search | 290.6 → 184.9 | 318 → 186 |
| Selective search, all fields | 787.5 → 638.1 | 1136 → 885 |
| Caption | 57.8 → 2.0 | 247 → 52 |
| Photographer | 51.8 → 1.6 | 259 → 48 |
| Tags | 88.7 → 65.7 | 553 → 534 |
| Selective identification | 630.5 → 6.6 | 1008 → 53 |
| Broad search (`racing`) | 420.3 → 572.6 | 523 → 625 |
| Broad identification (`Porsche`) | 919.7 → 853.8 | 876 → 983 |
| Short search (`91`) | 938.4 → 983.4 | 1051 → 1031 |
| Multiple words, image filter | 734.5 → 640.9 | 1055 → 1492 |
| Escaped caption literal | 45.8 → 1.6 | 228 → 42 |
| Official public event | 105.4 → 7.0 | 244 → 32 |
| Creator public event | 110.1 → 9.4 | 253 → 45 |
| Managed event | 3.2 → 3.1 | 26 → 24 |
| Managed event, page 50 | 3.9 → 3.1 | 34 → 36 |
| Official thumbnails | 248.8 → 3.4 | 354 → 48 |
| Official thumbnails, page 50 | 235.3 → 3.3 | 371 → 70 |
| Creator thumbnails, page 50 | 122.7 → 0.7 | 483 → 36 |
| Photo matching | 91.4 → 4.3 | 255 → 36 |
| Favorites | 215.9 → 148.9 | 275 → 208 |
| Favorites, page 50 | 213.5 → 144.4 | 280 → 191 |
| Downloads | 243.7 → 163.1 | 305 → 195 |
| Following | 2.5 / 8.1 → 2.3 / 8.0 | 45 → 29 |

The five indexes occupied 139,395,072 bytes (~133 MiB) and took 22.9 seconds to
build concurrently in the disposable database. This is additional storage and
write maintenance, not a free speedup. The selective caption/identification
plans use their GIN bitmap scans. Public event, thumbnail and photo-matching
COUNT plans use index-only scans with **zero heap fetches** after vacuum.

Not every scenario improves: broad and combined tag-containing searches retain
large scans, and a lower standalone COUNT time does not guarantee a better
concurrent page latency. The multi-word case is the clearest remaining limit.
No latency SLO or deployment-capacity conclusion is inferred from these local
measurements.

Verification: 25 focused regression tests passed, the large-archive benchmark
passed all 23 scenario comparisons, TypeScript and production build passed.
The public search page also rendered correct empty-result pagination in the
preview without requiring the optional indexes.

## Changes supported by the plans

- Caption and photographer substring searches previously scanned the archive.
  Standard `pg_trgm` GIN indexes allow selective bitmap scans.
- Identification searches previously expanded JSON for almost every candidate.
  The new GIN index covers serialized identification JSON. A redundant
  prefilter reduces expansion for selective terms; the original whitelisted
  field `EXISTS` remains authoritative. Hints, provenance and unknown fields
  cannot become results merely because they occur in indexed JSON.
- JSON escaping can hide quote/backslash/control-character literals in
  serialized JSON. Those terms bypass the prefilter. Sub-three-character terms
  bypass it too: no selective trigram path justified the serialization cost.
- Broad identification terms also bypass it. A read-only `EXPLAIN`, without
  `ANALYZE`, checks whether PostgreSQL would actually select the identification
  search index. Only this planner decision is cached (256 terms, two minutes,
  shared in-flight probes); counts, rows and access decisions are never cached.
  This avoids double JSON work for broad terms and works on databases where the
  optional indexes have not yet been approved/applied.
- Event and photo-matching counts previously fetched widely scattered heap
  rows. A covering metadata B-tree allows index-only counting.
- Thumbnail counts previously read thumbnails and evaluated the same regular
  expressions repeatedly. A partial, covering index applies the existing
  bounded-thumbnail predicate at write time. Neither originals nor thumbnail
  bytes are B-tree keys; historical inline thumbnails are preserved.
- Existing account-user and follow indexes are retained. No additional account
  index is justified merely because a large accessible account requires many
  joins. Filters, roles, safety policy, sorting and page sizes are unchanged.

## Optional index rollout — NOT performed on connected databases

The query changes work without the new indexes. Their full acceleration requires
an approved index rollout:

1. Obtain separate production approval and inspect the actual database, archive
   distribution, available disk, extension permissions and write load.
2. Apply `migrations/0006-media-search-indexes.sql` with a SQL-aware client,
   outside a transaction. Do **not** split SQL on semicolons: a thumbnail regular
   expression contains a literal semicolon.
3. `CREATE INDEX CONCURRENTLY` avoids blocking gallery writes during the build.
   It still uses disk/CPU and can wait for old transactions. If interrupted,
   inspect `pg_index.indisvalid`; `IF NOT EXISTS` does not repair an invalid
   leftover index. Obtain approval before removing any existing index.
4. Run approved `ANALYZE`/read-only plan checks and compare counts and latencies
   under the actual deployment's load. Index-only scans depend on visibility-map
   coverage; recently modified galleries may still need heap visits.

The migration is additive, is not part of server startup, build, or automatic
post-merge schema setup, and does not replace the existing page index. `pg_trgm`
must be present before schema pushes that include these GIN indexes; the
disposable test runner provisions it only in its local database.

The thumbnail partial-index bound must stay consistent with
`shared/media-query-policy.ts` and `eventImagePolicy`; a future policy change
requires a reviewed index rebuild as well as the query change.

## Regression verification

```sh
node scripts/test-image-downloads.mjs \
  tests/archive-search-equivalence.test.mjs tests/media-search-plan.test.mjs tests/pagination-api.test.mjs \
  tests/media-search-api.test.mjs tests/event-gallery-thumbnails.test.mjs \
  tests/event-thumbnails.test.mjs
npm run check
npm run build
```

The differential test compares the exact legacy SQL against the new counts and
bounded pages over every field-selection combination. It includes empty and
unusual legacy JSON, Unicode, quote/backslash/control characters, literal
`%`/`_`, multiple words, ignored identification hints, premium exclusions and
image/video filters. Existing pagination tests cover permission/safety
boundaries, exact full and empty pages, stale positions and photo-matching
cursor invalidation.
