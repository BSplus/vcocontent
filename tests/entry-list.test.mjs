import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";

const { parseEntryFile, ENTRY_LIST_LIMITS } = await import("../server/entry-list.ts");

function completionResponse(rows, model = "gpt-4.1-mini") {
  return new Response(JSON.stringify({
    id: "entry-test",
    object: "chat.completion",
    created: 0,
    model,
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ rows }) }, finish_reason: "stop" }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function makePdf(text = "", mediaBox = "0 0 360 100") {
  const stream = text.startsWith("RAW:") ? text.slice(4) : text ? `BT /F1 12 Tf 10 60 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

test("CSV parsing strips BOM, maps header aliases, and preserves quoted separators", async () => {
  const csv = "\uFEFFStart No;Entrant;Vehicle;Pilot\r\n" +
    '007; "Apex; Racing"; "GT, Mk II"; "Ada Lovelace, Grace Hopper"\r\n';
  const result = await parseEntryFile(Buffer.from(csv), "text/csv; charset=utf-8", "entries.csv");
  assert.deepEqual(result.rows, [{
    number: "007",
    team: "Apex; Racing",
    car: "GT, Mk II",
    drivers: "Ada Lovelace, Grace Hopper",
    issues: [],
  }]);
  assert.deepEqual(result.issues, []);
});

test("CSV without headers uses the documented column order and returns row warnings", async () => {
  const result = await parseEntryFile(Buffer.from("12,Team,,Driver\nbad,Team,Car,\n"), "text/csv", "entries.csv");
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0].issues, ["Missing car value."]);
  assert.match(result.rows[1].issues.join(" "), /Missing drivers/);
  assert.match(result.rows[1].issues.join(" "), /1–4 digits/);
  assert.ok(result.issues.some(issue => issue.startsWith("Line 1:")));
});

test("CSV input is bounded, UTF-8 checked, and requires a supported MIME and suffix", async () => {
  assert.equal(ENTRY_LIST_LIMITS.rows, 500);
  await assert.rejects(
    parseEntryFile(Buffer.from("x".repeat(ENTRY_LIST_LIMITS.csvBytes + 1)), "text/csv", "large.csv"),
    /2 MB or smaller/,
  );
  await assert.rejects(parseEntryFile(Buffer.from([0xff]), "text/csv", "bad.csv"), /valid UTF-8/);
  await assert.rejects(parseEntryFile(Buffer.from("1,A,B,C"), "application/pdf", "entries.csv"), /Unsupported file type/);
  await assert.rejects(parseEntryFile(Buffer.from("%PDF-notreally"), "application/pdf", "entries.pdf"), /Unsupported file type/);
});

test("PDF text extraction parses searchable entries without requiring vision configuration", async () => {
  const originalBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const originalKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  try {
    const result = await parseEntryFile(makePdf("18,Apex,GT3,Casey"), "application/pdf", "entries.pdf");
    assert.deepEqual(result.rows, [{
      number: "18", team: "Apex", car: "GT3", drivers: "Casey", issues: [],
    }]);
    assert.deepEqual(result.issues, []);
  } finally {
    if (originalBase === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = originalBase;
    if (originalKey === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = originalKey;
  }
});

test("positioned PDF table columns yield complete editable entries without vision", async () => {
  const stream = [
    ["Number", "Team", "Car", "Drivers"].map((value, i) =>
      `BT /F1 10 Tf ${[10, 65, 170, 250][i]} 75 Td (${value}) Tj ET`).join("\n"),
    ["007", "Apex Racing", "GT3", "Ada One"].map((value, i) =>
      `BT /F1 10 Tf ${[10, 65, 170, 250][i]} 55 Td (${value}) Tj ET`).join("\n"),
  ].join("\n");
  const result = await parseEntryFile(makePdf("RAW:" + stream), "application/pdf", "table.pdf");
  assert.deepEqual(result.rows, [{
    number: "007", team: "Apex Racing", car: "GT3", drivers: "Ada One", issues: [],
  }]);
});

test("multi-line driver names in a position-based PDF table stay with their numbered entry", async () => {
  const cells = [
    ["CAR NO.", 47, 473], ["DRIVERS", 163, 473], ["TEAM", 386, 473],
    ["CAR TYPE", 597, 473], ["TIRE", 723, 473],
    ["1", 55, 443], ["Diogo Pinto", 106, 453], ["Enzo Bonito", 106, 443],
    ["BMW M Racing", 275, 448], ["BMW M Hybrid V8", 578, 448], ["Michelin", 715, 448],
    ["3", 55, 410], ["Loic Rabier", 106, 419], ["Marcus Hamilton", 106, 409],
    ["Mivano", 275, 414], ["Acura ARX-06 GTP", 576, 414], ["Michelin", 715, 414],
    ["Page 1 of 1", 725, 22],
  ];
  const stream = cells.map(([value, x, y]) =>
    `BT /F1 10 Tf ${x} ${y} Td (${value}) Tj ET`).join("\n");
  const result = await parseEntryFile(makePdf("RAW:" + stream, "0 0 792 612"), "application/pdf", "entry-list.pdf");
  assert.deepEqual(result.rows, [
    { number: "1", team: "BMW M Racing", car: "BMW M Hybrid V8", drivers: "Diogo Pinto, Enzo Bonito", issues: [] },
    { number: "3", team: "Mivano", car: "Acura ARX-06 GTP", drivers: "Loic Rabier, Marcus Hamilton", issues: [] },
  ]);
  assert.deepEqual(result.issues, []);
});

test("screenshot extraction uses one bounded managed OpenAI vision request and validates rows", async () => {
  const originalBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const originalKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://managed.example.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "managed-test-key";
  const png = createCanvas(2, 2).toBuffer("image/png");
  let calls = 0;
  let request;
  globalThis.fetch = async (url, options) => {
    calls++;
    request = { url: String(url), body: JSON.parse(options.body) };
    return completionResponse([
      { number: "24", team: "Apex", car: "GT3", drivers: "Alex Example" },
      { number: "bad", team: "Team B", car: "Prototype", drivers: "" },
    ], request.body.model);
  };
  try {
    const result = await parseEntryFile(png, "image/png", "grid.png");
    assert.equal(calls, 1);
    assert.equal(request.url, "https://managed.example.invalid/v1/chat/completions");
    assert.equal(request.body.model, "gpt-4.1-mini");
    assert.equal(request.body.max_tokens, 2500);
    assert.match(request.body.messages[0].content, /untrusted data/);
    assert.match(request.body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
    assert.deepEqual(result.rows[0], {
      number: "24", team: "Apex", car: "GT3", drivers: "Alex Example", issues: [],
    });
  assert.deepEqual(result.rows[1].issues, ["Could not confidently read drivers.", "Number should contain 1–4 digits."]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = originalBase;
    if (originalKey === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = originalKey;
  }
});

test("scanned PDFs fall back to per-page vision extraction", async () => {
  const originalBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const originalKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://managed.example.invalid/v1";
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "managed-test-key";
  const pdf = makePdf();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return completionResponse([{ number: "8", team: "PDF Team", car: "GT", drivers: "Reader" }]);
  };
  try {
    const result = await parseEntryFile(pdf, "application/pdf", "scanned.pdf");
    assert.equal(calls, 1);
    assert.deepEqual(result.rows, [{
      number: "8", team: "PDF Team", car: "GT", drivers: "Reader", issues: [],
    }]);
    assert.deepEqual(result.issues, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    else process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = originalBase;
    if (originalKey === undefined) delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = originalKey;
  }
});

test("CSV preview marks duplicate numbers even when only one has leading zeros", async () => {
  const result = await parseEntryFile(Buffer.from("Number,Team,Car,Drivers\n007,A,GT,One\n7,B,GT,Two\n"), "text/csv", "entries.csv");
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every(row => row.issues.some(issue => issue.includes("Duplicate"))));
  assert.ok(result.issues.some(issue => issue.includes("duplicate")));
});