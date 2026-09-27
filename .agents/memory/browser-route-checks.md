---
name: Browser route checks
description: Why route-authorization smoke checks should distinguish navigation from unrelated data-loading failures
---

When testing login redirects or role boundaries in a browser, assert the final route separately from the destination page's data-loading state. A background API request started on an earlier page can complete after navigation, and an out-of-sync development database can break destination data without breaking routing.

**Why:** Multiple route checks initially appeared to fail for different reasons because media queries depended on a development schema column not yet present. Network failures from previous pages also arrived during subsequent visits.

**How to apply:** Preserve independent API/data checks where relevant. For route-only checks, establish the destination path and role behavior first; if a known schema mismatch exists, scope any exception precisely and only while that mismatch is confirmed.