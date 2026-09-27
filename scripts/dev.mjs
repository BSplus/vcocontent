import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const modules = join(root, "node_modules");
const lock = join(modules, ".package-lock.json");
const installing = process.env.DEV_INSTALL_MARKER || join(root, ".post-merge-installing");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function signature() {
  try {
    const [directory, manifest] = await Promise.all([stat(modules), stat(lock)]);
    return `${directory.ino}:${manifest.ino}:${manifest.mtimeMs}:${manifest.size}`;
  } catch {
    return null;
  }
}

async function isInstalling() {
  try {
    await stat(installing);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

let child;
let stopping = false;
let exiting = false;

async function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  stopping = true;
  const running = child;
  running.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => running.once("exit", resolve)),
    sleep(5000).then(() => {
      if (running.exitCode === null && running.signalCode === null) running.kill("SIGKILL");
    }),
  ]);
  child = undefined;
  stopping = false;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    exiting = true;
    void stopChild().then(() => process.exit(0));
  });
}

// npm ci replaces node_modules while a running Vite process still holds references
// to the old optimizer. Never reuse that process after the dependency tree changes.
while (!exiting) {
  let current = await signature();
  if (!current || await isInstalling()) {
    if (child) {
      console.log("Dependencies are being rebuilt; stopping the development server");
      await stopChild();
    }
    await sleep(200);
    continue;
  }

  if (!child) {
    // Require the manifest to remain stable before loading modules again.
    await sleep(500);
    if (current !== await signature() || await isInstalling()) continue;
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
      if (!stopping && !exiting) {
        console.error(`Development server exited unexpectedly (${signal ?? code})`);
        process.exitCode = code || 1;
        exiting = true;
      }
    });
    console.log("Development server started with current dependencies");
  } else if (current !== await signature() || await isInstalling()) {
    console.log("Dependency change detected; restarting the development server");
    await stopChild();
  }
  await sleep(200);
}