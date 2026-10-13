// One-time, offline SQL preparation. No database connection or execution mode.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { tableDigest, resetSchemaDigest } from "../server/dummy-content-reset-plan.ts";

const tables = [
  "beta_rate_limits", "community_favorites", "community_likes", "creator_event_associations",
  "creator_follows", "download_history", "download_operations", "email_verifications",
  "event_entries", "events", "media_analysis_jobs", "media_cleanup", "media_items",
  "media_reservations", "nextcloud_files", "nextcloud_jobs", "nextcloud_sources",
  "reference_documents", "safety_results", "safety_reviews", "series", "session",
  "transactional_emails", "users",
];
const mediaIds = [170,171,172,173,...Array.from({length:205},(_,i)=>592+i)];
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const array = ids => `ARRAY[${ids.join(",")}]::int[]`;
const children = [
  ["media_analysis_jobs",205,`media_id=ANY(${array(mediaIds)})`],
  ["nextcloud_files",209,"event_id=ANY(ARRAY[29,30,31,224]::int[])"],
  ["nextcloud_jobs",1,"event_id=ANY(ARRAY[29,30,31,224]::int[])"],
  ["community_likes",2,`media_id=ANY(${array(mediaIds)}) OR event_id=ANY(ARRAY[29,30,31,224]::int[])`],
  ["community_favorites",1,`media_id=ANY(${array(mediaIds)}) OR event_id=ANY(ARRAY[29,30,31,224]::int[])`],
  ["download_history",1,`media_id=ANY(${array(mediaIds)})`],
  ["download_operations",1,`media_id=ANY(${array(mediaIds)})`],
];
const changedTables = new Set(["events","media_items",...children.map(([t])=>t)]);

export function renderProductionCleanup(plan) {
  if(plan.database!=="neondb" || !same(plan.media_ids,mediaIds) ||
    !same(plan.delete_event_ids,[29,30,31]) || !same(plan.preserve_event_ids,[224]) ||
    !same(plan.reference_document_ids,[48]) || !same(plan.connection_event_ids,[224]) ||
    plan.blockers.length || Object.values(plan.guards).some(n=>n!==0) ||
    !same(Object.keys(plan.snapshots).sort(),tables) ||
    plan.snapshots.users.n!==37 || plan.snapshots.series.n!==3 ||
    plan.snapshots.events.n!==4 || plan.snapshots.media_items.n!==209)
    throw Error("Not the approved Production cleanup scope");
  for(const [t,n] of children)
    if(plan.snapshots[t].n!==n)throw Error(`Unexpected approved count: ${t}`);
  if(!/^[a-f0-9]{64}$/.test(plan.schema_digest))throw Error("Invalid schema fingerprint");
  for(const snapshot of Object.values(plan.snapshots))
    if(!/^[a-f0-9]{64}$/.test(snapshot.digest) || !Number.isSafeInteger(snapshot.n) || snapshot.n<0)
      throw Error("Invalid row fingerprint");
  const checks = (selected) => selected.map(t=>`
  SELECT n,digest INTO actual_n,actual_digest FROM (${tableDigest(t)}) snapshot;
  IF actual_n <> ${plan.snapshots[t].n} OR actual_digest <> '${plan.snapshots[t].digest}'
    THEN RAISE EXCEPTION 'Approved fingerprint mismatch: ${t}. Stop; renewed approval required.'; END IF;`).join("\n");
  const remove = (t,n,where) => `
  DELETE FROM "${t}" WHERE ${where};
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> ${n} THEN RAISE EXCEPTION 'Unexpected deletion count: ${t}: %',affected; END IF;
  RAISE NOTICE 'Deleted ${t}: %',affected;`;
  return `-- PREPARED ONLY. Never executed against Production by Agent.
-- Use one verified Production connection and execute this WHOLE file in one session.
-- For psql use -v ON_ERROR_STOP=1. Never split across independent query calls.
-- Target proof: operator connection verification + neondb + schema/all-table fingerprints.
-- All gates below deliberately false/empty. No credentials belong in this file.
-- Rehearsal ends in ROLLBACK. A later COMMIT requires a separate operator decision.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SELECT set_config('vco_cleanup.production_target_confirmed','false',true);
SELECT set_config('vco_cleanup.pitr_confirmed','false',true);
SELECT set_config('vco_cleanup.application_quiescent','false',true);
-- ISO 8601 with explicit UTC offset, e.g. ...Z or ...+02:00; no ambiguous local time.
SELECT set_config('vco_cleanup.recovery_timestamp','',true);

LOCK TABLE ${tables.map(t=>`public."${t}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE;
DO $cleanup$
DECLARE actual_n bigint; actual_digest text; affected bigint;
  recovery_point timestamptz; original_container jsonb;
BEGIN
  IF current_database()<>'neondb' THEN RAISE EXCEPTION 'Wrong database'; END IF;
  IF current_setting('vco_cleanup.production_target_confirmed')<>'true' OR
    current_setting('vco_cleanup.pitr_confirmed')<>'true' OR
    current_setting('vco_cleanup.application_quiescent')<>'true'
    THEN RAISE EXCEPTION 'Operator target/PITR/quiescence confirmations missing'; END IF;
  IF current_setting('vco_cleanup.recovery_timestamp') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
    THEN RAISE EXCEPTION 'Record a pre-cleanup recovery timestamp with explicit UTC offset'; END IF;
  recovery_point := current_setting('vco_cleanup.recovery_timestamp')::timestamptz;
  IF recovery_point>=transaction_timestamp() OR recovery_point<transaction_timestamp()-interval '15 minutes'
    THEN RAISE EXCEPTION 'Choose a confirmed recovery point immediately before this transaction (within 15 minutes)'; END IF;
  RAISE NOTICE 'Recovery point UTC: %',recovery_point AT TIME ZONE 'UTC';
  IF (SELECT array_agg(table_name::text ORDER BY table_name) FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE')
    IS DISTINCT FROM ARRAY[${tables.map(t=>`'${t}'`).join(",")}]::text[]
    THEN RAISE EXCEPTION 'Public table inventory changed'; END IF;
  IF (SELECT digest FROM (${resetSchemaDigest}) snapshot)<>'${plan.schema_digest}'
    THEN RAISE EXCEPTION 'Schema/constraints/triggers changed'; END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint fk JOIN pg_class parent ON parent.oid=fk.confrelid
    JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace cn ON cn.oid=child.relnamespace
    WHERE fk.contype='f' AND pn.nspname='public' AND parent.relname IN('events','media_items')
      AND cn.nspname<>'public')
    THEN RAISE EXCEPTION 'Unreviewed cross-schema dependency'; END IF;
${checks(tables)}
  IF EXISTS(SELECT 1 FROM reference_documents WHERE event_id IN(29,30,31)) OR
    EXISTS(SELECT 1 FROM nextcloud_sources WHERE event_id IN(29,30,31))
    THEN RAISE EXCEPTION 'Protected resource on deleted event'; END IF;
  IF (SELECT count(*) FROM reference_documents WHERE id=48 AND event_id=224)<>1 OR
    (SELECT count(*) FROM nextcloud_sources WHERE event_id=224)<>1
    THEN RAISE EXCEPTION 'Protected container resources missing'; END IF;
  SELECT to_jsonb(e)-ARRAY['visibility','admin_hidden','cover_image','custom_thumbnail']
    INTO original_container FROM events e WHERE id=224;
${children.map(([t,n,where])=>remove(t,n,where)).join("\n")}
${remove("media_items",209,`id=ANY(${array(mediaIds)})`)}
${remove("events",3,"id=ANY(ARRAY[29,30,31]::int[])")}
  UPDATE events SET visibility='draft',admin_hidden=true,cover_image=NULL,custom_thumbnail=NULL WHERE id=224;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Container update count mismatch'; END IF;
  IF (SELECT to_jsonb(e)-ARRAY['visibility','admin_hidden','cover_image','custom_thumbnail']
    FROM events e WHERE id=224) IS DISTINCT FROM original_container
    THEN RAISE EXCEPTION 'Unapproved container metadata change'; END IF;
  IF (SELECT count(*) FROM events)<>1 OR NOT EXISTS(SELECT 1 FROM events WHERE id=224
    AND visibility='draft' AND admin_hidden=true AND cover_image IS NULL AND custom_thumbnail IS NULL)
    THEN RAISE EXCEPTION 'Container postcondition failed'; END IF;
${["media_items",...children.map(([t])=>t)].map(t=>`
  IF EXISTS(SELECT 1 FROM "${t}") THEN RAISE EXCEPTION 'Unexpected remaining rows: ${t}'; END IF;`).join("\n")}
${checks(tables.filter(t=>!changedTables.has(t)))}
  IF (SELECT digest FROM (${resetSchemaDigest}) snapshot)<>'${plan.schema_digest}'
    THEN RAISE EXCEPTION 'Schema changed during cleanup'; END IF;
  RAISE NOTICE 'PASS inside transaction: 209 media + 3 events deleted; all protected rows unchanged';
END $cleanup$;
SELECT (SELECT count(*) FROM media_items) AS remaining_media,
  (SELECT array_agg(id ORDER BY id) FROM events) AS remaining_event_ids,
  (SELECT count(*) FROM users) AS preserved_users,
  (SELECT count(*) FROM series) AS preserved_series,
  (SELECT count(*) FROM reference_documents WHERE id=48 AND event_id=224) AS preserved_document,
  (SELECT count(*) FROM nextcloud_sources WHERE event_id=224) AS preserved_connection;
-- Results above are transactional only. This file does not persist cleanup.
ROLLBACK;
`;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.argv.length!==2)throw Error("Offline preparation only; no execution mode or alternate manifest");
  const source=await readFile("docs/production-cleanup-approved-snapshot.json");
  if(createHash("sha256").update(source).digest("hex")!=="cdca46aa8f8e9172b84a3aee86d2bdede8cde099e22646327d021beee9c02894")
    throw Error("Approved manifest changed; stop and obtain renewed approval");
  const file="generated-artifacts/launch/production-cleanup-PREPARED-ONLY.sql";
  await mkdir("generated-artifacts/launch",{recursive:true});
  await writeFile(file,renderProductionCleanup(JSON.parse(source)),{mode:0o600});
  console.log(JSON.stringify({file,productionExecuted:false,defaultsTo:"ROLLBACK",operatorGates:false}));
}
