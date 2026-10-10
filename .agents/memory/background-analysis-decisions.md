---
name: Background analysis decisions
description: Recognition quality limits, manual caption publishing, and shared-queue test isolation
---

Keep model/provider changes conditional on reviewed VCO quality results, not only latency or token savings. Structured observations can share the automatic tagging request, but captions remain an explicit user action, not automatic publication.

**Why:** A two-photo VCO pilot showed that combined structured extraction saved requests when both outputs were needed, but lost scene information; both vision approaches missed a visible number, and local OCR produced a false number. Tag-only token usage was almost unchanged by combining. This is not sufficient evidence for a production replacement.

**How to apply:** Keep number/class readability gates and unknown values conservative. Reuse observations for local reference corrections without another provider call. Extend the reviewed photo set before claiming broad recognition accuracy or changing providers; a generic Race Car label is safer than an unsupported specific class.

Run shared-database worker tests with exclusive queue consumers, serializing test files and pausing the preview worker.

**Why:** Parallel processes can claim another test's durable job, bypass that process's network mock, and consume shared provider slots. Failures then look like retry or lease bugs despite correct worker behavior.

**How to apply:** Keep focused worker verification isolated from the running app; do not weaken global concurrency or fencing to make process-local mocks pass.
