---
name: Event image boundaries
description: Why official event image metadata has a separate upload boundary and a trusted preset exception.
---

Keep official event metadata image limits independent of album media upload limits.

**Why:** Event images travel in JSON metadata; adopting the much larger album-file allowance would enlarge every event save and its stored payload. The existing small-thumbnail allowance was intentionally retained.

**How to apply:** When changing upload limits, distinguish event metadata from gallery files, and budget the request for two Base64 images rather than one.

Treat the built-in event fallback as a trusted historical preset, not a newly uploaded file.

**Why:** The existing default asset exceeds the new-upload allowance. Applying upload validation to that preset would block ordinary event creation without a custom image.

**How to apply:** Keep the exception specific to the built-in preset; do not broaden it to arbitrary asset paths or external links.
