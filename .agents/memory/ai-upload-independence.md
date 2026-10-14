---
name: AI failures and upload independence
description: Operator rule: optional AI output never blocks file uploads; retain standard event captions on failure.
---

Invalid AI output darf nie den Upload verhindern. Dann bekommt das Bild eben die Standard Event Caption.

**Why:** The user explicitly requires successful file uploads to be independent
of optional tagging, number recognition and matching, even when provider output
is malformed.

**How to apply:** Persist the standard event caption with new captionless media
and imported filename placeholders before analysis. Keep user-written captions
and manual identifications protected. Allow successful automatic matching to
enrich only automatic captions. This is not permission to bypass file validity,
access rights, quotas or independent publication safety checks. Do not treat
recognition failure as a failed transfer or remove its saved objects.
