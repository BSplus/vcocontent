import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import ws from "ws";

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function uiBrowser({ startupTimeout = 60000 } = {}) {
  const profile = `/tmp/vco-click-targets-${randomUUID()}`;
  const child = spawn(process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let output = "";
  child.stderr.on("data", chunk => { output += chunk; });
  let socket;
  try {
    const deadline = Date.now() + startupTimeout;
    while (!output.match(/DevTools listening on (ws:\/\/\S+)/) && Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(output);
      await delay(100);
    }
    const endpoint = output.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
    assert.ok(endpoint, output);
    socket = new ws(endpoint);
    await once(socket, "open");
    let nextId = 0;
    const pending = new Map();
    const listeners = new Set();
    socket.on("message", bytes => {
      const message = JSON.parse(bytes.toString());
      if (message.id) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      } else listeners.forEach(listener => listener(message));
    });
    const send = async (method, params = {}, sessionId) => {
      const id = ++nextId;
      const reply = new Promise(resolve => pending.set(id, resolve));
      socket.send(JSON.stringify({ id, method, params, sessionId }));
      const result = await reply;
      if (result.error) throw new Error(`${method}: ${result.error.message}`);
      return result.result;
    };
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const command = (method, params) => send(method, params, sessionId);
    await command("Page.enable");
    await command("Runtime.enable");
    const evaluate = async expression => {
      const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = async expression => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try { if (await evaluate(expression)) return; }
        catch (error) { if (!/context|document|Uncaught/.test(String(error))) throw error; }
        await delay(100);
      }
      const state = await evaluate(`({path:location.pathname,text:document.body?.innerText?.slice(-1200),focus:document.activeElement?.outerHTML?.slice(0,300),menus:[...document.querySelectorAll('[role="menu"]')].map(m=>({state:m.dataset.state,text:m.textContent})),dialogs:document.querySelectorAll('[role="dialog"]').length})`);
      throw new Error(`Browser condition timed out: ${expression}\n${JSON.stringify(state)}`);
    };
    const errors = [];
    listeners.add(event => {
      if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text);
    });
    return {
      command, evaluate, wait, listeners, errors,
      close: async () => {
        socket.close();
        const ended = once(child, "exit");
        child.kill("SIGTERM");
        await ended;
        await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
      },
    };
  } catch (error) {
    socket?.close();
    child.kill("SIGTERM");
    throw error;
  }
}
