# Production R2 launch checklist — awaiting approval

13 October 2026. Current operator-approved starting point: **37 users, 3 series,
0 events, 0 media**. Keep this Production PostgreSQL database. The old Nextcloud
connection and reference document 48 are not required: **do not restore them**.
All old cleanup SQL is obsolete and must not be executed. No cleanup or
old-media migration is part of this launch.

## Prepared and verified by Agent

- Fresh Production read-only counts match the accepted starting point.
- Read-only HTTPS requests to the verified private deployment
  `https://vco-content-studio.replit.app` returned 0 events and 3 series.
  The series ID/name SHA-256 matches the Production query exactly.
- Current application code uses runtime-managed `DATABASE_URL`, not the separate
  Neon secret. These checks strongly corroborate the Production dataset; the
  currently deployed process does not expose its hostname fingerprint.
  The manual target check below completes that verification.
- Existing R2 configuration explicitly supports only Production bucket
  `vco-content-media`, EU endpoint, Standard class and Production-scoped keys.
  Existing protected proxy delivery, image previews and video Range handling
  remain unchanged. Actual Production bucket/credential access is not yet tested.
- Publishing reports exactly three additive schema changes, no drops,
  truncations, structural data loss or backwards-compatibility warnings:
  `media_object_routes` with its version/integrity checks;
  nullable `media_items.archived_at`; partial `media_active_event_idx`.
- Development R2 smoke previously passed. The prepared upload gate explicitly
  blocks both providers when set to `false`; its regression, existing R2 routing
  tests, TypeScript and Production build passed.
- Existing Publishing settings are sufficient: VM, build `npm run build`,
  run `env -u R2_DEV_ACCESS_KEY_ID -u R2_DEV_SECRET_ACCESS_KEY npm run start`.
  This approved Production-only prefix excludes inherited Development credential
  variables from the application process. Development startup and stored secrets
  are unchanged. No startup DDL or additional deployment service needed.

## Production inventory — what must be configured manually

**Current status:** The operator has configured the Production values below and
the three approved schema additions are applied. The initial inventory below is
historical, not evidence that the operator's Publishing configuration is missing.
The remaining confirmed startup conflict is inherited Development variable
presence. The prepared launch prefix addresses that conflict on the next
operator-controlled publish; keep the database-copy checkbox unchecked and the
normal upload gate closed. No new secret entry or schema work is required for
this startup change.

The inventory reports **no configured R2 non-secret Production values** and no
`R2_PROD_ACCESS_KEY_ID` / `R2_PROD_SECRET_ACCESS_KEY`.
It does report Development key names in the Production metadata view; this is
not proof of runtime injection. Inspect the actual published-app secret scope:
Production must not receive those Development keys. If they are currently Shared,
move their scope to Development-only through the Secrets UI without exposing or
changing their values. Do not remove other shared authentication/integration
secrets and do not merely replace Development keys with empty values.

### 1. You: verify the Production target and Cloudflare bucket

In Replit, verify Publishing is attached to the existing Production database
whose data is 37 users, 3 series, 0 events and 0 media. Leave `DATABASE_URL` and
all user/auth/mail/integration configuration unchanged.

From that database's connection details, take only **hostname, port and database
name**, not the password or full URL. Compute the expected target hash offline:

```sh
node --input-type=module -e \
'import {createHash} from "node:crypto"; const [host,port,db]=process.argv.slice(1); if(!host||!port||!db)throw Error("Three target fields required"); console.log(createHash("sha256").update(JSON.stringify([host.toLowerCase(),port,db])).digest("hex"));' \
PRODUCTION_HOSTNAME PRODUCTION_PORT PRODUCTION_DATABASE_NAME
```

The prepared runtime checks its actual connection against this hash before R2
routing starts. Do not reuse a Development hash or put a Production connection
URL in the workspace, chat or command history.

In Cloudflare, confirm bucket `vco-content-media` has:

- **EU jurisdiction** (not merely a Western Europe location hint).
- **Standard** storage.
- Public access / `r2.dev` disabled and no public custom-domain binding.
- Object Read/Write credentials restricted to this bucket.

### 2. You: configure Production values and approve a staged publish

Use **Production publishing configuration**, not Development, Shared or
workspace Shell exports. Add these two secrets through the secret UI:

| Secret | Manual action |
|---|---|
| `R2_PROD_ACCESS_KEY_ID` | Add Production bucket-scoped access key |
| `R2_PROD_SECRET_ACCESS_KEY` | Add its matching secret |

Set these non-secret Production values:

| Variable | Staged value |
|---|---|
| `MEDIA_STORAGE_ENVIRONMENT` | `production` |
| `MEDIA_STORAGE_DATABASE_FINGERPRINT` | Verified Production target hash from step 1 |
| `R2_ACCOUNT_ID` | Cloudflare account ID for this bucket |
| `R2_BUCKET` | `vco-content-media` |
| `R2_JURISDICTION` | `eu` |
| `R2_STORAGE_CLASS` | `Standard` |
| `MEDIA_STORAGE_PROVIDER` | `r2` |
| `MEDIA_STORAGE_ROUTING` | `enabled` |
| `MEDIA_STORAGE_PRODUCTION_APPROVED` | `true` **only after explicit staging approval** |
| `R2_PROD_WRITE_ENABLED` | `true` **only after explicit staging approval** |
| `MEDIA_STORAGE_NEW_UPLOADS_ENABLED` | **`false`** |

Leave optional `R2_ENDPOINT` unset: the code derives
`https://<account-id>.eu.r2.cloudflarestorage.com`, region `auto`.
If already set, it must exactly match that endpoint.

The active runtime requires its write-capability flag, but the separate closed
upload gate blocks new media. Confirm no active import/analysis work before
staging. No previous Nextcloud folder needs to be re-imported.

**Approval gate:** approve the additive schema publish and closed-upload R2
activation explicitly. Then use the existing Publish workflow. Review its diff:
only the three additions above; **never select Overwrite Production Data**.
Stop on unexpected destructive changes. Agent will not publish automatically.

The approved Production launch prefix explicitly excludes only
`R2_DEV_ACCESS_KEY_ID` and `R2_DEV_SECRET_ACCESS_KEY` before starting the existing
application. It does not remove Production/authentication/integration credentials,
alter the expected database fingerprint, relax the isolation guard or open the
upload gate. It takes effect only on the next operator-controlled publish.

After deployment, Agent can check startup health, actual target/configuration
validation, retained counts and denied ordinary uploads without a test upload.
A healthy startup/config check is not proof of real S3 connectivity.

### 3. You authorize; Agent runs one controlled Production smoke

**Current controlling procedure:** see
`docs/r2-production-smoke-procedure.md`. The operator requires normal uploads
blocked BEFORE, DURING and AFTER the test, with exact-scope cleanup. The proposed
smoke-only authorization is not implemented yet and needs separate approval and
manual publishing. Do not flip the global flag to `true` for a smoke window.
This supersedes the earlier temporary-global-gate/private-window approach.

Use existing eligible Creator/admin accounts
and an existing second non-admin account; do not change roles or create users
to manufacture test permissions.

Approve one bounded test run using only the scoped authorization in the
controlling procedure. No other users or API clients receive upload permission.
Deployment privacy is optional additional protection; ordinary uploads stay
closed regardless of visibility.

Scope: one small Creator photo + preview and one short official video + poster,
with at most one normal AI replacement poster: **five test-owned objects maximum**.
Record the new IDs/keys; no bulk import, dummy migration or existing-data cleanup.
Remove only this run's test data according to the controlling procedure.

| Required check | PASS criterion |
|---|---|
| Upload routing | Application uploads create verified `provider=r2` records; no Replit fallback |
| Real bucket access | Production credentials can read back the exact test objects; size, MIME and SHA-256 match |
| Previews | Creator image preview and current video poster decode and load through authenticated app routes |
| Video | Browser playback advances without error; full GET hash and 206 Range bytes match |
| Permissions | Anonymous original access denied; private Creator content denied to another user; owner access works |
| Creator quota | Exactly one photo counted and stored-byte delta equals source + preview; configured limits remain enforced |
| Downloads | Link issuance counts 0; completed official-video transfer counts 1; replay still counts 1 |
| Normal processing | AI/safety jobs settle normally; refreshed URLs point to the current valid poster |

The controlling procedure keeps test galleries in draft. If official-download
statistics require public content, defer that distinct workflow check rather
than publishing dummy data or weakening access controls; identify it explicitly
in the report, not as a measured PASS.

Quota accounting is measured in the smoke; limit enforcement is covered by the
existing regression/configuration checks, not by filling a real Creator's quota.
Anonymous application checks use no app session; the private platform access gate
must not be mistaken for application permission denial.

Keep the upload gate **`false` throughout**, including on failure. Revoke scoped
permissions, drain only test-owned work, remove only exact manifest-owned rows
and keys, and verify actual absence. Hidden galleries alone are no longer
sufficient for this smoke: the operator explicitly requires cleanup.

### 4. You approve normal uploads after the recorded smoke PASS

Change **only** `MEDIA_STORAGE_NEW_UPLOADS_ENABLED` to **`true`** in Production
and publish/restart through Publishing as required to apply it. Keep provider
`r2`, routing `enabled`, approved/write flags `true` and the same target/bucket.

Agent can then confirm an ordinary new upload, its R2 mapping, preview and
protected delivery. Public deployment visibility/domain opening is separate
from enabling R2 and requires its own approval if desired.

If anything fails: close uploads again, **retain R2 read routing**, and preserve
existing accounts/data and R2 objects. Do not change database targets, execute
old SQL or migrate dummy files.

**Current status:** checklist prepared; Production has not been deployed,
reconfigured or activated by Agent. No Production smoke or R2 object operation
has been performed.
