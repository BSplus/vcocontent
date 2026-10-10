import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const source = `await import('./server/analysis-jobs.ts');
await (await import('./server/db.ts')).pool.end();`;
test("operator may lower the job budget but cannot raise the shared two-job ceiling", async () => {
  for (const value of ["1", "2", undefined]) {
    const env = { ...process.env };
    if (value === undefined) delete env.MEDIA_ANALYSIS_CONCURRENCY;
    else env.MEDIA_ANALYSIS_CONCURRENCY = value;
    await execute(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { env, timeout: 15000 });
  }
  for (const value of ["0", "3", "-1", "1.5", "invalid", ""]) {
    await assert.rejects(execute(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source],
      { env: { ...process.env, MEDIA_ANALYSIS_CONCURRENCY: value }, timeout: 15000 }),
    error => /MEDIA_ANALYSIS_CONCURRENCY must be 1 or 2/.test(error.stderr));
  }
});
