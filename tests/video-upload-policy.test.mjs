import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

function videoPolicy(value) {
  const env = { ...process.env };
  delete env.MEDIA_VIDEO_MIB;
  if (value !== undefined) env.MEDIA_VIDEO_MIB = value;
  return Number(execFileSync(process.execPath, [
    "--import", "tsx", "--input-type=module", "-e",
    "import { mediaPolicy } from './server/media-policy.ts'; console.log(mediaPolicy.videoBytes);",
  ], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim());
}

test("video uploads default to 300 MiB", () => {
  assert.equal(videoPolicy(), 314_572_800);
});

test("explicit deployment video limits remain supported", () => {
  assert.equal(videoPolicy("50"), 50 * 1048576);
});

test("invalid video limits fail rather than silently changing policy", () => {
  for (const value of ["0", "-1", "300.5", "invalid"]) {
    assert.throws(() => videoPolicy(value));
  }
});
