# R2 environment configuration — Development/Production separation

The operator reports that `vco-content-media` (Production) and
`vco-content-media-dev` (Development) now exist with EU jurisdiction, Standard
storage, private access and separate bucket-scoped tokens. These are operator
statements; they have not yet been independently tested by this implementation.

**Current approval: Development only.** No Production credentials, Production
bucket probes, Production settings, deployments or media migration are authorized.
Wait for the operator to confirm configuration before running the real probe.

## Replit locations

Development secrets: **Tools → Secrets → New Secret** in the Project Editor.
Non-sensitive Development values: **Configurations → More → New testing configuration**.
Use environment-specific configurations, not shared values for provider/bucket
selection. Remove or reconcile conflicting shared keys deliberately; do not replace
all project secrets in bulk.

Production (later, only with separate approval): **Publishing → Adjust settings →
Production app secrets**; non-sensitive values can be entered through **Configurations →
More → New published app configuration**. Review every required Production entry
explicitly; do not assume Development secrets are automatically available there.
Do not configure Production now.

Official reference, consulted 12 October 2026:
https://docs.replit.com/core-concepts/project-editor/app-setup/secrets

### How testing configurations are selected

Run a probe from a fresh **workspace Shell**, not the publishing/deployment runtime.
Replit provides testing configuration values to the workspace environment; the command
does not select a named configuration profile. `NODE_ENV=development` is a Node flag
for that command, **not** a switch that fetches Development or Production secrets.
Reopen the Shell/restart a workflow after configuration changes and perform an
offline configuration check first. The application independently requires
`MEDIA_STORAGE_ENVIRONMENT=development`, rejects a published-runtime marker for
this probe, reads only `R2_DEV_*` credentials, and pins its target to
`vco-content-media-dev` before network requests. The bucket-only preflight imports
no database client and does not read/query/change the database, even if a
`DATABASE_URL` exists in the inherited workspace environment.

## Secrets

| Name | Development | Production, future only |
|---|---|---|
| `R2_DEV_ACCESS_KEY_ID` | Development S3 access-key ID | Do not use |
| `R2_DEV_SECRET_ACCESS_KEY` | Corresponding Development S3 secret | Do not use |
| `R2_DEV_AUDIT_API_TOKEN` | **Do not configure or use**; operator chose bucket-only object probe | Do not use |
| `R2_PROD_ACCESS_KEY_ID` | **Do not enter** | Separate Production bucket-scoped S3 access-key ID |
| `R2_PROD_SECRET_ACCESS_KEY` | **Do not enter** | Corresponding Production S3 secret |

S3 access keys and API audit tokens are not interchangeable. The audit token must
be able to read bucket jurisdiction/storage-class and managed/custom-domain
settings; S3 credentials alone do not prove these properties. No account-wide write
permission is needed for the audit. The implementation does not fall back between
DEV, PROD or old generic `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`.

### Important correction: audit permission is account-scoped

For automated bucket configuration reads, the minimum custom Cloudflare token
permission is **Account → Workers R2 Storage → Read**
(API permission group **Workers R2 Storage Read**). Restrict **Account Resources**
to **Include → Specific account → the account owning the Development bucket**.
No Edit, Workers Scripts, DNS, Zone or Data Catalog permission is needed by the
three existing R2 configuration GETs.

Cloudflare documents this permission as an **Account** resource permission.
It is **not bucket-specific** and can read/list R2 configuration and objects for
other buckets in that account, including Production if it shares the account.
The preflight's URLs target only Development, but that does not make the token's
granted permission Development-only. Do not create/request/use this broader token
without the operator choosing this audit approach explicitly.

Bucket-specific resources are supported for **Workers R2 Storage Bucket Item Read**
and **Workers R2 Storage Bucket Item Write**, not this configuration-management Read
permission. A Development bucket resource has the documented form:
`com.cloudflare.edge.r2.bucket.<account-id>_eu_vco-content-media-dev`.
Object-only access cannot perform the independent configuration/domain-settings audit.

The operator selected strictly bucket-only credentials. The preflight is now
object-only: no account API calls or audit-token reads, with the bucket settings
requiring manual dashboard verification instead of a configuration API audit.
On 13 October 2026 the operator confirmed that review complete.
Manual evidence must not be reported as a passed API configuration test.

Sources consulted 13 October 2026:
https://developers.cloudflare.com/r2/api/tokens/
https://developers.cloudflare.com/fundamentals/api/reference/permissions/

`MEDIA_EDGE_AUTH_SECRET` is optional for a later isolated Development preview Worker,
not required for this connectivity probe. No Production Worker is enabled.

## Non-sensitive configurations

| Name | Development, first probe | Production, future only |
|---|---|---|
| `MEDIA_STORAGE_ENVIRONMENT` | `development` | `production` |
| `R2_ACCOUNT_ID` | Cloudflare account ID | Explicitly configured Production account ID; may be the same account |
| `R2_BUCKET` | `vco-content-media-dev` | `vco-content-media` |
| `R2_JURISDICTION` | `eu` | `eu` |
| `R2_STORAGE_CLASS` | `Standard` | `Standard` |
| `R2_ENDPOINT` | Optional; recommended unset | Optional; recommended unset |
| `MEDIA_STORAGE_PROVIDER` | `replit` | Initially `replit`; eventual `r2` changes **new writes**, not existing links |
| `MEDIA_STORAGE_ROUTING` | `disabled` | Initially disabled; enable only in an approved rollout with schema/configuration ready |
| `MEDIA_MIGRATION_ISOLATED` | `confirmed` after checking Development bucket isolation | Do not set; Development migration CLI rejects Production |
| `R2_BUCKET_SCOPED_TOKEN_REVIEWED` | `true` after independently checking Development token scope | Not used by the Development probe for Production |
| `MEDIA_STORAGE_DATABASE_FINGERPRINT` | Not needed for bucket-only probe; **required before routing is enabled** | Required before routing is enabled, verified independently for Production database |
| `MEDIA_STORAGE_PRODUCTION_APPROVED` | Do not set | Defaults blocked; `true` only after explicit Production approval |
| `R2_PROD_WRITE_ENABLED` | Do not set | Defaults blocked; `false` for read-only rollout, `true` only after separate write/cutover approval |

The EU S3 endpoint is derived as
`https://<account-id>.eu.r2.cloudflarestorage.com`. A differing endpoint is rejected.
`weur` is not a substitute for EU jurisdiction.
`REPLIT_DEPLOYMENT` is a platform-provided runtime marker, **not a setting to enter**.
A local `NODE_ENV=production` build remains Development and cannot select the
Production bucket. Published Production requires the published-runtime marker,
`NODE_ENV=production`, explicit Production scope and the approval gate.

For the probe command, `NODE_ENV=development` is set for that command only.
Do not change the deployment start command or any Production environment setting.

## Isolation

1. Each environment uses a token restricted to its own bucket. Sharing the same
   Cloudflare account is fine; sharing a credential across both buckets is not the
   approved configuration. Cloudflare IAM is the essential enforcement boundary.
2. Development rejects the known Production bucket name; its bucket must end in
   `-dev` or `-test`. Production accepts only `vco-content-media`.
3. Distinct DEV/PROD credential names and runtime guards prevent accidental secret
   fallback. Incorrect profiles fail before S3 requests.
4. Production PUT/DELETE are additionally disabled unless its write gate is true,
   including on an already-created client. Changing bucket/profile in a running
   process fails closed; restart after authorized configuration/credential changes.
5. Enabling media routing checks a non-secret fingerprint of the database connection
   **host, port and database name** against an independently verified expected target.
   It catches a wrong connection; it does not by itself prove environment isolation.
   Before migration/routing, independently verify Development and Production
   databases and legacy Replit source storage. Do not blindly copy Production
   `DATABASE_URL` or its fingerprint into Development.
6. The Development migration CLI remains Development-only. It retains all Replit
   source copies. The first bucket-only probe does not query/change the media database,
   alter provider routing, or read existing media objects.

Database fingerprint preparation, later: `npm run r2:config-check -- --database-fingerprint`
computes the expected-target identifier without displaying credentials, hostname or
connection URL and makes no network calls. Run only after confirming the target is
the correct isolated database, then save its output as that environment's
`MEDIA_STORAGE_DATABASE_FINGERPRINT`. Never treat identical database names alone
as proof of isolation.

## First real Development probe — only after confirmation

```sh
NODE_ENV=development npm run r2:preflight -- --approved-development-connectivity
```

The probe validates Development process configuration **offline**, then creates one
uniquely named test object with a conditional create, verifies actual bytes and SHA-256,
checks unsigned S3 access, and cleans up **only its own test key**, confirming its absence.
That unsigned S3 check is not valid public-access verification; do not repeat it as
a privacy test. The probe does not independently read Cloudflare bucket settings;
the operator has now completed their manual Development review.
Configuration rejection
and isolated mock tests demonstrate the Production selection guard without probing
Production or using its credentials. Token-scope review remains a separately stated
operator attestation, not a blanket claim that a successful GET proves least privilege.

Report: `generated-artifacts/r2/preflight.json`. Cleanup failure is a blocker and
must identify the owned probe key for manual Development-only cleanup, never list
or empty the bucket. No existing media migration is performed.

## Eventual approved Production switch

1. Independently configure Production secrets/configurations and verified database
   fingerprint in the Production surfaces. Complete Development evidence first.
2. Approve Production schema/rollout separately; there is no startup DDL.
3. Start approved routing with `MEDIA_STORAGE_PROVIDER=replit`,
   `MEDIA_STORAGE_PRODUCTION_APPROVED=true`, `R2_PROD_WRITE_ENABLED=false`.
   This retains Replit writes; Production R2 reads remain subject to current rights
   and verified per-object routes. R2 cleanup cannot delete objects in this phase.
4. A separately approved Production copy/reconciliation process must establish
   byte-verified mappings before existing objects can route to R2. The current
   Development CLI cannot perform that Production run.
5. Only after write/cutover approval set `R2_PROD_WRITE_ENABLED=true` and
   `MEDIA_STORAGE_PROVIDER=r2` for new writes, then explicitly deploy/restart.
   Existing unregistered objects continue using Replit, not guessed R2 locations.
6. To stop new R2 writes, return the provider to `replit`, turn the Production R2
   write gate off, and **keep routing enabled** for already verified R2 objects.
   Retained sources can be rolled back only via an approved verified process.
   New R2-only uploads need a verified reverse copy before a full rollback.

Neither approval gate has been set by the agent. No Production setting or deployment
has been changed. The first authorized real Development probe completed upload,
actual read/SHA-256 and cleanup. The unsigned S3 HTTP 400 was classified as an
invalid public-access verification method, not evidence of public exposure.
Manual Development settings review is complete; pilot execution is not authorized. See
[r2-development-connectivity-report.md](r2-development-connectivity-report.md).
