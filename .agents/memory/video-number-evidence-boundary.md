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

Treat provider output structure and pixel evidence as separate boundaries.
Constrain video response shape without accepting incomplete frames or replacing
independent number checks. Changing this transport contract alone is not a reason
to upgrade historical number evidence or requeue completed live jobs.

**Why:** Generic JSON was insufficient to guarantee the indexed frame contract,
and historical invalid-output errors did not retain enough information to identify
their exact structural cause. Logging raw responses would expose unnecessary data.

**How to apply:** Keep bounded, static structural diagnostics and exact frame
binding. Report locally tested hardening separately from confirmed live recovery;
only an explicitly approved targeted retry can establish the latter.

Do not equate recovery from malformed output with universal reference matching.

**Why:** An approved live retry completed frame processing and tagging but still
left independently checked numbers unmatched where weak branding hints conflicted
with the entry list. Transport recovery, pixel checking and identity acceptance
are distinct outcomes.

**How to apply:** Report completion, checked numbers and accepted references
separately. Preserve intended conservative refusals and protected captions;
investigate weak-hint false negatives as a separate recognition-quality question.

Evaluate visible sponsor/brand lettering separately from registered team identity;
do not assume every branding mismatch is a proven competing team or an overlay.

**Why:** Frozen original video frames showed checked car numbers and readable
bodywork branding different from their registered team names. Weak hints vetoed
matches, but the pixels alone established neither a competing team nor a safe
global sponsor exemption.

**How to apply:** Inspect exact source-bound frames, distinguish on-car markings
from broadcast graphics, and evaluate any conflict-resolution change with
positive and negative controls rather than forcing known fixtures to match.
