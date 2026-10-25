---
name: Preview delivery backpressure
description: Why prepared thumbnail I/O and image conversion must retain separate capacity policies.
---

Keep prepared thumbnail delivery independent of the CPU conversion queue, with bounded read concurrency, bounded waiting and finite browser retries.

**Why:** A gallery burst reached the old ten-producer admission cap even when images already existed. Production returned temporary failures as 502 and native image elements never retried, leaving apparently missing previews. Increasing upload limits does not fix this.

**How to apply:** Do not remove overload protection or increase CPU conversion parallelism to solve preview delivery. Keep authorization and source-integrity checks before cache hits and validators; transient busy responses must not be cached as images. Retain running read ownership until completion.
