import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { Readable } from "node:stream";

/** Bounded local XLSX table extraction; no macro execution or external links. */
export async function xlsxToCsv(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.values(zip.files);
  if (files.length > 200) throw new Error("Workbook contains too many parts");
  let expanded = 0;
  for (const f of files) {
    const size = Number((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0);
    expanded += size;
    if (size > 16 * 1024 * 1024 || expanded > 32 * 1024 * 1024) throw new Error("Expanded workbook is too large");
  }
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false, trimValues:false });
  let actualExpanded = 0;
  const xml = async (name: string) => {
    const file = zip.file(name); if (!file) return {};
    const chunks:Buffer[]=[]; let size=0;
    for await (const chunk of new Readable().wrap(file.nodeStream())) {
      size+=chunk.length; actualExpanded+=chunk.length;
      if (size>16*1024*1024 || actualExpanded>32*1024*1024) throw new Error("Expanded workbook is too large");
      chunks.push(Buffer.from(chunk));
    }
    const content=Buffer.concat(chunks).toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(content)) throw new Error("Unsafe workbook XML");
    return parser.parse(content);
  };
  const array = (v: any): any[] => v == null ? [] : Array.isArray(v) ? v : [v];
  const text = (v: any): string => typeof v === "string" ? v : v?.["#text"] || "";
  const strings = array((await xml("xl/sharedStrings.xml")).sst?.si).map(v => text(v.t) || array(v.r).map(r => text(r.t)).join(""));
  const sheets = files.filter(f => /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name, undefined, { numeric:true }));
  if (!sheets.length) throw new Error("Workbook has no worksheets");
  // First nonempty sheet, preserving sparse cell positions. No merging sheets.
  for (const sheet of sheets.slice(0, 10)) {
    const rows = array((await xml(sheet.name)).worksheet?.sheetData?.row);
    if (!rows.length) continue;
    if (rows.length > 501) throw new Error("Workbook exceeds 500 data rows");
    return rows.map(row => {
      const cells: string[] = [];
      for (const cell of array(row.c)) {
        const letters = String(cell["@_r"] || "").match(/^[A-Z]+/)?.[0];
        if (!letters) throw new Error("Workbook cell address is invalid");
        const index = Array.from(letters).reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
        if (index >= 32) throw new Error("Workbook exceeds 32 columns");
        const value = cell["@_t"] === "s" ? strings[Number(cell.v)] || "" :
          cell["@_t"] === "inlineStr" ? text(cell.is?.t) || array(cell.is?.r).map(r=>text(r.t)).join("") : text(cell.v);
        cells[index] = '"' + value.replace(/"/g,'""') + '"';
      }
      return Array.from({length:cells.length},(_,i)=>cells[i] || '""').join(",");
    }).join("\n");
  }
  throw new Error("Workbook has no data rows");
}
