---
name: Inactive tab fixtures
description: Browser mocks must provide valid object responses even for data used in inactive tabs.
---
Mock object endpoints with their complete required shapes, not a generic empty array, even when the test does not open the tab using that data.

**Why:** JSX expressions in children are evaluated before the tab component decides whether to mount its content. A malformed usage fixture can trigger the application error boundary before an unrelated event or pagination control appears.

**How to apply:** When a browser check fails before its target becomes available, inspect the error boundary text and sibling endpoint fixtures before diagnosing the target feature. After merges, newly mounted diagnostics can invalidate older upload fixtures; add an explicit valid response instead of allowing unknown object endpoints to fall through to an empty array.
