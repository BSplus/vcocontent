---
name: Video upload size
description: Operator-requested video upload limit and its scope.
---

The user requests: “Lass uns die Maximalgröße für Videouploads auf 300 MB setzen”.

**Why:** The user asked for this product limit, separately from earlier isolated large-file transport tests.

**How to apply:** Keep video permissions and storage quotas separate from the per-file limit. This request does not authorize Creator video uploads or automatic Production publication.

The user also approved raising the total Nextcloud import limit to 2 GiB, still capped by the configured event storage allowance.

**Why:** A 500 MiB total import cap is insufficient for two videos at the new maximum size.

**How to apply:** Retain per-file validation, file-count limits, processing limits and storage quota enforcement; this is not approval to remove import safeguards.

The user requested a 60-second Nextcloud transfer timeout when investigating failed video imports.

**Why:** Larger video transfers may exceed the previous 20-second deadline. The actual cause of that import failure was not established because per-file exceptions were reduced to a generic message.

**How to apply:** Keep a finite transfer deadline and do not describe this timeout increase as proof the video failures are resolved. Production retries and publication still require separate approval.
