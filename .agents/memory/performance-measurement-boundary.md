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

Thumbnail comparisons must report the first visible image and the complete
visible row separately, and distinguish a sudden jump to a distant row from
approaching it by scrolling.

**Why:** Native lazy loading of just one distant poster can make the old first
image look faster even when bounded look-ahead and byte reuse finish the whole
row sooner. Eliminating broad speculative loading has measurable counterexamples;
an earlier request alone is not evidence of earlier displayed content.

**How to apply:** Keep counterexamples, additional preload bytes, browser/server
cache state and fresh provider-metadata costs in the report. Never describe a
whole-page earliest image request as the request start of a particular target row.
