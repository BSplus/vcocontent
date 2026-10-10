---
name: Database publishing boundary
description: Verify the publishing schema diff before assuming this project needs manual external-database migrations.
---

Do not infer that production uses an unmanaged external database solely from the Neon driver or an existing Neon secret.

**Why:** That assumption led to an incorrect publishing warning. The production schema inspection and publishing diff confirmed that Replit's Publish flow handles the Creator profile additions for this project.

**How to apply:** Check the actual production schema and publishing diff before advising manual migrations. For the managed production database, prepare and verify changes in development and let Publish apply them. Never add production DDL to startup or deployment builds. Reconfirm this boundary if the deployed connection configuration changes.
