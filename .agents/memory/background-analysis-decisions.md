---
name: Background analysis decisions
description: Why tag extraction remains separate from caption detection, and how to isolate shared-queue tests
---

Keep a provider/prompt change conditional on reviewed VCO quality results, not only latency or token savings. Do not automatically extract or publish race-number captions on every upload.

**Why:** A two-photo VCO pilot showed that combined structured extraction saved requests when both outputs were needed, but lost scene information; both vision approaches missed a visible number, and local OCR produced a false number. Tag-only token usage was almost unchanged by combining. This is not sufficient evidence for a production replacement.

**How to apply:** Extend the reviewed photo set and compare number-specific input resolution/cropping and car-type coverage before adopting combined extraction or another provider.

Run shared-database worker tests with exclusive queue consumers, serializing test files and pausing the preview worker.

**Why:** Parallel processes can claim another test's durable job, bypass that process's network mock, and consume shared provider slots. Failures then look like retry or lease bugs despite correct worker behavior.

**How to apply:** Keep focused worker verification isolated from the running app; do not weaken global concurrency or fencing to make process-local mocks pass.
