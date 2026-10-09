---
name: Mobile browser viewport checks
description: Distinguish screenshot size from CSS layout size when testing responsive dialogs
---

Measure the CSS viewport and dialog bounds before interpreting a phone-sized screenshot as evidence of clipping. Keep normal fixtures human-readable, and test extreme unbroken labels as a separate edge case.

**Why:** Mobile emulation produced a 402-pixel screenshot with a wider CSS layout, making a dialog appear clipped. Checking an actual 402-pixel CSS viewport showed a correctly bounded, internally scrollable editor with an accessible save button. Screenshot dimensions alone did not establish the layout viewport.

**How to apply:** Record CSS viewport dimensions and element bounds alongside captures. Distinguish a responsive browser check from a physical iPhone and keyboard test; do not claim the latter from desktop emulation.
