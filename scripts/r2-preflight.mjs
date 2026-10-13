// No bucket creation/configuration, no production operations, isolated probe only.
import { mkdir, writeFile } from "node:fs/promises";
import { runDevelopmentProbe } from "../server/r2-development-probe.ts";
const report=await runDevelopmentProbe({
  authorized:process.argv.includes("--approved-development-connectivity"),
});
await mkdir("generated-artifacts/r2",{recursive:true});
await writeFile("generated-artifacts/r2/preflight.json",JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify(report,null,2));
if(report.connectivity!=="PASS")process.exitCode=1;
