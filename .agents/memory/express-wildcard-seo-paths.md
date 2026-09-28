---
name: Express wildcard SEO paths
description: Why route-specific server HTML cannot use the mount-relative path in a catch-all Express middleware.
---

In an Express catch-all middleware mounted at `"*"`, the path visible inside the handler can be `/` even when the browser requested a nested page. For route-specific server-rendered metadata, derive the pathname from the original request URL and disregard its query string.

**Why:** A live nested event page kept receiving the generic home title even though direct metadata tests using a synthetic request path passed. A browser request through the actual middleware exposed the difference.

**How to apply:** When changing SEO or other per-page behavior in an SPA fallback, test a real nested URL through the running server, not only the formatter with a stub request. Do not build canonical origins from the request host.