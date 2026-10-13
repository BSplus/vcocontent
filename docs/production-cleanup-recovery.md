# Production cleanup: recovery assessment and unexecuted operator transaction

**Updated approval:** cleanup is explicitly approved; no separate rollback
rehearsal is required for the dummy data. Follow
[the direct operator commit steps](launch-cleanup-status.md). Production remains
unexecuted by Agent. The default rollback is a safety default, not a requirement
to seek another approval before an already-approved, unchanged-scope commit.

13 October 2026. Preparation only: no Production mutation, restore, settings
change, deployment, R2 activation or physical-object operation.

## PITR assessment

The operator confirmed Production PITR enabled with a **7-day window** and a
timestamp-entry restore dialog in **Europe/Berlin**. This is an appropriate
recovery mechanism for the scoped cleanup. PITR is timestamp-based, not a list
of individual scheduled snapshots; the absence of that list is not a blocker.

No destructive live restore rehearsal or new backup service is required.
This confirmation establishes the configured recovery facility, **not proof
of a successfully tested restore**. Agent has not independently inspected its
history/coverage or executed restoration.

Before an eventual operation, the operator must:

1. Verify the selected database/connection is the intended Production database,
   not Development or another `neondb`. The name alone is insufficient. The
   transaction additionally requires the exact approved schema and all 24 table
   row counts/fingerprints, including ownership, metadata and protected resources.
2. Reconfirm PITR is enabled, the chosen pre-operation timestamp is within its
   available history, and the operator has access to perform recovery.
   If the UI/provider cannot establish coverage for that timestamp, **stop**:
   obtain confirmation or a separately verified logical backup first.
3. Record an exact timestamp immediately before cleanup, preferably using the
   database's UTC clock (`SELECT clock_timestamp()`), and retain it outside the
   database. The supplied SQL requires an explicit offset and a point within
   the preceding 15 minutes. Berlin is UTC+02:00 on 13 October 2026; use the
   offset applicable at actual execution, not a permanently fixed offset.
4. Ensure no application writes, uploads, deletes, import/analysis work or
   transfers are in progress. Do not introduce setting changes or deploy as
   part of this preparation. Quiescence needs an operator-controlled maintenance
   window before eventual execution.

An additional logical export is optional if these conditions are verified and
database-wide recovery is acceptable. It is needed as an alternative if PITR
coverage/access cannot be confirmed. A checksum or manifest alone is not a
backup; verify any export can be read and restored in an isolated environment.
Never put credentials or backup contents in chat or Git.

### Recovery limitations

- Before commit, any SQL error aborts the transaction; explicitly `ROLLBACK`
  in the same session. The prepared file ends in rollback even on success.
- After a separately approved commit, PITR restores the **whole database** to
  the recorded time, not selected deleted records. Legitimate later writes
  would also be rewound; quiescence is important.
- PITR does not restore application code or physical objects. No code/schema
  change is part of this cleanup, and all Replit/R2 objects are retained.
- Recover before the timestamp ages out of the 7-day window. Do not initiate a
  restore now. After any later recovery, verify the original 209 media, four
  events, 37 accounts, three series, connection and document against the manifest.

## Prepared transaction

File: `generated-artifacts/launch/production-cleanup-PREPARED-ONLY.sql`.

The source-controlled `docs/production-cleanup-approved-snapshot.json` freezes
the approved IDs and all table/schema fingerprints, without raw records or
credentials. Its values were checked against the original independently audited
Production manifest. It is not a backup. This allows regeneration after merging
the preparation work, without depending on ignored temporary audit files.

Offline preparation command:

```sh
node --import tsx scripts/prepare-production-cleanup.mjs
```

This command only reads the exact approved local manifest and writes SQL. It
has no database client, execution mode, storage SDK or deployment hook. A
changed manifest fails its pinned SHA-256 check rather than broadening scope.

**The SQL has not been executed against Production, including as a rehearsal.**
Execute only the whole file in a single operator-controlled Production session.
For `psql`, use `-v ON_ERROR_STOP=1`; use only a client that preserves one
connection for the entire transaction. Never split it across independent query
callbacks or select individual destructive statements.

All three operator confirmations default to `false`, the recovery timestamp is
empty, and the final statement is **ROLLBACK**. Fill the confirmations only
after performing the checks above. A successful rehearsal reports transactional
counts, then rolls back. It is not a completed cleanup.

The transaction:

- Takes bounded write locks; fails rather than bypassing lock contention.
- Checks database name, table inventory, full schema/constraints/triggers and
  every approved table fingerprint **before** mutation. Any drift requires
  renewed approval, including changed sessions/accounts—not relaxed guards.
- Rejects unreviewed incoming cross-schema foreign keys.
- Deletes exactly 205 analysis jobs, 209 import files, one import job, two likes,
  one favorite, one download-history row, one download operation, 209 media and
  events 29/30/31. Each actual deletion count must match or everything aborts.
- Retains 224, changing only visibility, hidden flag, cover and thumbnail.
  It asserts all other container metadata is identical.
- Rechecks all untouched table fingerprints, including all users/authentication,
  series, document 48 and the encrypted Nextcloud connection.
- Uses database DML only, no application deletion routes, source-object calls,
  schema changes, sequence resets or queued cleanup.

Expected results **inside** the transaction: media **0**, event IDs **[224]**,
users **37**, series **3**, document **1**, connection **1**.

For a future actual cleanup, a deliberate operator decision would replace the
final rollback with commit only after all prerequisites and approval remain
valid. Record the timestamp and actual counts, then independently verify the
committed state. No such execution is authorized by this preparation request.

## Sources and verification

- [Replit: Data recovery](https://docs.replit.com/features/data-and-storage/data-recovery)
  — consulted 13 October 2026; Production PITR, retention and code/database
  recovery boundaries.
- Operator's settings inspection: enabled PITR, 7 days, Berlin timestamp dialog;
  no restore or setting changes performed.
- Independently verified Production manifest; no differences found during the
  preceding read-only recheck. Execution-time fingerprint guards remain required.
- Local disposable PostgreSQL checks passed: missing gates, account drift,
  mismatched child deletion scope and unintended protected-record deletion all
  abort; a successful rehearsal leaves all original fixture tables unchanged.
  These tests prove transaction behavior, not Production PITR restorability.
