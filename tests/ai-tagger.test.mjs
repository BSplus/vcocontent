import test from "node:test";
import assert from "node:assert/strict";
const { parseTagResponse, generateTagsForImage, isAITaggingConfigured } = await import("../server/utils/ai-tagger.ts");

test("accepts only allowed tags and removes duplicates", () => {
  assert.deepEqual(
    parseTagResponse(" Day, GT Car, invented, Day, Night, <script>, Rear View "),
    ["Day", "GT Car", "Night", "Rear View"],
  );
  assert.deepEqual(parseTagResponse("not a tag, unrecognized"), []);
});

test("missing provider configuration fails explicitly without exposing credentials", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalManagedKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const originalBaseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  try {
    assert.equal(isAITaggingConfigured(), false);
    process.env.OPENAI_API_KEY = "ignored-personal-key";
    assert.equal(isAITaggingConfigured(), false);
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-placeholder";
    assert.equal(isAITaggingConfigured(), false);
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid";
    assert.equal(isAITaggingConfigured(), true);
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    await assert.rejects(
      generateTagsForImage("data:image/png;base64,AAA"),
      { message: "AI tagging is not configured" },
    );
  } finally {
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    if (originalManagedKey !== undefined) process.env.AI_INTEGRATIONS_OPENAI_API_KEY = originalManagedKey;
    else delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (originalBaseURL !== undefined) process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = originalBaseURL;
    else delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  }
});

test("managed image request uses its proxy and accepts only approved tags", async () => {
  const originalBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const originalKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://managed.example.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "managed-test-key";
  let calls = 0;
  let request;
  globalThis.fetch = async (url, options) => {
    calls++;
    request = { url: String(url), headers: new Headers(options.headers), body: JSON.parse(options.body) };
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({
      id: "test", object: "chat.completion", created: 0, model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: "Day, GT Car, invented, Day" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    assert.equal(isAITaggingConfigured(), true);
    assert.deepEqual(await generateTagsForImage("data:image/webp;base64,AAAA"), ["Day", "GT Car"]);
    assert.equal(calls, 1);
    assert.equal(request.url, "https://managed.example.invalid/v1/chat/completions");
    assert.equal(request.headers.get("authorization"), "Bearer managed-test-key");
    assert.equal(request.body.model, "gpt-4.1-mini");
    assert.equal(request.body.messages[1].content[1].image_url.url, "data:image/webp;base64,AAAA");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = originalBase;
    if (originalKey === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = originalKey;
  }
});

test("provider failure never exposes its response or credentials", async () => {
  const originalBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const originalKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs = [];
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://managed.example.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "managed-test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "secret-provider-details" } }), {
    status: 401, headers: { "content-type": "application/json" },
  });
  console.error = (...args) => logs.push(args.join(" "));
  try {
    await assert.rejects(generateTagsForImage("data:image/webp;base64,AAAA"), { message: "AI tagging failed" });
    assert.doesNotMatch(logs.join(" "), /secret-provider-details|managed-test-key/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    if (originalBase === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = originalBase;
    if (originalKey === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = originalKey;
  }
});