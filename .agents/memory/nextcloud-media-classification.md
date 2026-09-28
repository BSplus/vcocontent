---
name: Nextcloud media classification
description: Why the import progress uses the same filename classification as discovery
---

The Nextcloud import's preview and progress should classify a source file consistently by its supported filename extension, while the downloaded bytes must still pass the normal media validation before publication.

**Why:** This lets resumed imports report image/video counts for existing persisted file rows without introducing a schema migration or assuming the remote server's content-type header is trustworthy. Extensions are classification hints, not evidence that the content is valid.

**How to apply:** When adding supported formats or changing classification, update discovery and progress together; do not bypass the media storage validation for downloaded files. If future imports no longer preserve meaningful filenames, persist the type explicitly instead.