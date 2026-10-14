---
name: Video number evidence boundary
description: Acceptance and evaluation limits when reusing photo number checks for video.
---

Keep historical weak video evidence separate from independently checked frame
pixels. A local historical replay that suppresses false-looking numbers also
suppresses potential true positives; it is a safety-policy result, not measured
recognition improvement.

**Why:** The existing pilot has pending editorial verdicts, including #99/#9
and contradictory #65 branding, and its original review pixels were unavailable
when the independent video gate was implemented. Hashes and weak readings
alone cannot establish ground truth.

**How to apply:** Use frozen independently reviewed source pixels and both
negative and positive controls for any separately authorized paid comparison.
Keep request/token overhead, missed true numbers and unsafe identities separate.
Do not convert old observations into checked provenance or globally reanalyse
the archive merely because a checking policy changes.
