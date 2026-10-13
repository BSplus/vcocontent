# Clean-library reset and Production R2 launch preparation

**Current status:** [Development cleanup result and Production operator steps](launch-cleanup-status.md).
Development's approved 75 media/23 events are now deleted; all accounts,
configuration and physical objects are preserved. Production remains untouched,
with the approved manual commit pending. Historical preparation counts below
describe the pre-cleanup audit, not current Development data.

**Updated cleanup decision:** [simplified preservation plan](r2-clean-library-preservation-plan.md)
supersedes the cleanup/blocker sections below. Retain 224 as a hidden configuration
container, preserve document 48/source credentials, delete all 209 media and only
events 29/30/31. New separate manifests are verified; no cleanup has run.

13 October 2026 — **PREPARATION ONLY**. Read-only Development and Production
replica audits; no cleanup, Production writes/settings/credentials, live R2
requests, deployment or Production smoke performed.

## 1. Exact content scope

Development and Production have **different datasets**. Do not reuse either
environment's ID list or fingerprint in the other.

| Candidate deletion | Development | Production |
|---|---:|---:|
| Media rows (including captions, tags, dummy counters) | 75 | 209 |
| Galleries/test events (including covers/thumbnails) | 23 | 4 |
| Media analysis jobs | 0 | 205 completed |
| Nextcloud file/import bookkeeping | 1 file + 1 completed job | 209 files + 1 error job |
| Likes / favorites | 0 / 0 | 2 / 1 |
| Download history / operations | 0 / 0 | 1 / 1 |
| Entry-list rows / gallery-event links | 0 / 0 | 0 / 0 |
| Gallery notifications / content moderation reviews | 0 / 0 | 0 / 0 |
| Physical Replit/R2 objects | **0 deletions** | **0 deletions** |
| User/account deletions | **0** | **0** |

**Preserve:** all 34 Development accounts (5 admins), all 37 Production accounts
(6 admins), authentication/session data, roles/status/credits/profiles, the three
series definitions in each environment, system/feature settings, global safety
cache, verification records, integrations and all physical storage objects.
No account is assumed to be disposable. No sequence reset, schema deletion,
normal media-delete API or global object garbage collection.

Exact Development event IDs:
`1,2,5,7,8,10,13,14,18,19,20,21,22,25,26,27,28,29,30,31,32,57,97`.
Exact 75 media IDs, every table fingerprint and reviewed FK dependencies are
frozen in ignored/private `generated-artifacts/launch/development-reset-plan.json`.

Exact Production event IDs: **29,30,31,224**. Exact 209 media IDs and content
fingerprints are in `generated-artifacts/launch/production-readonly-targets.json`.
This is an independently read Production replica snapshot, **not executable
Production cleanup SQL or proof of the deployed runtime's connection fingerprint**.

### Important Production dependency blocker

Event **224** has:

- Saved encrypted Nextcloud connection (`nextcloud_sources`, 1 row).
- Reference document **48**, event-scoped entry list (`reference_documents`, 1 row).

Both database constraints use **ON DELETE CASCADE**. Deleting event 224 would
remove them, conflicting with preserving integrations/private reference data.
They are **not in the approved deletion list**. Production reset remains
blocked until their classification/handling is explicitly resolved. Do not
silently delete them, detach the document in a way that breaks its scope, expose
encrypted credentials, or retain an event as a hidden archive without approval.

### Prepared one-time Development reset

`npm run media:reset-plan` is **read-only**, has no apply/restore option, refuses
Production, and requires the closed Development upload gate. It produced:

- The exact private plan above.
- `generated-artifacts/launch/development-reset-PREPARED-ONLY.sql`.

SQL has not run. It locks the audited tables, checks the Development database,
full schema/dependency fingerprint and every table-row fingerprint, and stops
on changes. Known dependent rows cascade only after review; non-FK content
moderation references are explicitly scoped. Protected document/connection
cascades, unknown dependencies/triggers, preserved avatar/series-image links,
active workers, reservations, object routes and pending object cleanup block
preparation. **The generated transaction defaults to ROLLBACK, not COMMIT.**

Before separately approved execution: close uploads, settle imports/AI, take
and verify a database backup, regenerate/review the exact plan and compare its
counts/IDs with the approval. No normal storage cleanup worker or file-delete
API is invoked. Database row deletion is permanent after commit unless the
verified backup is restored; retained physical files alone cannot recover the
deleted ownership, tags and metadata. This is not an archival system.

## 2. Production R2 Secrets/configuration

Configure these **only after explicit approval**, in the **Production**
configuration/published app's Production secrets—not Development or Shared.
Use Tools → Secrets → Configurations to select the environment, and verify the
published app's **Production app secrets** in Publishing. Never assume a
Development setting is injected into the published runtime.

Required secret names, never values:

- `R2_PROD_ACCESS_KEY_ID`
- `R2_PROD_SECRET_ACCESS_KEY`

Use the separately created token scoped to **only `vco-content-media`** with
object read/write permissions. No account-wide/audit token needed. Keep
`R2_DEV_ACCESS_KEY_ID` and `R2_DEV_SECRET_ACCESS_KEY` exclusively Development.
The adapter now rejects opposite-environment credential names in either
runtime, even if unused. Secret metadata inspection reported DEV names in the
Production-scoped view; that alone is **not proof of deployed process injection**.
Verify the published runtime's names and remove any DEV entries there without
removing Development credentials. No credential value was read or entered here.

| Non-secret variable | Safe pre-activation value | After approved activation |
|---|---|---|
| `MEDIA_STORAGE_ENVIRONMENT` | `production` | same |
| `MEDIA_STORAGE_DATABASE_FINGERPRINT` | independently verified Production runtime target hash | same |
| `R2_ACCOUNT_ID` | Cloudflare account ID | same |
| `R2_BUCKET` | `vco-content-media` | same |
| `R2_JURISDICTION` | `eu` | same |
| `R2_STORAGE_CLASS` | `Standard` | same |
| `MEDIA_STORAGE_PROVIDER` | `replit` | `r2` |
| `MEDIA_STORAGE_ROUTING` | `disabled` if no R2 mappings | `enabled` |
| `MEDIA_STORAGE_NEW_UPLOADS_ENABLED` | `false` | `true` only for approved smoke/launch |
| `MEDIA_STORAGE_PRODUCTION_APPROVED` | `false` | `true` |
| `R2_PROD_WRITE_ENABLED` | `false` | `true` |

EU S3 endpoint is derived as
`https://<account-id>.eu.r2.cloudflarestorage.com`; SDK region is `auto`.
`R2_ENDPOINT` is optional and must exactly match this value if set.
Do not configure an r2.dev/public bucket URL, Worker, edge URL or direct-upload
path. Keep the bucket private, EU jurisdiction, Standard class as reported by
the operator; that report is not a fresh Production S3/configuration test.

`DATABASE_URL` remains runtime-managed. Do not overwrite it with a Development
connection or repoint to the existing Neon secret. Keep existing session/mail/
AI/integration configuration unchanged.

### Independent Production database verification

Read-only Production replica confirms **database `neondb`**, PostgreSQL 16.15,
24 public tables, 209 media/4 events/37 users. Development target is the pinned
container-local `helium/heliumdb`, 75 media/23 events/34 users.

This proves the audited datasets differ, but does **not** supply the exact
published `DATABASE_URL` hostname fingerprint. Before activation, obtain the
non-secret hash **inside the intended Production runtime/context**, without
printing its connection URL:

```
node --import tsx scripts/media-storage-config-check.mjs --database-fingerprint
```

This source command requires the intended runtime's source/tooling; do not run
it in the Development shell and label that result Production. If the published
image lacks this tooling, obtaining the runtime target hash remains a blocker,
not a reason to reuse Development's hash. Compare the runtime database identity
with the independent Production audit, then pin the verified hash. The hash
itself is an address guard, not independent evidence of environment isolation.

Production currently lacks `media_object_routes` and `media_items.archived_at`.
The existing managed Publishing schema diff must be reviewed/applied through
the supported publish process after approval. No startup DDL or custom
Production schema migration is added. The nullable compatibility column stays;
the archive/restore CLI/module were removed, not replaced by a new archive.

### Safe activation / rollback

After approval, schema/target/credentials/manual bucket review must pass before
changing the provider. An optional read-only validation stage uses provider
`replit`, routing `enabled`, approved flag `true`, uploads `false`, write flag
`false` after the schema exists; no uploads/deletes are permitted in that stage.
Selecting provider `r2` requires routing `enabled` and write flag `true`.

For an incident: close `MEDIA_STORAGE_NEW_UPLOADS_ENABLED` first. Existing R2
media still needs routing, catalog, Production approval and credentials for
delivery. Do **not** switch routing off, remove credentials, fall back to old
Replit objects or roll back to code without the R2 adapter. After background
work is safely settled, an approved new-upload rollback can choose provider
`replit` while keeping routing enabled and R2 reads working. Disabling R2 writes
also blocks R2 cleanup/poster updates; treat it as an explicit emergency pause,
not an invisible complete rollback. No permanent dual-write or source copying.

## 3. Minimal Production smoke — prepared, not executed

Do not reuse the Development runner: it deliberately rejects Production and
bootstraps Development-only test accounts. Use existing authenticated Production
accounts/roles and the existing application endpoints, after separate approval.

1. Snapshot the clean-library baseline and existing Creator quota usage; confirm
   target bucket/runtime/database, with a closed upload gate.
2. Temporarily open uploads for one **Creator photo + preview**, and one short
   **admin official video + initial poster**, maximum **one** AI replacement
   poster (five test-owned objects total). Do not change real account roles,
   passwords or balances to manufacture test permissions.
3. Create test galleries using existing Creator/admin endpoints. Upload through
   their authenticated media upload endpoints. Record the exact new IDs/keys.
4. Wait for automatic AI to settle; refresh current URLs via authorized gallery
   metadata. Unexpected keys/ownership/changes stop, never expand the allowlist.
5. Verify authenticated image/preview/current-poster responses, actual browser
   playback, byte-exact 206 Range/full video and SHA/size/MIME integrity.
6. Check anonymous and existing second non-admin account restrictions and exact
   Creator usage delta. A private draft photo download stays denied; use the
   test official non-premium video for successful transfer statistics: issuing
   an operation counts 0, completed transfer 1, replay remains 1.
7. Close uploads in a guaranteed finally step, including failures. Audit
   ownership/foreign and non-FK references before cleanup of **only** the new
   galleries/media/related test records and up to five known R2 objects. Verify
   absence; skip already-cleaned keys. Preserve the existing accounts and all
   unrelated data. Any unsafe cleanup guard leaves a blocker for review.

After PASS and separate final launch approval, open new Production uploads and
confirm the intended public-domain/access settings. The currently published
app is **private** at `https://vco-content-studio.replit.app`; no custom-domain
association/public-access change was performed. Private platform access must
be handled through existing approved access for the smoke, not by weakening
application authorization.

## 4. Remaining blockers and shortest safe sequence

1. Resolve the event-224 reference/Nextcloud preservation decision; separately
   approve the freshly audited cleanup scope for **each** environment and
   verified backup. Development SQL is prepared; Production cleanup is blocked.
2. Execute only the separately approved database-only reset, verify empty
   content/dependencies and preserved accounts/settings. Never delete Replit
   objects or migrate/archive dummy media.
3. Separately approve Production secrets/configuration and reviewed managed
   schema publication, verify the deployed database target and manual bucket
   settings, then stage R2 with uploads closed.
4. Separately approve/run the maximum-five-object Production smoke and exact
   cleanup; close uploads afterward, including failure.
5. After PASS, authorize the final Production upload gate/public-domain launch.

Preparation validation: 12 focused tests PASS, TypeScript check PASS,
production build PASS, and actual Development read-only planner PASS with no
blockers. **No cleanup SQL has been executed.** No new migration/archival or
Worker infrastructure is required.
