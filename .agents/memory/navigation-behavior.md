---
name: Navigation and reading position
description: Preserve reading context while eliminating page jumps during navigation.
---

New full-page navigation should open at the top, while browser Back/Forward restores the prior reading position. Do not reset the page solely because filters or other query parameters change, and keep fragment links usable.

**Why:** The user confirmed fixes for both sideways layout movement and inherited scroll positions after they were reproduced on the live desktop site. The correction should not remove normal browser history or within-page reading context.

**How to apply:** Keep this policy consistent across public, account and Studio routes. Verify long-to-short and long-to-long transitions as well as history navigation when changing routing or shared page layout.
