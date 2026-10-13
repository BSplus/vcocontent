# Launch cleanup: Development complete, Production operator action pending

**Historical status only. Current launch plan:
[Production R2 launch checklist](r2-production-launch-checklist.md). Production cleanup
is not a prerequisite and must not be executed under the current instructions.
The older approvals and deletion steps below are not current execution authority.**

13 October 2026. Cleanup explicitly approved. No new archive, migration,
backup service or rollback rehearsal is required. No deployment or Production
R2 activation is authorized.

## Actual Development result — PASS

The original Development manifest was independently rechecked: target guard,
all IDs, schema, dependencies and every table fingerprint matched exactly.
The database-only transaction committed at this operation, with pre-cleanup
database clock **2026-10-13T09:04:55.162Z**.

| Result | Actual |
|---|---:|
| Media deleted / remaining | 75 / 0 |
| Events deleted / remaining | 23 / 0 |
| Import-file records deleted / remaining | 1 / 0 |
| Import jobs deleted / remaining | 1 / 0 |
| Accounts preserved | 34 |
| Series preserved | 3 |
| Protected table fingerprint mismatches | 0 |
| Physical Replit/R2 operations | 0 |
| Queued cleanup / reservations / object routes | 0 / 0 / 0 |

All non-dummy tables, including authentication/session/role/configuration data,
were fingerprint-checked before commit and independently checked afterward.
The upload gate remains `false`. No schema change, sequence reset or application
media-delete endpoint was used. Development checkpoint rollback remains the
existing recovery mechanism; no live rollback rehearsal was performed.

## Production — independently rechecked, NOT executed

Read-only audit at **2026-10-13T09:05:47.695753Z** matched the separately approved
Production snapshot exactly. Still **209 media, 4 events, 37 accounts, 3 series**.
No active workers, protected dependencies on events 29/30/31, custom triggers
or profile/series images linked to dummy media were found.

The Nextcloud connection and document **48** still match their protected
fingerprints. Gallery **224** is still unchanged until the operator commits
cleanup. Production SQL, including a rollback rehearsal, has not been run.
The audit time above is **not** a recovery timestamp for a later operation.

### Shortest supported manual execution

1. In **Database → Production → Settings → Restore**, reconfirm PITR is enabled
   with the reported 7-day window and restore access. Ensure application writes,
   transfers and background jobs are idle. Agent cannot inspect that control;
   the last configuration confirmation came from the operator. Do not start
   a restore or change settings.
2. Generate the existing SQL file from the workspace root (this is offline):

   ```sh
   node --import tsx scripts/prepare-production-cleanup.mjs
   ```

   Open **`generated-artifacts/launch/production-cleanup-PREPARED-ONLY.sql`**.
3. In the file, change only:
   - The three `set_config` confirmation values from `'false'` to `'true'`,
     once target, PITR and quiescence have actually been checked.
   - The empty `recovery_timestamp` to an exact confirmed Production timestamp
     immediately before execution, with an explicit offset. Obtain the clock
     using `SELECT clock_timestamp();` in the Production SQL runner and retain
     the timestamp outside the database. Use a point within the preceding
     15 minutes, covered by PITR. Berlin uses `+02:00` on this date; UTC `Z`
     avoids offset ambiguity.
   - The **final** `ROLLBACK;` to **`COMMIT;`**.
4. Select **Production**, verify the connection target, and run the **entire
   file in one session** in the operator SQL runner. If the client cannot
   preserve one session for the whole script, use the documented Production
   connection in an operator-controlled PostgreSQL client (`psql` with
   `-v ON_ERROR_STOP=1`). Never use the Development connection or give Agent
   Production credentials. On an error, rollback in the same session and stop.

This cleanup commit is already approved; **no separate rehearsal or renewed
approval is needed when the approved manifest still matches**. Do not remove
guards or regenerate fingerprints when they fail: drift requires renewed approval.
Do not run any schema migration SQL as part of this operation.

### Committed-state verification

After successful `COMMIT`, run this independently in Production:

```sql
SELECT
  (SELECT count(*) FROM media_items) AS media,
  (SELECT array_agg(id ORDER BY id) FROM events) AS event_ids,
  (SELECT count(*) FROM users) AS users,
  (SELECT count(*) FROM series) AS series,
  (SELECT count(*) FROM reference_documents WHERE id=48 AND event_id=224) AS document,
  (SELECT count(*) FROM nextcloud_sources WHERE event_id=224) AS connection,
  (SELECT count(*) FROM nextcloud_files) AS import_files,
  (SELECT count(*) FROM nextcloud_jobs) AS import_jobs;
SELECT id,visibility,admin_hidden,cover_image,custom_thumbnail FROM events WHERE id=224;
```

Expected: **0 media**, event IDs **[224]**, **37 users**, **3 series**,
document/connection **1 each**, import files/jobs **0**. Container must be
`draft`, hidden, with null cover/thumbnail. The transaction checks preserved
table fingerprints and every actual deletion count before commit. Retain its
output and confirm it completed with `COMMIT`, not rollback or an error.
Agent can independently recheck the replica after the operator reports success.
Do not rerun the deletion after a confirmed commit.

## Remaining Production R2 preparation — not applied

### Schema

Already defined/tested in Development; apply only through the reviewed managed
Publishing schema diff after separate deployment approval:

- `media_object_routes`: provider/integrity catalog, including `object_version`.
- Nullable `media_items.archived_at` compatibility column used by current
  queries, plus its active-media index. No archive behavior is enabled.

Review the complete diff: no unexpected drops/renames, no replacing Production
data with Development data, no deletion of accounts/configuration. No startup
DDL or manual Production schema script is needed or authorized. The cleanup
itself requires **no** schema changes.

### Production-only configuration

Prepare in the intended **Production configuration/publishing secrets context**,
not the Development Shell or a shared configuration:

| Name | Inactive staging value / requirement |
|---|---|
| `R2_PROD_ACCESS_KEY_ID` | Secret: Production bucket-scoped S3 key |
| `R2_PROD_SECRET_ACCESS_KEY` | Secret: matching S3 secret |
| `MEDIA_STORAGE_ENVIRONMENT` | `production` |
| `MEDIA_STORAGE_DATABASE_FINGERPRINT` | Independently verified published-runtime target hash |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_BUCKET` | `vco-content-media` |
| `R2_JURISDICTION` | `eu` |
| `R2_STORAGE_CLASS` | `Standard` |
| `MEDIA_STORAGE_PROVIDER` | `replit` |
| `MEDIA_STORAGE_ROUTING` | `disabled` |
| `MEDIA_STORAGE_NEW_UPLOADS_ENABLED` | `false` |
| `MEDIA_STORAGE_PRODUCTION_APPROVED` | `false` |
| `R2_PROD_WRITE_ENABLED` | `false` |

These inactive values are preparation, **not a passing active-R2 configuration
check**. After separate approval, the existing production guards require the
approved flag and verified target before R2 validation/activation. Neither
configuration nor credentials were changed this turn.

No audit API token, Worker, r2.dev domain, new transcoder or direct uploads are
required. Keep the EU Standard bucket private. The endpoint is derived as
`https://<account-id>.eu.r2.cloudflarestorage.com` with region `auto`;
optional `R2_ENDPOINT` must match exactly.

Production must not receive `R2_DEV_ACCESS_KEY_ID` or
`R2_DEV_SECRET_ACCESS_KEY`, including shared injection. Secret inventory alone
does not prove deployed-runtime injection. Do not assume Development secrets
appear correctly in Production. Leave runtime-managed `DATABASE_URL` and all
authentication/integration settings alone.

The Production target hash must be obtained inside the intended Production
context, without printing credentials. Do not reuse Development's hash or infer
it from the replica database name. See the existing
[launch preparation](r2-production-launch-preparation.md) for the offline
fingerprint command and activation sequence.

**Pending:** operator Production commit and independent verification, then
separate schema/deployment/configuration approval and bounded Production smoke.
No Production R2 change, physical-object deletion or launch has been performed.
