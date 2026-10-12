---
name: Performance measurement boundary
description: How to interpret local archive timings without overpromising deployment capacity
---

Treat disposable local database timings as comparative evidence, not as a
promise about published VM capacity. Keep heavy tests/builds out of timed phases
and compare both versions on the same corpus and running database.

**Why:** Cache state and unrelated application/CPU activity can change concurrent
request percentiles much more than isolated SQL execution times. A fast query
plan alone does not prove low end-to-end latency on the deployed host.

**How to apply:** Report plan changes, exact-result equivalence, isolated SQL
times and concurrent endpoint latencies separately. Real deployment load checks
and index rollout require their own production approval.
