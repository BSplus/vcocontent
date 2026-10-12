---
name: Fetch mocks and object storage
description: Why network mocks for remote import tests must leave unrelated fetch requests alone
---

When mocking an external media provider using the process-wide `fetch` function, delegate requests for other origins to the original fetch.

**Why:** Replit App Storage uses fetch internally to reach its sidecar. A blanket provider mock intercepts those unrelated requests and makes valid image imports fail during object storage initialization, even though the provider response and image decoding are correct.

**How to apply:** Scope provider mocks by origin and preserve the real fetch for all other destinations when testing an import end-to-end.

Mocked clients retained in process-wide caches must resolve the currently active
fixture, rather than capture the objects and streams from the first test.

**Why:** Sequential browser playback cases reused a cached bucket whose mock
still served a closed fixture's media. Individual cases passed, while a later
missing-file check incorrectly continued receiving the earlier bytes.

**How to apply:** When mocking a cached resource, match the mock's lifetime to
the cached client's lifetime. Resolve changing test data through an active
fixture reference and clean it when the fixture closes; do not reset production
caches merely to make a test pass.