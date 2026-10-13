// Read-only Development audit/SQL preparation. Deliberately no apply mode.
import { mkdir,writeFile } from "node:fs/promises";
import { assertDevelopmentMediaTarget } from "../server/development-media-target.ts";
import { inspectDummyContentReset,renderDevelopmentResetSQL } from "../server/dummy-content-reset-plan.ts";
if(process.argv.length!==2)throw Error("Planning only: cleanup execution is not available in this CLI");
assertDevelopmentMediaTarget();
if(process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED!=="false")throw Error("Close the Development upload gate first");
const {pool}=await import("../server/db.ts");
const client=await pool.connect(),root="generated-artifacts/launch";
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const plan=await inspectDummyContentReset(client);
  await client.query("ROLLBACK");
  await mkdir(root,{recursive:true});
  await writeFile(`${root}/development-reset-plan.json`,JSON.stringify(plan,null,2),{mode:0o600});
  if(!plan.blockers.length)await writeFile(`${root}/development-reset-PREPARED-ONLY.sql`,renderDevelopmentResetSQL(plan),{mode:0o600});
  console.log(JSON.stringify({scope:"Development read-only",media:plan.media.length,events:plan.events.length,
    dependencies:plan.dependencies,blockers:plan.blockers,preserved:plan.preserved,sqlExecuted:false},null,2));
} finally {await client.query("ROLLBACK").catch(()=>{});client.release();await pool.end();}
