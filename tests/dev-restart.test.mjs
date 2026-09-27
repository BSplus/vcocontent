import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test("development server stops during install and starts fresh afterward", { timeout: 45000 }, async () => {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  socket.close();
  await once(socket, "close");

  const marker = join(tmpdir(), `vco-install-${randomUUID()}`);
  const child = spawn(process.execPath, ["scripts/dev.mjs"], {
    env: { ...process.env, PORT: String(port), DEV_INSTALL_MARKER: marker },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", chunk => { output = (output + chunk.toString()).slice(-10000); });
  const base = `http://127.0.0.1:${port}/auth`;
  async function waitFor(condition, description) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Supervisor exited: ${output}`);
      if (await condition()) return;
      await sleep(150);
    }
    throw new Error(`${description}: ${output}`);
  }
  async function serving() {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1000) });
      return response.status === 200 && (await response.text()).includes("/src/main.tsx");
    } catch { return false; }
  }
  try {
    await waitFor(() => serving(), "Initial server did not serve HTML");
    await writeFile(marker, "");
    await waitFor(() => Promise.resolve(output.includes("Dependencies are being rebuilt; stopping the development server")), "Install marker was not detected");
    await waitFor(async () => !(await serving()), "Old Vite server kept serving during install");
    await unlink(marker);
    await waitFor(() => serving(), "Fresh Vite server did not start");
    assert.match(output, /Development server started with current dependencies/g);
    assert.equal(output.match(/Development server started with current dependencies/g)?.length, 2, output);
  } finally {
    await unlink(marker).catch(error => { if (error.code !== "ENOENT") throw error; });
    child.kill("SIGTERM");
    if (child.exitCode === null) await once(child, "exit");
  }
});