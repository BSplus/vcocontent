---
name: Fetch mocks and object storage
description: Why network mocks for remote import tests must leave unrelated fetch requests alone
---

When mocking an external media provider using the process-wide `fetch` function, delegate requests for other origins to the original fetch.

**Why:** Replit App Storage uses fetch internally to reach its sidecar. A blanket provider mock intercepts those unrelated requests and makes valid image imports fail during object storage initialization, even though the provider response and image decoding are correct.

**How to apply:** Scope provider mocks by origin and preserve the real fetch for all other destinations when testing an import end-to-end.