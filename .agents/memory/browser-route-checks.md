---
name: Browser route checks
description: Why route-authorization smoke checks should distinguish navigation from unrelated data-loading failures
---

When testing login redirects or role boundaries in a browser, assert the final route separately from the destination page's data-loading state. A background API request started on an earlier page can complete after navigation, and an out-of-sync development database can break destination data without breaking routing.

**Why:** Multiple route checks initially appeared to fail for different reasons because media queries depended on a development schema column not yet present. Network failures from previous pages also arrived during subsequent visits.

**How to apply:** Preserve independent API/data checks where relevant. For route-only checks, establish the destination path and role behavior first; if a known schema mismatch exists, scope any exception precisely and only while that mismatch is confirmed.

Chromium can cancel an intercepted request during navigation before the mock fulfills it, producing `Fetch.fulfillRequest: Invalid InterceptionId`.

**Why:** This occurred in multiple navigation-heavy browser checks even though their interaction assertions passed; an invalid interception ID describes a canceled browser request, not an application failure.

**How to apply:** Ignore only this specific cancellation in interception handlers. Continue reporting all other mock errors and runtime exceptions; do not broadly suppress network failures.

Separate synthetic-fixture browser checks from server-rendered public metadata and preview-proxy startup problems.

**Why:** Repeated full navigations to synthetic event/media IDs intermittently stalled before the app loaded through the preview domain, while the same checks passed against the running server directly. Synthetic IDs also do not exist for the server's public-page lookup.

**How to apply:** Enter through a real public route, then use client navigation and reset query state for synthetic fixtures. If proxy startup prevents testing, diagnose with a direct browser connection to the running server and retain a separate screenshot check of real public routes; do not bypass authentication.

Full navigation, especially to the same URL, must be distinguished from the old document before testing readiness.

**Why:** A navigation command can return while the previous DOM still satisfies a readiness selector. Later assertions then run in the replacement document before startup visibility is released, producing empty text or misleading image timings.

**How to apply:** Mark the old window before navigation and wait for its replacement plus feature readiness. For visible-image timing, wait for startup release and actual viewport intersection, not merely image decoding. Use a fixed observation window for request/byte comparisons.