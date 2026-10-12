// Explicit opt-in, bounded repetitions of unchanged pixels/first observations.
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fixtures as natural} from "../tests/fixtures/motorsport/reviewed.mjs";
import {fixtures as controls} from "../tests/fixtures/motorsport/controls.mjs";
import {evaluateRecognition} from "../tests/helpers/recognition-evaluation.mjs";
import {verifyPhotoObservations,NUMBER_AUDIT_MODEL} from "../server/utils/photo-number-evidence.ts";
import {localizePhotoNumbers} from "../server/utils/photo-number-localizer.ts";
import {withVisionBudget} from "../server/ai-budget.ts";
import {pool} from "../server/db.ts";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
try {
  if(!process.argv.includes("--live"))throw new Error("Pass --live to authorize bounded managed requests");
  const input=async flag=>{
    const i=process.argv.indexOf(flag);
    if(i<0)throw new Error("Both baseline reports are required");
    return JSON.parse(await readFile(process.argv[i+1],"utf8"));
  };
  const baseline=await input("--baseline"),control=await input("--control-baseline");
  const selected=["partial-number","formula-cockpit","live-618","multiple-readable","stock-89","dual-007"];
  const samples=[];
  for(const id of selected) {
    const fixture=[...natural,...controls].find(f=>f.id===id);
    const before=(id==="dual-007"?control:baseline).samples.find(s=>s.id===id);
    const bytes=await readFile(new URL(`../tests/fixtures/motorsport/${fixture.file}`,import.meta.url));
    if(!before?.result || before.imageSha256!==fixture.sha256 || sha(bytes)!==fixture.sha256)
      throw new Error("Unreviewed or missing baseline pixels");
    samples.push({fixture,before,bytes});
  }
  const results=[];
  const source=await readFile(new URL("../server/utils/photo-number-evidence.ts",import.meta.url));
  const redaction=await readFile(new URL("../server/utils/photo-redaction.ts",import.meta.url));
  await mkdir("generated-artifacts/recognition",{recursive:true});
  for(let repetition=1;repetition<=3;repetition++)for(const {fixture,before,bytes} of samples) {
    try {
      const vehicles=await withVisionBudget(async()=>{
        const image="data:image/webp;base64,"+bytes.toString("base64");
        const anchored=(await localizePhotoNumbers(image,before.result.vehicles,true)).vehicles;
        return verifyPhotoObservations(image,anchored);
      });
      const result={...before.result,vehicles},issues=evaluateRecognition(fixture,result);
      // Keep full checks recorded. Report task-specific number/identity checks
      // separately, never rename motif omissions as full-quality passes.
      const numberIdentityIssues=issues.filter(i=>!i.startsWith("Missing visible tag:"));
      results.push({id:fixture.id,repetition,imageSha256:fixture.sha256,result,issues,numberIdentityIssues});
      console.log(fixture.id,repetition,numberIdentityIssues.length ? numberIdentityIssues.join("; ") : "number/identity checks pass");
    } catch(error) {
      const known=["Unexpected panel crop","Unexpected vehicle crop","Incomplete number audit","Incomplete number localization",
        "Number-panel OCR failed","Number-panel OCR deadline exceeded","Number-panel complexity limit exceeded"];
      const reason=known.includes(error?.message)?error.message:error?.name==="ZodError"?"Invalid recognition contract":
        error?.name==="VisionBusy"?"Vision budget busy":"Recognition unavailable";
      results.push({id:fixture.id,repetition,numberIdentityIssues:[reason]});
      console.log(fixture.id,repetition,reason);
    }
    await writeFile("generated-artifacts/recognition/tile-stress.json",JSON.stringify({
      evaluatedAt:new Date().toISOString(),model:NUMBER_AUDIT_MODEL,numberAuditSourceSha256:sha(source),redactionSourceSha256:sha(redaction),
      ocrSourceSha256:sha(await readFile(new URL("../server/utils/photo-number-panels.ts",import.meta.url))),
      localizerSourceSha256:sha(await readFile(new URL("../server/utils/photo-number-localizer.ts",import.meta.url))),
      caveat:"Frozen pixel/first-result repetitions, not a population accuracy claim or production reanalysis.",
      samples:results,
    },null,2)+"\n");
  }
  if(results.some(r=>r.numberIdentityIssues.length))process.exitCode=1;
} catch {
  console.error("Bounded number-evidence stress evaluation could not be completed");
  process.exitCode=1;
} finally {await pool.end();}
