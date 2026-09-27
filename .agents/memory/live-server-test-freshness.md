---
name: Live-server test freshness
description: Avoid mistaking a stale preview process for a regression in server integration tests.
---

After merging server changes, restart the running preview before interpreting integration-test failures that request its HTTP endpoints.

**Why:** A passing build can coexist with an older server process; an anonymous featured-media test initially reported an old response until the preview restarted.

**How to apply:** When integration tests use the running preview rather than launching their own process, restart the app once after server changes and then run those tests. Do not repeatedly restart when nothing relevant changed.