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
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-placeholder";
    assert.equal(isAITaggingConfigured(), false);
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://example.invalid";
    assert.equal(isAITaggingConfigured(), true);
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    await assert.rejects(
      generateTagsForImage("data:image/png;base64,AAA"),
      { message: "AI tagging failed" },
    );
  } finally {
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
    if (originalManagedKey !== undefined) process.env.AI_INTEGRATIONS_OPENAI_API_KEY = originalManagedKey;
    else delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (originalBaseURL !== undefined) process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = originalBaseURL;
    else delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  }
});