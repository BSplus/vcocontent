---
name: Browser role assertions
description: How to avoid premature role-based navigation assertions in browser smoke tests.
---

For role-based browser tests, waiting for a page title or path is not sufficient before checking authenticated navigation; wait for the role-dependent element or a settled auth state.

**Why:** Public page content can render before the asynchronous user query finishes, so an approved user's Creator link may be temporarily absent even though access is correct.

**How to apply:** When testing navigation after setting a session cookie, poll for the expected role-specific UI separately from the page's static content.