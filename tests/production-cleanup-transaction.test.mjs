import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderProductionCleanup } from "../scripts/prepare-production-cleanup.mjs";
import { tableDigest, resetSchemaDigest } from "../server/dummy-content-reset-plan.ts";

test("offline operator preparation survives a clean workspace and rejects changed approval",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"vco-offline-cleanup-"));
  const source=await readFile("docs/production-cleanup-approved-snapshot.json");
  const exec=promisify(execFile);
  const script=resolve("scripts/prepare-production-cleanup.mjs");
  const args=["--import",import.meta.resolve("tsx"),script];
  try {
    await mkdir(join(directory,"docs"));
    await writeFile(join(directory,"docs/production-cleanup-approved-snapshot.json"),source);
    const result=await exec(process.execPath,args,{cwd:directory});
    assert.equal(JSON.parse(result.stdout).productionExecuted,false);
    const file=join(directory,"generated-artifacts/launch/production-cleanup-PREPARED-ONLY.sql");
    const sql=await readFile(file,"utf8");
    assert.match(sql,/ROLLBACK;\s*$/);
    const changed=JSON.parse(source);changed.snapshots.users.n=38;
    await writeFile(join(directory,"docs/production-cleanup-approved-snapshot.json"),JSON.stringify(changed));
    await assert.rejects(exec(process.execPath,args,{cwd:directory}),/Approved manifest changed/);
    assert.equal(await readFile(file,"utf8"),sql,"Failed preparation cannot replace the frozen SQL");
    await assert.rejects(exec(process.execPath,[...args,"--execute"],{cwd:directory}),/no execution mode/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test("Production operator SQL: local rehearsal, rollback, gates, drift and protected postconditions",async()=>{
  // Never connect to either real environment. The existing runner owns this PG.
  const target=new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname,"127.0.0.1");
  assert.equal(target.port,process.env.VCO_TEST_PG_PORT);
  assert.equal(target.pathname,"/photo_test");
  const admin=new pg.Client({connectionString:target.href});
  await admin.connect();
  await admin.query("CREATE DATABASE neondb");
  target.pathname="/neondb";
  const c=new pg.Client({connectionString:target.href});
  await c.connect();
  try {
    const cascading="REFERENCES events(id) ON DELETE CASCADE";
    const media="REFERENCES media_items(id) ON DELETE CASCADE";
    await c.query(`
      CREATE TABLE events(id int PRIMARY KEY,creator_id int,series_id int,visibility text,
        admin_hidden boolean,cover_image text,custom_thumbnail text,title text);
      CREATE TABLE media_items(id int PRIMARY KEY,event_id int ${cascading},owner_id int,tags text);
      CREATE TABLE users(id int PRIMARY KEY,role text,authentication text);
      CREATE TABLE series(id int PRIMARY KEY,title text);
      CREATE TABLE reference_documents(id int PRIMARY KEY,event_id int ${cascading},payload text);
      CREATE TABLE nextcloud_sources(event_id int PRIMARY KEY ${cascading},encrypted text);
      CREATE TABLE media_analysis_jobs(id int PRIMARY KEY,media_id int ${media});
      CREATE TABLE nextcloud_files(id int PRIMARY KEY,event_id int ${cascading},
        media_id int REFERENCES media_items(id) ON DELETE SET NULL);
      CREATE TABLE nextcloud_jobs(id int PRIMARY KEY,event_id int ${cascading});
      CREATE TABLE community_likes(id int PRIMARY KEY,media_id int ${media},event_id int ${cascading});
      CREATE TABLE community_favorites(id int PRIMARY KEY,media_id int ${media},event_id int ${cascading});
      CREATE TABLE download_history(id int PRIMARY KEY,media_id int ${media});
      CREATE TABLE download_operations(id int PRIMARY KEY,media_id int ${media});
      ${["beta_rate_limits","creator_event_associations","creator_follows","email_verifications",
        "event_entries","media_cleanup","media_reservations","safety_results","safety_reviews",
        "session","transactional_emails"].map(t=>`CREATE TABLE "${t}"(id int PRIMARY KEY,payload text);`).join("\n")}
      INSERT INTO users SELECT n,'preserved-role','synthetic-auth' FROM generate_series(1,37) n;
      INSERT INTO series SELECT n,'preserved-series' FROM generate_series(1,3) n;
      INSERT INTO events VALUES
        (29,6,NULL,'published',false,NULL,NULL,'dummy'),
        (30,10,NULL,'published',false,NULL,NULL,'dummy'),
        (31,16,NULL,'published',false,NULL,NULL,'dummy'),
        (224,NULL,1,'published',false,'obsolete-cover','obsolete-thumbnail','preserved-container');
      INSERT INTO media_items SELECT n,CASE WHEN n<172 THEN 29 WHEN n<592 THEN 31 ELSE 224 END,
        CASE WHEN n<592 THEN 6 ELSE NULL END,'synthetic-AI-tags'
        FROM (SELECT generate_series(170,173) n UNION ALL SELECT generate_series(592,796)) m;
      INSERT INTO reference_documents VALUES(48,224,'protected-reference');
      INSERT INTO nextcloud_sources VALUES(224,'synthetic-encrypted-connection');
      INSERT INTO media_analysis_jobs SELECT n,n+591 FROM generate_series(1,205) n;
      INSERT INTO nextcloud_files SELECT n,224,592 FROM generate_series(1,209) n;
      INSERT INTO nextcloud_jobs VALUES(1,224);
      INSERT INTO community_likes VALUES(1,NULL,224),(2,592,NULL);
      INSERT INTO community_favorites VALUES(1,NULL,224);
      INSERT INTO download_history VALUES(1,592);
      INSERT INTO download_operations VALUES(1,592);
    `);
    const names=(await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")).rows.map(r=>r.table_name);
    const snapshots={};
    for(const t of names)snapshots[t]=(await c.query(tableDigest(t))).rows[0];
    const plan={database:"neondb",media_ids:[170,171,172,173,...Array.from({length:205},(_,i)=>592+i)],
      delete_event_ids:[29,30,31],preserve_event_ids:[224],reference_document_ids:[48],
      connection_event_ids:[224],blockers:[],guards:{active_workers:0},
      schema_digest:(await c.query(resetSchemaDigest)).rows[0].digest,snapshots};
    const prepared=renderProductionCleanup(plan);
    assert.match(prepared,/ROLLBACK;\s*$/);
    assert.doesNotMatch(prepared,/DELETE FROM "?users|ALTER TABLE|TRUNCATE|CREATE TABLE|COMMIT;/);
    assert.throws(()=>renderProductionCleanup({...plan,database:"heliumdb"}));
    assert.throws(()=>renderProductionCleanup({...plan,delete_event_ids:[29,30,31,224]}));
    assert.throws(()=>renderProductionCleanup({...plan,media_ids:[...plan.media_ids,999]}));
    const rollback=()=>c.query("ROLLBACK");
    await assert.rejects(c.query(prepared),/confirmations missing/);
    await rollback();
    const ready=prepared.replaceAll("'false',true","'true',true")
      .replace("'vco_cleanup.recovery_timestamp',''","'vco_cleanup.recovery_timestamp','"+new Date(Date.now()-30_000).toISOString()+"'");
    const result=await c.query(ready);
    const summary=result.find(r=>r.rows?.[0]?.remaining_media==="0")?.rows[0];
    assert.deepEqual(summary,{remaining_media:"0",remaining_event_ids:[224],
      preserved_users:"37",preserved_series:"3",preserved_document:"1",preserved_connection:"1"});
    for(const t of names)assert.deepEqual((await c.query(tableDigest(t))).rows[0],snapshots[t],"Rehearsal restores "+t);
    // A changed account/auth row must block before deletion.
    await c.query("UPDATE users SET role='changed-role' WHERE id=37");
    await assert.rejects(c.query(ready),/fingerprint mismatch: users/);
    await rollback();
    await c.query("UPDATE users SET role='preserved-role' WHERE id=37");
    // Fault injection is strictly on this disposable database: postconditions
    // must detect an unintended protected deletion and roll back everything.
    const fault=ready.replace("IF (SELECT count(*) FROM events)<>1",
      "DELETE FROM reference_documents WHERE id=48;\n  IF (SELECT count(*) FROM events)<>1");
    await assert.rejects(c.query(fault),/fingerprint mismatch: reference_documents/);
    await rollback();
    for(const t of names)assert.deepEqual((await c.query(tableDigest(t))).rows[0],snapshots[t]);
    // Full-table count alone cannot legitimize a child outside the allowed scope.
    await c.query("UPDATE media_analysis_jobs SET media_id=NULL WHERE id=205");
    const bad={...plan,snapshots:{...snapshots,
      media_analysis_jobs:(await c.query(tableDigest("media_analysis_jobs"))).rows[0]}};
    const wrongScope=renderProductionCleanup(bad).replaceAll("'false',true","'true',true")
      .replace("'vco_cleanup.recovery_timestamp',''","'vco_cleanup.recovery_timestamp','"+new Date(Date.now()-30_000).toISOString()+"'");
    await assert.rejects(c.query(wrongScope),/Unexpected deletion count: media_analysis_jobs: 204/);
    await rollback();
    assert.equal((await c.query("SELECT count(*) AS n FROM media_items")).rows[0].n,"209");
  } finally {await c.query("ROLLBACK");await c.end();await admin.end();}
});
