---
name: Video upload size
description: Operator-requested video upload limit and its scope.
---

The user requests: “Lass uns die Maximalgröße für Videouploads auf 300 MB setzen”.

**Why:** The user asked for this product limit, separately from earlier isolated large-file transport tests.

**How to apply:** Keep video permissions and storage quotas separate from the per-file limit. This request does not authorize Creator video uploads or automatic Production publication.

The operator now requires the finite configured event allowance to determine the
Nextcloud per-run source-transfer budget, without a second fixed 2-GiB clamp.
The default event allowance remains 2 GiB and the per-video limit remains 300 MiB.

**Why:** A hidden fixed import cap must not neutralize an explicitly higher event
allowance. This replaces the earlier approval of a fixed 2-GiB import ceiling.

**How to apply:** Keep source-transfer bytes separate from occupied event storage.
Already-saved sources are not new transfers; existing media, posters and active
reservations still consume event storage. Retain per-file validation, file-count
limits, processing limits and transactional quotas; this is not approval to
change defaults or remove safeguards.

The user requested a 60-second Nextcloud transfer timeout when investigating failed video imports.

**Why:** Larger video transfers may exceed the previous 20-second deadline. The actual cause of that import failure was not established because per-file exceptions were reduced to a generic message.

**How to apply:** Keep a finite transfer deadline and do not describe this timeout increase as proof the video failures are resolved. Production retries and publication still require separate approval.
