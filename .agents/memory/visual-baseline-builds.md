---
name: Visual baseline builds
description: Making isolated before/after frontend builds comparable.
---

Isolated screenshot baselines must include the original CSS build configuration
and serve the same assets, not just copy the React sources and Vite configuration.

**Why:** Vite can successfully build a snapshot without the project's Tailwind/
PostCSS configuration, while the resulting layout is different and even causes
mobile viewport expansion. Missing static images also invalidate pixel comparisons.

**How to apply:** For before/after comparisons, preserve the frontend toolchain,
fixtures, fonts and asset serving. Measure the CSS viewport as well as image
dimensions before interpreting differences.

Isolated integration baselines also need the runtime assets used by mocked
workflows, not only the modules under test.

**Why:** A copied baseline without the branded email logo failed registration
fixtures before reaching the storage assertions, falsely suggesting unrelated
authentication regressions. Successful mocked delivery still renders real
template assets.

**How to apply:** Include the same runtime asset files when comparing untouched
baseline suites. Diagnose setup failures separately from failures of the target
assertions; do not treat an incomplete snapshot as baseline evidence.
