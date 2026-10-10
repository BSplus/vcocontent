---
name: Reference-list scope decisions
description: Season reuse and the distinction between registered lineups and physical driver identity
---

The user selected “Include season-wide reuse now,” not event-only references.

**Why:** The user explicitly asked for season-wide reuse. Race numbers are not globally unique, and different content owners must not inherit each other's private reference lists.

**How to apply:** Keep season references within owner, series and selected season year. More specific event/session evidence takes precedence. Treat matching names as the official registered entry/team lineup, never as proof of who is physically driving or wearing a helmet in the image. Keep ambiguous identity fields unknown.

Treat event creation and source-file saving as one user-visible operation, even when they require separate server requests.

**Why:** The event can exist before the original reference finishes uploading. Enabling Done at that point permits premature closing and can discard the file needed for recovery.

**How to apply:** Keep close/Done blocked during source saving, retain the original File for retries without recreating the event, and reuse already parsed rows only when they belong to that exact File. Do not run the same document vision extraction twice.
