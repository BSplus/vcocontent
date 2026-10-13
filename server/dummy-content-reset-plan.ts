// Read-only planning only. No storage client, global DB, apply/restore or startup hook.
type Client = { query: (text:string,values?:any[])=>Promise<{rows:any[]}> };
const name = (s:string) => {
  if(!/^[a-z_][a-z0-9_]*$/.test(s))throw new Error("Unexpected database identifier");
  return `"${s}"`;
};
const removable = new Set(["media_items","events","event_entries","creator_event_associations",
  "community_likes","community_favorites","download_history","download_operations",
  "media_analysis_jobs","nextcloud_files","nextcloud_jobs"]);
const protectedChildren = new Set(["reference_documents","nextcloud_sources"]);
export const tableDigest = (t:string) => `select count(*)::int as n,
  encode(sha256(convert_to(coalesce(string_agg(h,',' order by h),''),'UTF8')),'hex') as digest
  from (select encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h from ${name(t)} r) hashes`;
export const resetSchemaDigest = `select encode(sha256(convert_to(coalesce(string_agg(v,',' order by v),''),'UTF8')),'hex') as digest from (
 select 'column:'||table_name||':'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as v
 from information_schema.columns where table_schema='public'
 union all select 'constraint:'||c.relname||':'||pg_get_constraintdef(x.oid)
 from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
 union all select 'trigger:'||c.relname||':'||pg_get_triggerdef(t.oid)
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and not t.tgisinternal) definitions`;

export async function inspectDummyContentReset(client:Client) {
  const database=(await client.query("select current_database() as name")).rows[0].name;
  const media=(await client.query("select id from media_items order by id")).rows.map(r=>r.id);
  const events=(await client.query("select id from events order by id")).rows.map(r=>r.id);
  const tables=(await client.query("select table_name as name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).rows.map(r=>r.name);
  const snapshots:Record<string,{n:number,digest:string}>={};
  for(const t of tables)snapshots[t]=(await client.query(tableDigest(t))).rows[0];
  const schemaDigest=(await client.query(resetSchemaDigest)).rows[0].digest;
  const dependencies=(await client.query(`select cl.relname as child,a.attname as child_column,
    pr.relname as parent,pg_get_constraintdef(x.oid) as definition from pg_constraint x
    join pg_class cl on cl.oid=x.conrelid join pg_namespace n on n.oid=cl.relnamespace
    join pg_class pr on pr.oid=x.confrelid join pg_attribute a on a.attrelid=x.conrelid and a.attnum=x.conkey[1]
    where x.contype='f' and n.nspname='public' and pr.relname in('events','media_items')
    order by child,child_column`)).rows;
  const blockers:string[]=[];
  for(const fk of dependencies) {
    const ids=fk.parent==="events"?events:media;
    const n=(await client.query(`select count(*)::int as n from ${name(fk.child)} where ${name(fk.child_column)}=any($1::int[])`,[ids])).rows[0].n;
    fk.rows=n;
    if(protectedChildren.has(fk.child)) {
      if(n)blockers.push(`${fk.child}: ${n} protected event dependencies`);
    }
    else if(!removable.has(fk.child)&&fk.child!=="transactional_emails")
      blockers.push(`Unclassified foreign-key dependency: ${fk.child}.${fk.child_column}`);
    const reviewedNull = fk.child==="nextcloud_files"&&fk.child_column==="media_id"&&fk.parent==="media_items"&&/ON DELETE SET NULL/.test(fk.definition);
    if(!/ON DELETE CASCADE/.test(fk.definition)&&!reviewedNull)blockers.push(`Unexpected delete rule: ${fk.child}.${fk.child_column}`);
  }
  for(const t of ["media_cleanup","media_reservations","media_object_routes"])
    if(snapshots[t]?.n)blockers.push(`${t}: must be empty to retain all physical objects`);
  const active=(await client.query(`select
    (select count(*) from media_analysis_jobs where status in('queued','running'))+
    (select count(*) from nextcloud_jobs where worker_token is not null or status in('pending','running')) as n`)).rows[0].n;
  if(Number(active))blockers.push("Active analysis/import work must settle");
  const triggers=(await client.query(`select count(*)::int as n from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public'`)).rows[0].n;
  if(triggers)blockers.push("Non-internal database triggers require review");
  const outside=(await client.query(`with refs as(
    select url as ref from media_items union select thumbnail from media_items
    union select '/api/media/legacy/'||id||'/file' from media_items
    union select '/api/media/legacy/'||id||'/thumbnail' from media_items)
    select (select count(*) from users where profile_image in(select ref from refs))+
    (select count(*) from series where logo in(select ref from refs)) as n`)).rows[0].n;
  if(Number(outside))blockers.push("Preserved profile/series images reference dummy media");
  const reviews=(await client.query(`select count(*)::int as n from safety_reviews
    where (resource='media' and resource_id=any($1::int[])) or
      (resource in('event','gallery') and resource_id=any($2::int[]))`,[media,events])).rows[0].n;
  const notifications=(await client.query("select count(*)::int as n from transactional_emails where gallery_id=any($1::int[])",[events])).rows[0].n;
  return {version:1,database,schemaDigest,media,events,snapshots,dependencies,blockers,reviews,notifications,
    preserved:"All users, roles, authentication, series, private documents, saved integrations, global settings and physical objects"};
}
export function renderDevelopmentResetSQL(plan:Awaited<ReturnType<typeof inspectDummyContentReset>>) {
  if(plan.database!=="heliumdb"||plan.blockers.length)throw new Error("Reset plan blocked; no executable SQL");
  if(!/^[0-9a-f]{64}$/.test(plan.schemaDigest))throw new Error("Invalid schema snapshot");
  for(const id of [...plan.media,...plan.events])if(!Number.isSafeInteger(id)||id<1)throw new Error("Invalid target ID");
  const array=(ids:number[])=>`ARRAY[${ids.join(",")}]::int[]`;
  const checks=Object.entries(plan.snapshots).map(([t,s])=>{
    if(!/^[0-9a-f]{64}$/.test(s.digest)||!Number.isSafeInteger(s.n))throw new Error("Invalid snapshot");
    return `IF (SELECT digest FROM (${tableDigest(t)}) d) <> '${s.digest}' THEN RAISE EXCEPTION 'Snapshot changed: ${t}'; END IF;`;
  }).join("\n");
  return `-- PREPARED ONLY; execution requires separate explicit approval and a verified database backup.
-- Development only. No object deletions, storage APIs, user deletes, sequences, DDL or archive.
-- Defaults to ROLLBACK. After approved review, COMMIT must be an explicit operator decision.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=public,pg_catalog;
LOCK TABLE ${Object.keys(plan.snapshots).map(name).join(",")} IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
IF current_database() <> 'heliumdb' THEN RAISE EXCEPTION 'Development database mismatch'; END IF;
IF (SELECT digest FROM (${resetSchemaDigest}) d) <> '${plan.schemaDigest}' THEN RAISE EXCEPTION 'Schema/dependencies changed'; END IF;
${checks}
END $guard$;
DELETE FROM safety_reviews WHERE (resource='media' AND resource_id=ANY(${array(plan.media)}))
 OR (resource IN('event','gallery') AND resource_id=ANY(${array(plan.events)}));
DELETE FROM media_items WHERE id=ANY(${array(plan.media)});
DELETE FROM events WHERE id=ANY(${array(plan.events)});
-- Known reviewed child rows cascade; event covers disappear with their dummy parents.
SELECT (SELECT count(*) FROM media_items) AS remaining_media,(SELECT count(*) FROM events) AS remaining_events;
ROLLBACK;
`;
}
