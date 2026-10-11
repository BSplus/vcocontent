import test from "node:test";
import assert from "node:assert/strict";
import { updateSeriesSchema } from "../shared/schema.ts";

export const pngLogo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

test("series updates strip full-record administrative fields and accept legacy nullable values", () => {
  const record = { id: 7, name: "Official fixture", logo: null, description: null,
    creatorId: null, createdAt: "2026-10-11T10:00:00.000Z" };
  assert.deepEqual(updateSeriesSchema.parse(record), { name: record.name, logo: null, description: null });
  assert.deepEqual(updateSeriesSchema.parse({ ...record, logo: pngLogo, creatorId: 999, id: 999, createdAt: "invalid" }),
    { name: record.name, logo: pngLogo, description: null });
  assert.deepEqual(updateSeriesSchema.parse({ logo: pngLogo }), { logo: pngLogo });
  assert.deepEqual(updateSeriesSchema.parse({ name: " Edited ", logo: "", description: "" }),
    { name: "Edited", logo: "", description: "" });
});

test("series update validation rejects invalid editable inputs and empty updates", () => {
  for (const data of [{name:" "}, {name:null}, {logo:123}, {logo:"not a URL"},
    {description:123}, {description:"x".repeat(1001)}, {}, {id:7,creatorId:8,createdAt:"2026"}]) {
    assert.equal(updateSeriesSchema.safeParse(data).success, false, JSON.stringify(data));
  }
});
