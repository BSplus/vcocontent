import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import ts from "typescript";

// A regression guard for German app-owned copy, not a language detector.
// Inspect text nodes rather than comments, and retain real German names.
const german = /[äöüÄÖÜß]|\b(?:Bitte|Kein|Keine|Nicht|Ungültig\w*|Erneut|versuchen|konnte|konnten|fehlgeschlagen|lieferte|erreicht|Unterordner|Medien|Ordner|Zugang|Datei|Dateien|Einträge|Importgrenze|Zeitlimit|Speicherübersicht|Nutzerverwaltung)\b/u;
const allowedNames = /Lindwurmstraße 88|München|Amtsgericht München|Bayerisches Landesamt für Datenschutzaufsicht|Digital Nürburgring Langstrecken Serie/gu;

async function sources(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await sources(path));
    else if (/\.(tsx?|html)$/.test(entry.name)) result.push(path);
  }
  return result;
}

test("app-owned UI and API text has no known German system-copy patterns", async () => {
  const failures = [];
  for (const path of [...await sources("client/src"), ...await sources("server"), ...await sources("shared"), "client/index.html"]) {
    const content = await readFile(path, "utf8");
    if (path.endsWith(".html")) {
      assert.doesNotMatch(content, german, path);
      continue;
    }
    const file = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = node => {
      if (ts.isStringLiteral(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) {
        const text = node.text.replace(allowedNames, "");
        if (german.test(text)) failures.push(`${path}: ${node.text.trim().slice(0, 180)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  assert.deepEqual(failures, []);
});
