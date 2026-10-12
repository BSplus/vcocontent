---
name: Storage cost audit boundaries
description: Operator priorities for media storage and limits of provider recommendations.
---

Keep the Replit application, PostgreSQL metadata and existing Nextcloud archive integration when considering external media storage.

**Why:** The operator's storage brief prioritises predictable, low recurring costs without losing media quality, permissions or functionality, and explicitly retains these three parts.

**How to apply:** Evaluate large media separately from application database costs. Do not treat the Cloudflare R2 recommendation as provider-selection or migration approval; a separate explicit approval is required before moving files or changing production settings.

Direct signed downloads are not automatically equivalent to the current authenticated proxy.

**Why:** Reusable bearer URLs can remain valid after sessions or content are revoked, and link issuance does not prove a completed download. Saving transfer costs must not silently weaken rights or change the meaning of download statistics.

**How to apply:** Preserve proxy semantics initially, or obtain approval for a rigorously tested edge/current-permission and completion-reporting design. Distinguish provider-storage estimates from actual invoices and additional VM/CDN/Worker costs.
