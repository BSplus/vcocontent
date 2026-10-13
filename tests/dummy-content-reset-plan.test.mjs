import test from "node:test";
import assert from "node:assert/strict";
import { inspectDummyContentReset,renderDevelopmentResetSQL } from "../server/dummy-content-reset-plan.ts";
const digest="a".repeat(64);
function client({protectedRows=0,unknown=false,routeRows=0}={}) {
  const calls=[];
  return {calls,async query(sql,values){
    calls.push(sql);
    assert.ok(/^select|^with/i.test(sql.trim()),"Inspector must never issue writes");
    if(sql.includes("current_database"))return {rows:[{name:"heliumdb"}]};
    if(sql==="select id from media_items order by id")return {rows:[{id:7}]};
    if(sql==="select id from events order by id")return {rows:[{id:3}]};
    if(sql.includes("table_type='BASE TABLE'"))return {rows:["events","media_items","users","media_object_routes"].map(name=>({name}))};
    if(sql.includes("from pg_constraint x")&&sql.includes("as child"))return {rows:[
      {child:"reference_documents",child_column:"event_id",parent:"events",definition:"FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE"},
      {child:"nextcloud_sources",child_column:"event_id",parent:"events",definition:"FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE"},
      {child:"nextcloud_files",child_column:"media_id",parent:"media_items",definition:"FOREIGN KEY (media_id) REFERENCES media_items(id) ON DELETE SET NULL"},
      ...(unknown?[{child:"unexpected_child",child_column:"event_id",parent:"events",definition:"ON DELETE CASCADE"}]:[])]};
    if(sql.includes('from "reference_documents" where')||sql.includes('from "nextcloud_sources" where'))return {rows:[{n:protectedRows}]};
    if(sql.includes("from pg_trigger"))return {rows:[{n:0,digest}]};
    if(sql.includes("from (select encode"))return {rows:[{n:sql.includes('"media_object_routes"')?routeRows:1,digest}]};
    return {rows:[{n:0}]};
  }};
}
test("read-only reset preparation preserves users and objects; SQL is frozen, Development-only and rollback by default",async()=>{
  const c=client(),plan=await inspectDummyContentReset(c);
  assert.deepEqual(plan.blockers,[]);
  const sql=renderDevelopmentResetSQL(plan);
  assert.match(sql,/current_database\(\) <> 'heliumdb'/);
  assert.match(sql,/Schema\/dependencies changed/);
  assert.match(sql,/Snapshot changed: users/);
  assert.match(sql,/DELETE FROM media_items WHERE id=ANY\(ARRAY\[7\]::int\[\]\)/);
  assert.match(sql,/DELETE FROM events WHERE id=ANY\(ARRAY\[3\]::int\[\]\)/);
  assert.match(sql,/ROLLBACK;\s*$/);
  assert.doesNotMatch(sql,/DELETE FROM users|TRUNCATE|ALTER TABLE|DROP TABLE|UPDATE users/);
  assert.throws(()=>renderDevelopmentResetSQL({...plan,database:"neondb"}),/blocked/);
});
test("reference/connection cascades, unknown children and outstanding object work block reset SQL",async()=>{
  for(const options of [{protectedRows:1},{unknown:true},{routeRows:1}]){
    const plan=await inspectDummyContentReset(client(options));
    assert.ok(plan.blockers.length);
    assert.throws(()=>renderDevelopmentResetSQL(plan),/blocked/);
  }
});
