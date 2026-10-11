---
name: Touch-emulated input semantics
description: Desktop keyboard shortcuts are not reliable evidence of input replacement in mobile browser checks
---

Desktop selection shortcuts in a touch-emulated browser can append text rather
than replace the current input. A failed roundtrip assertion can therefore be
a fixture-interaction failure, not a defect in the saved metadata.

**Why:** The simulated shortcut left the existing value selected incorrectly and
appended text during a mobile editor check, creating false tag-roundtrip failures.

**How to apply:** Verify the input's actual value after editing and before saving.
Separate touch-control behaviour from deterministic fixture-value setup.
