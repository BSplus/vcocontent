---
name: Professional image metadata boundaries
description: Operator requirements for non-destructive EXIF, IPTC and XMP planning and downloads.
---

Preserve uploaded originals byte-for-byte, including official VCO uploads. IPTC/XMP metadata is optional for all Creators and must never be a general upload requirement. Professional metadata workflows must not modify Production data or existing media; the operator requested planning, not implementation, deployment or migrations.

**Why:** The operator explicitly requires immutable originals and a read-only first step.

**How to apply:** Keep original file integrity separate from any future metadata-enriched download or RAW XMP sidecar. Metadata modifications change the export's full-file checksum even when JPEG image data is not recompressed. Do not backfill or rewrite existing assets without separate approval.

Creator-edited metadata must override AI suggestions. Avoid overwriting existing Creator metadata, exporting unverified AI identifications or exposing sensitive EXIF such as GPS.

**Why:** These are explicit professional photographer and editorial workflow requirements.

**How to apply:** Preserve authorship independently of uploading-account identity, and registered lineups independently of depicted-person identity. Never infer copyright ownership or licensing rights from AI or uploader identity. Missing eligible fields can use event data, AI tagging, matching and captioning.

Offer privacy-filtered standard downloads. Exact-original downloads require explicit Creator availability settings and warnings about sensitive embedded metadata. Use non-destructive JPEG metadata exports and RAW XMP sidecars.

**Why:** The operator expressly approved these product principles in the consolidated planning brief.

**How to apply:** Treat exact-original availability as distinct from download authorization. Preserve the private original rather than sanitizing it in place; account for download-only cache versus persisted Creator-managed sidecars according to the marketplace storage rule.
