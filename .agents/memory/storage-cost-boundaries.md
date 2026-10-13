---
name: Storage cost audit boundaries
description: Operator priorities for media storage and limits of provider recommendations.
---

Keep the Replit application, PostgreSQL metadata and existing Nextcloud archive integration when considering external media storage.

**Why:** The operator's storage brief prioritises predictable, low recurring costs without losing media quality, permissions or functionality, and explicitly retains these three parts.

**How to apply:** Evaluate large media separately from application database costs. Follow the current empty-library/new-upload launch scope in `replit.md`, not the superseded migration brief. Production cutover, deployment, resets and object deletion still require separate explicit approval; development approval does not extend to private references or profile images.

The operator explicitly confirmed that the Development/Production separation looks good.

**Why:** Separate environments were expressly accepted, not merely an engineering assumption. That confirmation did not authorize any real connectivity request or Production work.

**How to apply:** Preserve the accepted separation when proposing later storage changes; distinguish agreement with the architecture from approval to perform operations.

Use bucket-only Development S3 credentials and manual bucket-settings review, not an account-wide R2 audit token.

**Why:** The operator selected the bucket-only option after learning that Cloudflare configuration Read permission includes other buckets in the account.

**How to apply:** Do not broaden credentials to automate configuration inspection. Distinguish pending/manual settings evidence from actual automated object checks; neither is permission to access Production.

Verify R2 public-access surfaces separately from S3 authentication.

**Why:** Cloudflare's public `r2.dev` and custom-domain access are independent; an unsigned S3 rejection does not prove that either public surface is disabled.

**How to apply:** Review authoritative public-domain settings with the approved scope. Treat status-only S3 errors as diagnostics, not private-bucket proof; never use nonexistent objects as access-control positive controls.

Check Replit source-object isolation separately from Development database and R2 bucket separation.

**Why:** Replit App Storage can share objects between Development and Production of one project. A Development database can reference shared source keys; a test-labelled gallery is not proof of Development-only ownership/provenance.

**How to apply:** Do not block new-upload launch on old-source isolation when no migration is planned. Require explicit provenance/allowlists for any later approved old-object cleanup; Development database contents alone do not authorize deletion from shared source storage. Do not change source bucket bindings blindly or inspect Production media without approval.

Direct signed downloads are not automatically equivalent to the current authenticated proxy.

**Why:** Reusable bearer URLs can remain valid after sessions or content are revoked, and link issuance does not prove a completed download. Saving transfer costs must not silently weaken rights or change the meaning of download statistics.

**How to apply:** Preserve proxy semantics initially, or obtain approval for a rigorously tested edge/current-permission and completion-reporting design. Distinguish provider-storage estimates from actual invoices and additional VM/CDN/Worker costs.
