---
name: Vite module interception
description: Network mock matching for development entry modules with query parameters.
---

Use a trailing wildcard in browser network interception patterns for Vite modules.

**Why:** Vite may append cache-busting query parameters to module requests; a pattern ending at the module path missed the request and falsely exercised the success path.

**How to apply:** When simulating a broken module in browser tests, match both the module path and any query suffix, and disable the browser cache for the scenario.