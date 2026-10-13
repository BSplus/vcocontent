import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const replit = await readFile(new URL("../.replit", import.meta.url), "utf8");
const deployment = replit.split("[deployment]")[1].split(/\n\s*\[/)[0];
const run = JSON.parse(deployment.match(/^run\s*=\s*(\[.*\])/m)[1]);
const expected = ["env", "-u", "R2_DEV_ACCESS_KEY_ID", "-u", "R2_DEV_SECRET_ACCESS_KEY", "npm", "run", "start"];

test("Publishing starts the existing Production application with only Development R2 names excluded", () => {
  assert.deepEqual(run, expected);
  assert.match(deployment, /^build = \["npm", "run", "build"\]$/m);
  assert.match(deployment, /^deploymentTarget = "vm"$/m);
});

test("actual launch prefix isolates synthetic Production credentials while retaining every safety gate", () => {
  // Deliberately no inherited credentials, database connection, SDK transport or server startup.
  const child = `
    import assert from "node:assert/strict";
    import {r2Config, ObjectStoreError} from "./server/object-store.ts";
    import {routingEnabled, assertNewMediaUploadsEnabled} from "./server/media-object-routing.ts";
    import {mediaDatabaseFingerprint} from "./server/media-storage-config.ts";
    assert.equal(Object.hasOwn(process.env, "R2_DEV_ACCESS_KEY_ID"), false);
    assert.equal(Object.hasOwn(process.env, "R2_DEV_SECRET_ACCESS_KEY"), false);
    assert.equal(process.env.R2_PROD_ACCESS_KEY_ID, "synthetic-production-access");
    assert.equal(process.env.R2_PROD_SECRET_ACCESS_KEY, "synthetic-production-secret");
    assert.equal(process.env.SESSION_SECRET, "synthetic-session-preserved");
    assert.equal(process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED, "false");
    process.env.MEDIA_STORAGE_DATABASE_FINGERPRINT = mediaDatabaseFingerprint(process.env.DATABASE_URL);
    assert.equal(r2Config().environment, "production");
    assert.equal(routingEnabled(), true);
    assert.throws(assertNewMediaUploadsEnabled, ObjectStoreError);
    assert.throws(() => routingEnabled({...process.env, MEDIA_STORAGE_DATABASE_FINGERPRINT: "0".repeat(64)}), ObjectStoreError);
    assert.throws(() => r2Config({...process.env, R2_PROD_SECRET_ACCESS_KEY: undefined}), ObjectStoreError);
    assert.throws(() => r2Config({...process.env, R2_BUCKET: "vco-content-media-dev"}), ObjectStoreError);
    assert.throws(() => r2Config({...process.env, R2_DEV_ACCESS_KEY_ID: ""}), ObjectStoreError);
    assert.throws(() => r2Config({...process.env, MEDIA_STORAGE_PRODUCTION_APPROVED: "false"}), ObjectStoreError);
    console.log("Synthetic Production launch isolation passed; no network access.");
  `;
  for (const value of ["", "synthetic-development-only"]) {
    const output = execFileSync(run[0], [
      ...run.slice(1, 5), process.execPath, "--import", "tsx", "--input-type=module", "-e", child,
    ], {
      cwd: new URL("../", import.meta.url),
      timeout: 20_000,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        REPLIT_DEPLOYMENT: "1",
        MEDIA_STORAGE_ENVIRONMENT: "production",
        MEDIA_STORAGE_PRODUCTION_APPROVED: "true",
        MEDIA_STORAGE_PROVIDER: "r2",
        MEDIA_STORAGE_ROUTING: "enabled",
        MEDIA_STORAGE_NEW_UPLOADS_ENABLED: "false",
        R2_PROD_WRITE_ENABLED: "true",
        R2_ACCOUNT_ID: "a".repeat(32),
        R2_BUCKET: "vco-content-media",
        R2_JURISDICTION: "eu",
        R2_STORAGE_CLASS: "Standard",
        R2_PROD_ACCESS_KEY_ID: "synthetic-production-access",
        R2_PROD_SECRET_ACCESS_KEY: "synthetic-production-secret",
        R2_DEV_ACCESS_KEY_ID: value,
        R2_DEV_SECRET_ACCESS_KEY: value,
        DATABASE_URL: "postgresql://synthetic:synthetic@example-production.invalid/neondb",
        SESSION_SECRET: "synthetic-session-preserved",
      },
    });
    assert.match(output, /Synthetic Production launch isolation passed/);
    assert.ok(!output.includes("synthetic-production-secret"));
    assert.ok(!output.includes("synthetic-development-only"));
  }
});

test("Development launch and the ordinary npm start command remain unchanged", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.dev, "node scripts/dev.mjs");
  assert.equal(pkg.scripts.start, "NODE_ENV=production node dist/index.js");
  assert.match(replit, /^run = "npm run dev"$/m);
  assert.match(replit, /\[userenv\.development\][\s\S]*MEDIA_STORAGE_ENVIRONMENT = "development"/);
});
