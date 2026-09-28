---
name: Entry-list PDF layout
description: Lessons from extracting tabular entry lists from searchable PDFs.
---

Text being extractable from a PDF does not mean its table rows can be reconstructed from plain-text line order. In a multi-page motorsport list, the flattened text yielded many invalid rows although the visual table had complete entries. Positional text extraction recovered the rows without an image-recognition provider.

**Why:** Synthetic PDF fixtures with comma-separated text or perfectly aligned one-line columns passed while an actual document with two driver lines per entry failed. Headings were centered differently from their cell values, so exact column-midpoint classification also misplaced one column.

**How to apply:** For PDF import bugs, validate with the supplied document and a representative positional fixture, checking both the expected row count and contents across pages. Keep an alignment tolerance and warn if a declared entry total differs from extracted rows; never silently save the preview.