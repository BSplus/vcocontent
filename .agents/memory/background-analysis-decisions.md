---
name: Background analysis decisions
description: Recognition quality limits, manual caption publishing, and shared-queue test isolation
---

Keep model/provider changes conditional on reviewed VCO quality results, not only latency or token savings. Structured observations can share the automatic tagging request, but captions remain an explicit user action, not automatic publication.

**Why:** A two-photo VCO pilot showed that combined structured extraction saved requests when both outputs were needed, but lost scene information; both vision approaches missed a visible number, and local OCR produced a false number. Tag-only token usage was almost unchanged by combining. This is not sufficient evidence for a production replacement.

**How to apply:** Keep number/class readability gates and unknown values conservative. Reuse observations for local reference corrections without another provider call. Extend the reviewed photo set before claiming broad recognition accuracy or changing providers; a generic Race Car label is safer than an unsupported specific class.

Do not choose a recognition prompt by aggregate pass count alone.

**Why:** A reviewed photo comparison improved subject-tag coverage while
introducing a false dashboard race number and an unsupported racing class.

**How to apply:** Compare safety regressions separately from tag omissions,
using fixed independently inspected expectations. Reject newly invented numbers
or classes even when the total number of passing samples increases. Explicit
obscuration flags are defensive hints, not proof that the model saw the full panel.

Explicit analysis requested from the media editor may extract structured entry details and match reference lists; automatic upload tagging must remain tag-only. Do not automatically generate or replace captions, and preserve manual entry corrections.

For videos, automatic structured recognition and reference matching are explicitly authorized. This is a video-only exception; automatic image tagging remains tag-only.

**Why:** The user's video brief requests automatic numbers/teams and listed-lineup matching without extra steps, while explicitly preserving the existing image defaults.

**How to apply:** Keep video evidence timestamped and bounded, reuse successful batches, and rematch references locally. Never interpret registered lineups as physical driver identities.

**Why:** The user authorized completing the manual recognition and reference controls, not replacing automatic tagging based on an unreviewed quality change.

**How to apply:** Keep manual recognition separate from automatic queue requests, including their cached results. A “Reanalyse” action must request a new generation explicitly; ordinary repeated requests may reuse completed work.

When merging queue changes, preserve the requested analysis mode of already persisted work; do not reinterpret old requests using a newly introduced default.

**Why:** Recognition work can outlive the code version that queued it. Switching the default for new uploads must not discard previously requested observations or turn reference-only corrections into another provider request.

**How to apply:** Keep legacy jobs compatible and retain local reference rematching alongside explicit manual recognition and new tag-only requests.

Run shared-database worker tests with exclusive queue consumers, serializing test files and pausing the preview worker.

**Why:** Parallel processes can claim another test's durable job, bypass that process's network mock, and consume shared provider slots. Failures then look like retry or lease bugs despite correct worker behavior.

**How to apply:** Keep focused worker verification isolated from the running app; do not weaken global concurrency or fencing to make process-local mocks pass.

For video validation, a dedicated human-annotated benchmark must not become a prerequisite. Use a small authorized existing clip selection and an ordinary compact editorial review table.

**Why:** The user explicitly prioritized pragmatic validation and a working, efficient video tagging system over a benchmark management system.

**How to apply:** Separate technical completion and provisional AI results from validated accuracy. Leave editorial verdicts pending, do not invent expectations, and withhold reference matches without verified event/session/season scope.
