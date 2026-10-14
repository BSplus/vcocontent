---
name: Safety outage fixtures
description: Keep safety failure injection separate from ordinary creation quotas.
---

Inject simulated safety outages only at the safety boundary; allow ordinary
creation quota checks to run in the disposable database.

**Why:** Safety and creation share database transport. A blanket database
failure can reject creation before the safety check and test the wrong behavior.

**How to apply:** Scope quota failure injection to the safety request's bound
parameters. Keep provider traffic blocked independently, and verify that the
intended event transaction actually committed.
