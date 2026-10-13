# Minimal Production R2 launch — preparation only

**SUPERSEDED: use [the actionable Production R2 checklist](r2-production-launch-checklist.md).
The clean Production baseline is accepted. The old Nextcloud connection and
document 48 are not required and must not be restored. Ignore the historical
recovery/preservation blockers below. Old cleanup SQL must not be executed.**

Current launch plan, 13 October 2026. This supersedes the database-cleanup
prerequisites in the earlier launch documents. No destructive cleanup, database
replacement, old-media migration, Production schema deployment, Production
configuration change or R2 activation is approved by this document.

## Decision

Keep the current Production PostgreSQL database and every existing user, role,
series, setting and integration. Keep the saved Nextcloud connection and
reference document **48**. Existing media and visible test events are disposable
dummy content: **hiding is sufficient; deletion is not a launch prerequisite**.

Use the existing private, EU Standard R2 backend and authenticated application
proxy for new uploads. No Worker, CDN, signed-download redesign, new database,
migration ledger or archive-copy project is needed for launch.

## Actual checks and blockers

| Check | Result |
|---|---|
| Managed Production schema diff | Three additive statements only; no structural data loss or compatibility warning |
| Required schema | `media_object_routes`, nullable `media_items.archived_at`, partial `media_active_event_idx` |
| Development upload/delivery/AI smoke | Existing bounded live smoke report: PASS; not a Production test |
| Published app | Successful VM build, private; verified URL `https://vco-content-studio.replit.app` |
| Production credential inventory | `R2_PROD_ACCESS_KEY_ID` and `R2_PROD_SECRET_ACCESS_KEY` not present |
| Runtime isolation | Production metadata view reports Development key names; actual published-process injection not inspected |
| Production R2 connectivity/privacy | NOT VERIFIED; no Production credentials or activation used |
| Production read-only database | `neondb`: 37 users, 3 series, **0 events, 0 media** |
| Protected resources | **0 reference documents, document 48 absent, 0 Nextcloud connections** in that snapshot |
| Active work | No upload reservations, pending/running analyses or imports in the checked snapshot |

The existing Production deployment logs independently record application event
deletions on 13 October 2026: event **224** was requested at
**09:53:49.177Z** and reported successful at **09:53:58.940Z**, followed by
successful deletions of events **31, 30 and 29**. This is consistent with the
empty gallery state and disappearance of the protected container's resources.
The logs do not identify the operator here or prove that the deleted object
bytes can be recovered. None of these deletion requests was made by this
preparation work; no restore or other Production change was performed.

The protected-resource absence is a **launch blocker**, not permission to discard
them. Verify the currently deployed app's actual database target and check its
admin reference/Nextcloud screens before drawing conclusions about recovery.
The current application uses its runtime-managed `DATABASE_URL`; leave it
unchanged. Do not substitute the existing Neon secret or copy Development data
over Production.

If the resources are genuinely missing from the correct database, reconcile or
recover **only those protected resources** in a separately approved operation.
Do not replace/restore the whole Production database over the retained users.
The old approval snapshot contains fingerprints, not recoverable row contents.
Do not manufacture document 48 or silently upload a replacement with another ID.

## Why hiding works

Use the existing admin **Hide** action, which sets `admin_hidden=true`.
It excludes the event from public listing/search and denies public gallery,
media/preview, downloads and SEO access through the existing access predicates.
Administrators can still manage hidden content; this is deliberate.

**Do not rely on `visibility=draft` alone:** official events with no Creator
owner are public unless `admin_hidden` is true. Do not delete a container carrying
the Nextcloud connection or document 48.

There are currently no events/media in the checked Production snapshot, so there
is nothing to hide there. If the verified deployed app contains dummy events,
hide only those current events using Admin; do not reuse old destructive ID lists
or the prepared cleanup SQL. Old private Replit objects may remain; no bulk
physical-object deletion or copy to R2 is needed.

## Minimal manual checklist

### 1. Confirm preservation and the target — before approving publish

- In the deployed app and Production database context, verify the retained users,
  roles, three series, settings, mail/auth integrations and actual database target.
- Resolve the discrepancy above: document **48** and the saved Nextcloud connection
  must be present and usable on the correct target before launch approval.
- If dummy galleries are visible, use Admin **Hide**, not Delete. Leave protected
  references, source credentials, users and roles untouched.
- Keep the app's existing **private** platform visibility during staging/testing.
  No cleanup SQL console transaction is required.

### 2. Prepare Production secrets and approve one staged publish

Do this only after explicit approval for Production configuration, the additive
schema publication and **R2 activation with uploads closed**. These actions have
not been performed.

In the Production publishing configuration:

- Add the bucket-scoped Object Read/Write secrets
  `R2_PROD_ACCESS_KEY_ID` and `R2_PROD_SECRET_ACCESS_KEY`.
- Ensure `R2_DEV_ACCESS_KEY_ID` and `R2_DEV_SECRET_ACCESS_KEY` are not injected into
  the published process. Metadata inventory alone is not proof of injection.
- In Cloudflare, verify `vco-content-media`: **EU jurisdiction**, **Standard**,
  `r2.dev/public access disabled`, no public custom-domain binding, and the token
  restricted to this bucket. A Western Europe location hint alone is insufficient.
  An unsigned S3 request returning an authentication error does not prove that
  all public-domain access is disabled.
- Leave `DATABASE_URL`, authentication, session encryption, Resend and Nextcloud
  configuration unchanged.

Production runtime values for the approved staged R2 publish:

| Variable | Value |
|---|---|
| `MEDIA_STORAGE_ENVIRONMENT` | `production` |
| `MEDIA_STORAGE_DATABASE_FINGERPRINT` | Independently verified actual Production runtime target hash |
| `R2_ACCOUNT_ID` | The verified Production Cloudflare account ID |
| `R2_BUCKET` | `vco-content-media` |
| `R2_JURISDICTION` | `eu` |
| `R2_STORAGE_CLASS` | `Standard` |
| `MEDIA_STORAGE_PROVIDER` | `r2` |
| `MEDIA_STORAGE_ROUTING` | `enabled` |
| `MEDIA_STORAGE_PRODUCTION_APPROVED` | `true`, only following explicit approval |
| `R2_PROD_WRITE_ENABLED` | `true`, required by the active R2 runtime guard |
| `MEDIA_STORAGE_NEW_UPLOADS_ENABLED` | **`false`** |

The write-capability flag is needed for an active R2 runtime but does not authorize
normal media uploads while the upload gate is closed. Confirm background jobs
are idle and do not trigger an old-folder Nextcloud import during staging.

Obtain the **hostname, port and database name only** from the verified
Production database connection details. Never paste the full connection URL,
password or credentials into chat, documentation or shell history. Compute the
non-secret target hash offline in the workspace Shell by replacing the
placeholders below with those three non-secret values:

```sh
node --input-type=module -e \
'import {createHash} from "node:crypto"; const [host,port,db]=process.argv.slice(1); if(!host||!port||!db)throw Error("Three target fields required"); console.log(createHash("sha256").update(JSON.stringify([host.toLowerCase(),port,db])).digest("hex"));' \
PRODUCTION_HOSTNAME 5432 PRODUCTION_DATABASE_NAME
```

Use the actual port rather than assuming 5432 if the connection details differ.
This does not connect to any database and must not use Development's hostname.
Set that hash as the Production fingerprint. The deployed application checks its
actual runtime `DATABASE_URL` against it before enabling routing. The existing
`media-storage-config-check.mjs --database-fingerprint` remains an alternative
where a verified Production runtime context is available, but **do not run it
against the workspace's default Development `DATABASE_URL` and reuse the hash**.
Offline configuration validation does not prove bucket connectivity or privacy.

Publish via Replit's managed schema workflow, approving only:

1. Create `media_object_routes`, including provider/state/integrity fields,
   `object_version` and the existing checks.
2. Add nullable `media_items.archived_at`.
3. Create partial `media_active_event_idx`.

No manual Production DDL script or startup DDL is needed. **Do not select
Overwrite Production Data.** If the dialog shows unexpected drops, truncations
or additional destructive changes, stop. R2 schema/code already exists in the
workspace; this plan does not introduce more tables.

This combines additive schema publication and approved closed-gate R2 activation
into one staging publish. If you do not yet approve activation, the alternative
is a schema/code-only stage with provider `replit`, routing `disabled`, approval/
write flags `false`, and upload gate still `false`; it needs a later activation
publish.

### 3. Separately authorize and run one bounded Production smoke

Do not run the Development smoke runner against Production. It deliberately
rejects that target and creates Development-only test actors.

Before testing, confirm the staged runtime has the correct database/bucket,
private access and effective closed upload gate. No public upload opening yet.
Authorize a temporary upload window **only in an access-isolated test session**
with existing approved admin/Creator actors and idle import/analysis queues.
Do not change roles/passwords or create new real users. If other users/API clients
can upload during that window, do not open the global gate until isolation is
resolved.

- Permit one Creator photo + preview and one short official admin video + poster,
  with at most one normal AI replacement poster: **five test-owned R2 objects**.
- Record only this run's new gallery/media IDs and exact object keys. Do not
  import a whole Nextcloud archive. The same shared storage adapter routes
  Nextcloud imports; preservation of the saved connection is a separate check.
- Confirm actual R2 read-back SHA-256, size and MIME, image decoding, video
  Range/full GET and browser playback, normal AI completion, fresh poster URLs,
  Creator byte accounting and download statistics.
- Verify anonymous/private/other-Creator denials. Download link issuance must
  count zero; completed transfer counts once; replay does not count again.
- Check Cloudflare privacy settings plus permitted authenticated S3 reads with
  the exact test keys. Confirm Production credentials really work in the deployed
  runtime; stored key existence or an offline config PASS is not enough.
- In a guaranteed finally step, return uploads to **`false`**, even on failure.
  If publishing is required for runtime setting changes, republish and verify
  the gate is actually closed; editing inventory alone is insufficient.
- Only after separate authorization, remove this smoke's allowlisted records and
  up to five owned objects using existing ownership/reference checks, or keep its
  galleries hidden. Never clean unrelated objects or preserved resources.

A failed smoke leaves ordinary uploads closed. No broad cleanup, migration or
repair is part of the smoke.

### 4. Approve normal uploads only after recorded PASS

Following the controlled Production PASS, approve setting
`MEDIA_STORAGE_NEW_UPLOADS_ENABLED=true` and publish/restart as the platform
requires. Keep routing enabled for existing R2-only objects.

Verify the actual runtime gate, one ordinary upload and its protected download.
Confirm Nextcloud/reference preservation again. Change platform visibility or
public-domain launch only if separately approved; those are not needed for the
private R2 smoke.

On failure: close uploads; preserve R2 read routing for already verified objects.
Do not blindly disable routing, delete R2 objects or point the application at a
different PostgreSQL database.

## What the operator does not need to do

- Execute the 383-line cleanup transaction.
- Replace PostgreSQL or overwrite Production with Development.
- Migrate dummy photos/videos or delete their old physical objects.
- Add a Worker, CDN, new payment system, migration service or background transcoder.
- Weaken fingerprint, bucket-isolation, authorization or integrity guards.

See `r2-final-development-smoke-report.md` for the already completed Development
evidence. Historical cleanup documents are retained as records, not instructions
for this current launch.
