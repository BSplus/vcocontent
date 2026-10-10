import test from "node:test";
import assert from "node:assert/strict";
import { parseEditableTags, reconcileAnalysisTags } from "../client/src/lib/reconcile-analysis-tags.ts";
import { recognitionSchemaRequirements, verifyRecognitionSchema } from "../server/recognition-schema-readiness.ts";

test("removed saved AI tags stay removed through reanalysis and another save", () => {
  const initial = ["manual", "Day"];
  const savedAfterRemoval = initial.filter(tag => tag !== "Day");
  const rawGeneratedTags = ["Day", "Race Car"];
  const effectivePersistedTags = ["manual", "Race Car"];
  const editor = reconcileAnalysisTags(savedAfterRemoval, savedAfterRemoval, effectivePersistedTags);
  assert.deepEqual(editor, ["manual", "Race Car"]);
  assert.equal(editor.includes(rawGeneratedTags[0]), false);
  assert.deepEqual(parseEditableTags(editor.join(", ")), effectivePersistedTags);
});
test("reconciliation preserves both draft removals and unsaved manual additions", () => {
  assert.deepEqual(reconcileAnalysisTags(["manual", "new draft"], ["manual", "Day"],
    ["manual", "Day", "Race Car"]), ["manual", "new draft", "Race Car"]);
});
test("production rollout gate only reads schema and rejects an unready or unreachable database", async () => {
  const rows = recognitionSchemaRequirements.map(item => ({ table_name: item.table, column_name: item.column }));
  const query = async (sql, params) => {
    assert.match(sql, /^select /); assert.doesNotMatch(sql, /alter|create|insert|update|delete/i);
    assert.ok(params[0].includes("reference_documents")); return { rows };
  };
  await verifyRecognitionSchema(query);
  await assert.rejects(verifyRecognitionSchema(async () => ({ rows: rows.filter(row => row.column_name !== "reference_revision") })),
    /schema is not ready.*events.reference_revision/);
  await assert.rejects(verifyRecognitionSchema(async () => { throw new Error("private connection error"); }),
    error => /Startup refused/.test(error.message) && !error.message.includes("private"));
});
