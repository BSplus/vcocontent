---
name: Fontsource export paths
description: Fontsource font packages can expose different CSS import paths despite matching versions.
---

Do not assume all Fontsource packages accept the same CSS import suffix. Check each package's export map when a stylesheet exists on disk but the production build cannot resolve it.

**Why:** Big Shoulders Display 5.3 exposes a wildcard that appends `.css`, while IBM Plex Sans Condensed accepts explicit `.css` imports. Using the same import format for both caused a production-build failure.

**How to apply:** When adding or updating local fonts, verify the production build as well as the development preview; choose the import path supported by that package's current export map.
