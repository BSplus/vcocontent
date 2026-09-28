import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { registerRoutes } from "../server/routes.ts";

test("admin OpenAI diagnostic checks authorization, runtime configuration and provider response", async () => {
  const previousBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const previousKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs = [];
  const proxy = "https://managed.example.invalid/v1/chat/completions";
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://managed.example.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "managed-test-key";

  let role = "guest";
  let calls = 0;
  let upstream = async (_body) => new Response(JSON.stringify({
    id: "test", object: "chat.completion", created: 0, model: "gpt-4.1-mini",
    choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
  }), { status: 200, headers: { "content-type": "application/json" } });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = role === "guest" ? undefined : { id: 1, isAdmin: role === "admin" };
    req.isAuthenticated = () => role !== "guest";
    next();
  });
  let server;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), proxy);
      calls++;
      const body = JSON.parse(options.body);
      assert.equal(new Headers(options.headers).get("authorization"), "Bearer managed-test-key");
      assert.equal(body.model, "gpt-4.1-mini");
      assert.deepEqual(body.messages, [{ role: "user", content: "Reply with OK." }]);
      assert.equal(body.max_tokens, 8);
      return upstream(body);
    };
    console.error = (...args) => logs.push(args.join(" "));
    server = await registerRoutes(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = `http://127.0.0.1:${server.address().port}/api/admin/openai/test`;
    const post = async (body) => {
      const response = await originalFetch(address, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
    };

    assert.deepEqual((await post({ model: "expensive" })).body, { error: "Authentication required" });
    role = "user";
    assert.deepEqual((await post({ model: "expensive" })).body, { error: "Admin access required" });
    assert.equal(calls, 0);

    role = "admin";
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    assert.deepEqual(await post({ model: "expensive" }), {
      status: 503, body: { success: false, error: "Managed OpenAI runtime configuration unavailable" }, cache: "no-store",
    });
    assert.equal(calls, 0);

    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "managed-test-key";
    delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    assert.equal((await post({})).status, 503);
    assert.equal(calls, 0);
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://managed.example.invalid/v1";
    assert.deepEqual(await post({ model: "expensive", messages: ["ignored"] }), {
      status: 200, body: { success: true, status: "connected" }, cache: "no-store",
    });
    assert.equal(calls, 1);

    upstream = async () => new Response(JSON.stringify({ error: { message: "private-provider-details" } }), {
      status: 401, headers: { "content-type": "application/json" },
    });
    assert.deepEqual(await post({}), {
      status: 502, body: { success: false, error: "Managed OpenAI request failed" }, cache: "no-store",
    });
    assert.equal(calls, 2);
    upstream = async () => new Response(JSON.stringify({
      id: "test", object: "chat.completion", choices: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
    assert.equal((await post({})).status, 502);
    assert.equal(calls, 3);
    assert.doesNotMatch(logs.join(" "), /private-provider-details|managed-test-key|managed\.example/);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    console.error = originalError;
    if (previousBase === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = previousBase;
    if (previousKey === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = previousKey;
  }
});