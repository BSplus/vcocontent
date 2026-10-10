---
name: Video sampling bounds
description: FFmpeg input windows and low-frame-rate timestamp behavior
---

Bound sampling windows on the input, not only on the output. Preserve decoded presentation timestamps rather than labeling frames with requested seek offsets.

**Why:** FFmpeg output time limits interact with frame synchronization at fractional seeks; low-frame-rate clips can produce an empty output even when a readable frame exists. Scene-select filters can also keep decoding after their intended window if only output duration is constrained.

**How to apply:** Keep real low-frame-rate clips in extraction checks alongside ordinary videos. An absent later frame is not evidence that the original is corrupt; start sampling at zero, skip absent later samples, and retain strict whole-extraction and per-process deadlines.
