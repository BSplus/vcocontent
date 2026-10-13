import test from "node:test";
import assert from "node:assert/strict";
import { mediaCreditSchema, creditLabel, uploadCreditLabel, creditText, creditByline } from "../shared/media-credit.ts";
import { insertMediaItemSchema } from "../shared/schema.ts";
import { sourceEdits, mergeSourceEdits } from "../server/nextcloud-sources.ts";
import { encryptManifest, decryptManifest } from "../server/import-manifest.ts";
import { imageLinks } from "../server/seo-markup.ts";
import { pool } from "../server/db.ts";

test.after(() => pool.end());

test("photo, video, mixed and empty upload credits have type-appropriate labels", () => {
  assert.equal(creditLabel("image"), "Photographer");
  assert.equal(creditLabel("video"), "Videographer");
  assert.equal(uploadCreditLabel([]), "Photographer / Videographer");
  assert.equal(uploadCreditLabel(["image", "image"]), "Photographer");
  assert.equal(uploadCreditLabel(["video"]), "Videographer");
  assert.equal(uploadCreditLabel(["image", "video"]), "Photographer / Videographer");
  for (const type of ["image", "video"]) {
    const item = { type, photographer: "  Zoë 李 & <Studio>  " };
    assert.equal(creditText(item), `${creditLabel(type)}: Zoë 李 & <Studio>`);
    assert.equal(creditByline(item), `${type === "video" ? "Video" : "Photo"} by Zoë 李 & <Studio>`);
    assert.equal(creditText({ type, photographer: "  " }), "");
    assert.equal(creditByline({ type }), undefined);
  }
});

test("credit validation trims Unicode text, accepts empty names and rejects invalid or overlong values", () => {
  assert.equal(mediaCreditSchema.parse("  Zoë 李 <script>  "), "Zoë 李 <script>");
  assert.equal(mediaCreditSchema.parse("  "), "");
  assert.equal(mediaCreditSchema.parse(" " + "é".repeat(150) + " ").length, 150);
  assert.equal(mediaCreditSchema.safeParse("é".repeat(151)).success, false);
  assert.equal(mediaCreditSchema.safeParse(42).success, false);
  assert.equal(insertMediaItemSchema.shape.photographer.parse("  Ada  "), "Ada");
  assert.equal(insertMediaItemSchema.shape.photographer.safeParse("x".repeat(151)).success, false);
});

test("source credit edits preserve saved passwords, support clearing and remain compatible with old sources", () => {
  const old = [{ id: "e14324f3-919d-4c9a-9641-a4f48db68dfe", link: "https://nextcloud.bs-plus.de/s/SYNTHETIC", password: "fixture", photographer: "Old" }];
  const edit = sourceEdits.parse([{ id: old[0].id, link: old[0].link, photographer: "  Zoë 李  " }]);
  const updated = mergeSourceEdits(old, edit);
  assert.equal(updated[0].password, "fixture");
  assert.equal(updated[0].photographer, "Zoë 李");
  assert.equal(mergeSourceEdits(updated, sourceEdits.parse([{ ...edit[0], photographer: "", removePassword: true }]))[0].password, undefined);
  assert.equal(mergeSourceEdits(updated, sourceEdits.parse([{ ...edit[0], photographer: "" }]))[0].photographer, "");
  assert.equal(mergeSourceEdits(updated, [{ id: old[0].id, link: old[0].link }])[0].photographer, "Zoë 李");
  assert.equal(mergeSourceEdits([{ ...old[0], photographer: undefined }], [{ id: old[0].id, link: old[0].link }])[0].photographer, undefined);
  assert.equal(sourceEdits.safeParse([{ link: old[0].link, photographer: "x".repeat(151) }]).success, false);
  const snapshot = { inputs: updated, files: [{ href: "https://example.invalid/file.jpg", sourceIndex: 0, photographer: updated[0].photographer }] };
  const encrypted = encryptManifest(snapshot);
  updated[0].photographer = "Changed";
  assert.equal(decryptManifest(encrypted).files[0].photographer, "Zoë 李");
  const legacy = { sources: [], files: [{ href: "https://example.invalid/file.jpg" }] };
  assert.deepEqual(decryptManifest(encryptManifest(legacy)), legacy);
});

test("SEO gallery credits are escaped text and never call a videographer a photographer", () => {
  for (const type of ["image", "video"]) {
    const html = imageLinks([{ id: 1, type, thumbnail: "/api/media/files/thumb-00000000-0000-0000-0000-000000000000.webp", caption: null, photographer: "李 <script>&" }], "Event");
    assert.ok(html.includes(`${creditLabel(type)}: 李 &lt;script&gt;&amp;`));
    assert.ok(!html.includes("<script>"));
    if (type === "video") assert.ok(!html.includes("Photographer"));
  }
});
