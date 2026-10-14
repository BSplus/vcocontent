---
name: Transactional email launch boundaries
description: Operator-approved scope and activation gates for account, Creator, community and financial emails.
---

Reuse the approved VCO verification design for system emails; do not redesign it or build a marketing/notification platform.

**Why:** The operator's transactional-email brief explicitly makes the tested verification email the design foundation and asks for focused reuse.

**How to apply:** Extend the shared brand design when new confirmed workflows need emails; preserve secure action links, CID branding, plaintext, and compact headline spacing.

Community and financial notifications are a preparation-only phase. Optional community emails require consent/preferences before activation. Do not activate Credits purchases, paid downloads, Stripe onboarding or payouts as a side effect of email work.

**Why:** The operator deliberately separates launch communication from future community notifications and monetisation.

**How to apply:** Require a separately authorised real workflow before connecting those email triggers. Missing password workflows and final actionable upload-batch events are dependencies to report, not permission to build new authentication or send emails for transient per-image errors.

Keep authentication action links out of the ordinary notification outbox.

**Why:** Event-notification retries retain plaintext content snapshots for idempotency; persisting raw verification/reset tokens there would undermine the existing hash-only token storage boundary.

**How to apply:** Preserve direct secure verification delivery. When adding password reset, use a secure token-specific delivery path rather than treating its raw action URL as a normal queued event payload.

Keep support enquiries on the direct-delivery path, not in the notification
outbox or a new ticket archive.

**Why:** The operator explicitly requested a lightweight public contact form
without storing full support messages in the application database.

**How to apply:** Future reliability changes may retain bounded pseudonymous
delivery-control information, but must not add message-content persistence or
automatic visitor replies without separate approval.
