---
name: Historical media indexes
description: Why media URL indexes must exclude historical inline payloads
---

Do not create an unrestricted B-tree index over media URL or thumbnail text while historical Base64 records remain. Index only the short private object-path values.

**Why:** PostgreSQL rejected an additive index with “index row requires 4384664 bytes, maximum size is 8191” because historical inline image data lives in those columns. This is an environmental constraint of the existing dataset, not a reason to delete or migrate it without approval.

**How to apply:** When changing media lookup indexes or their migrations, include a partial predicate for the short object paths. Preserve lazy serving of legacy inline data until a separate migration has been approved and completed.