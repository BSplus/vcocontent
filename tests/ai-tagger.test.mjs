import test from "node:test";
import assert from "node:assert/strict";
const { parseTagResponse, generateTagsForImage } = await import("../server/utils/ai-tagger.ts");

test("accepts only allowed tags and removes duplicates", () => {
  assert.deepEqual(
    parseTagResponse(" Day, GT Car, invented, Day, Night, <script>, Rear View "),
    ["Day", "GT Car", "Night", "Rear View"],
  );
  assert.deepEqual(parseTagResponse("not a tag, unrecognized"), []);
});

test("missing provider configuration fails explicitly without exposing credentials", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(
      generateTagsForImage("data:image/png;base64,AAA"),
      { message: "AI tagging failed" },
    );
  } finally {
    if (originalKey !== undefined) process.env.OPENAI_API_KEY = originalKey;
  }
});