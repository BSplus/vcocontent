---
name: Professional image metadata boundaries
description: Operator requirements for non-destructive EXIF, IPTC and XMP planning and downloads.
---

Preserve uploaded originals byte-for-byte. Professional metadata workflows must not modify Production data or existing media; the operator requested a read-only audit and proposal, not implementation, deployment or migrations.

**Why:** The operator explicitly requires immutable originals and a read-only first step.

**How to apply:** Keep original file integrity separate from any future metadata-enriched download or RAW XMP sidecar. Metadata modifications change the export's full-file checksum even when JPEG image data is not recompressed. Do not backfill or rewrite existing assets without separate approval.

Creator-edited metadata must override AI suggestions. Avoid overwriting existing Creator metadata, exporting unverified AI identifications or exposing sensitive EXIF such as GPS.

**Why:** These are explicit professional photographer and editorial workflow requirements.

**How to apply:** Preserve authorship independently of uploading-account identity, and registered lineups independently of depicted-person identity. Resolve original-download privacy permissions and storage-quota treatment before implementing exports.
