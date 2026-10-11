---
name: Video sampling bounds
description: FFmpeg input windows and low-frame-rate timestamp behavior
---

Bound sampling windows on the input, not only on the output. Preserve decoded presentation timestamps rather than labeling frames with requested seek offsets.

**Why:** FFmpeg output time limits interact with frame synchronization at fractional seeks; low-frame-rate clips can produce an empty output even when a readable frame exists. Scene-select filters can also keep decoding after their intended window if only output duration is constrained.

**How to apply:** Keep real low-frame-rate clips in extraction checks alongside ordinary videos. An absent later frame is not evidence that the original is corrupt; start sampling at zero, skip absent later samples, and retain strict whole-extraction and per-process deadlines.

Treat decoder thread auto-detection as a diagnostic concern on the small VM,
not as evidence that more paid capacity is required.

**Why:** An intact IMSA original failed all live probe attempts under the old
short deadline. Limiting probe decoder threads substantially reduced local
runtime on that same original, and real frame extraction and managed-AI
requests succeeded in development. This is a useful diagnostic lead, not proof
that the deployed VM is fixed.

**How to apply:** Separate probe, extraction and provider failures. Check thread
behavior and bounded cold-start budgets before proposing hosting changes.
Require a separately authorized actual-VM retest before claiming live recovery.
