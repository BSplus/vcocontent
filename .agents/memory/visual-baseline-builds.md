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
