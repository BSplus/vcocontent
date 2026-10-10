// Render existing evidence only. No provider calls, DB writes, or editorial ground truth.
import { readFile, writeFile } from "node:fs/promises";

const root = "generated-artifacts/video-review";
const data = JSON.parse(await readFile(`${root}/live-results.json`, "utf8"));
const live = data.results.filter(r => r.status === "completed");
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));
const number = value => typeof value === "number" ? value.toLocaleString("en-GB") : "unavailable";
const flags = {
  "2": "Several small/distant numbers and sponsor-like team text require review. No event linkage was verified.",
  "3": "Separate #9 at 6.367s may be a cropped #99, not another car. Sponsor text is not necessarily a team.",
  "4": "#65 was observed but dropped from saved identification after conflicting ARTASANA/ATLASIAN branding. GT2 and VITALITY need review; game watermark did not yield Sim Racing.",
  "5": "Review bürosüd as team versus sponsor and the Real Motorsport label. An open cockpit is visible, but this is not onboard footage.",
  "6": "Review sponsor/brand text as team, number readability, vehicle/manufacturer claims, and real-versus-sim discipline. Unnumbered and numbered observations are not proven distinct physical cars.",
};
const categories = {
  "2": "Short action · mixed cars · split-screen viewpoints",
  "3": "Short single-car action · cropped/ambiguous final view",
  "4": "Multi-car game replay · changing camera scenes",
  "5": "Short open-cockpit prototype action · exterior views",
  "6": "Multi-car slow-motion field · changing visible cars",
};
const verdict = (clip, type, value) => `<select aria-label="${escape(`${type}: ${value}`)}"
 data-clip="${escape(clip)}" data-type="${escape(type)}" data-value="${escape(value)}">
 <option value="pending">Pending review</option><option value="correct">Correct</option>
 <option value="incorrect">Incorrect</option><option value="uncertain">Uncertain</option></select>`;
const totals = live.reduce((a, r) => {
  const e = r.evidence;
  a.frames += e.analyzedFrames; a.requests += e.providerRequests;
  a.prompt += e.promptTokens ?? 0; a.completion += e.completionTokens ?? 0;
  a.unknown += e.usageUnavailableRequests;
  return a;
}, { frames: 0, requests: 0, prompt: 0, completion: 0, unknown: 0 });
const summaries = live.map(r => `<tr><th>${escape(r.file.split("_179")[0])}<small>${escape(categories[r.file[0]])}</small></th>
 <td>${r.evidence.duration.toFixed(2)}s</td><td>Completed · unreviewed</td><td>${r.evidence.analyzedFrames}</td>
 <td>${r.evidence.providerRequests}</td><td>${number(r.evidence.promptTokens)} / ${number(r.evidence.completionTokens)}</td>
 <td>${(r.evidence.samplingMs / 1000).toFixed(2)}s / ${(r.elapsedMs / 1000).toFixed(2)}s</td></tr>`).join("");
const sections = await Promise.all(live.map(async r => {
  const jpg = await readFile(`${root}/${r.file}.jpg`);
  const observations = r.identification.map(v => {
    const value = `#${v.number || "unknown"}; team: ${v.team || "unknown"}; vehicle: ${v.vehicle || "unknown"}; manufacturer: ${v.manufacturer || "unknown"}; class: ${v.racingClass || "unknown"}; discipline: ${v.discipline || "unknown"}`;
    return `<tr><td>${escape(value)}</td><td>Visual only</td><td>None — unresolved</td><td>${verdict(r.file, "Identification", value)}</td></tr>`;
  }).join("");
  return `<section><h2>${escape(r.file.split("_179")[0])}</h2>
 <p>${escape(categories[r.file[0]])} · ${r.evidence.duration.toFixed(2)}s · 5 analyzed frames · 2 requests</p>
 <img alt="Five sampled views, left to right in timestamp order" src="data:image/jpeg;base64,${jpg.toString("base64")}">
 <p class="times">Sampled timestamps: ${r.evidence.timestamps.map(t => t.toFixed(3)).join(", ")} seconds</p>
 <p class="flag"><strong>Review flags (not editorial verdicts):</strong> ${escape(flags[r.file[0]])}</p>
 <h3>Saved descriptive tags</h3><div class="tags">${r.tags.map(t => `<label>${escape(t)} ${verdict(r.file, "Tag", t)}</label>`).join("")}</div>
 <h3>Saved identity observations</h3><div class="scroll"><table><thead><tr><th>Number / team / vehicle / class</th><th>Match source</th><th>Listed drivers</th><th>Editor verdict</th></tr></thead>
 <tbody>${observations || '<tr><td colspan="4">No searchable identity observations</td></tr>'}</tbody></table></div>
 <p><strong>Reference scope used:</strong> None. No verified clip-to-event/session/season association. Supplied lists were not pooled or matched globally. Drivers intentionally remain empty; a future scoped match names the registered lineup, not the physical driver.</p>
 <details><summary>Timestamped frame evidence (including observations omitted from saved aggregation)</summary><pre>${escape(JSON.stringify(r.evidence.frames.map(({timestamp,tags,vehicles}) => ({timestamp,tags,vehicles})), null, 2))}</pre></details></section>`;
}));
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VCO video recognition — provisional editorial review</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:#17212b;font:15px/1.5 system-ui,sans-serif}
main{max-width:1300px;margin:auto;padding:24px}h1{font-size:29px;margin:0 0 8px}h2{font-size:22px}h3{font-size:17px}
header,section{background:white;border:1px solid #d8dfe5;border-radius:8px;padding:20px;margin-bottom:20px}
small{display:block;font-weight:normal;color:#566273}p{margin:10px 0}.notice,.flag{background:#fff5dd;border-left:4px solid #aa7100;padding:12px}
.scroll{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{border-bottom:1px solid #d8dfe5;padding:10px;vertical-align:top}
th{font-weight:600}select,button{font:inherit;border:1px solid #a8b5c2;border-radius:4px;padding:5px;background:white;color:#17212b}
button{cursor:pointer;background:#173d59;color:white;padding:9px 15px}.tags{display:flex;flex-wrap:wrap;gap:8px}
.tags label{display:flex;flex-direction:column;border:1px solid #d8dfe5;border-radius:5px;padding:6px 9px}
.tags select{font-size:12px}img{width:100%;max-width:1200px;display:block;background:#222}.times{font-size:13px}
pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f7;padding:12px}
details{margin-top:14px}a{color:#173d59}@media(max-width:600px){main{padding:10px}header,section{padding:12px}h1{font-size:23px}}
@media print{body{background:white}select{border:0}button{display:none}header,section{break-inside:avoid}details{display:none}}
</style></head><body><main><header><h1>VCO video recognition: provisional review</h1>
<p>10 October 2026 · Authorized operator-supplied clips · Existing managed ${escape(data.model)}</p>
<p class="notice"><strong>Technical completion is not validated accuracy.</strong> Five clips completed the real queue and saved tags/identifications in disposable development rows. No human-reviewed benchmark or editorial verdict exists yet. All selectors start pending. No percentages or actual billing costs are claimed.</p>
<p><strong>${totals.frames} analyzed frames · ${totals.requests} requests · ${number(totals.prompt)} prompt + ${number(totals.completion)} completion tokens</strong>.
 Usage is from provider response metadata, not billing evidence. Requests with unavailable usage: ${totals.unknown}. Actual cost: unavailable.</p>
<p>Choose Correct, Incorrect or Uncertain for each tag/identity, then export the review. Selections are local to this open page and are not uploaded or auto-saved. Review source clips for details that thumbnails cannot show.</p>
<button id="export">Download editorial review CSV</button><p id="export-status" role="status"></p>
<div class="scroll"><table><thead><tr><th>Clip / coverage</th><th>Duration</th><th>Status</th><th>Frames</th><th>Requests</th><th>Prompt / completion tokens</th><th>Extraction / queue elapsed</th></tr></thead><tbody>${summaries}</tbody></table></div>
<p>Excluded unchanged: Finish edit (${(data.results[0].bytes / 1048576).toFixed(2)} MiB) and #196 IMSA (${(data.results[1].bytes / 1048576).toFixed(2)} MiB), both above the existing 50 MiB policy. No transcoding or policy override.</p>
<p><strong>Coverage gaps:</strong> no static racing, dedicated onboard/cockpit-camera, pit/paddock, or long (>30s) clip supplied. Static and longer sampling are covered technically by synthetic fixtures, not live recognition accuracy.</p>
</header>${sections.join("")}<section><h2>Reference inventory and boundaries</h2>
<p>The development database had no reference documents. Existing event titles did not establish a verified connection for these uploads. Files alone do not authorize a clip/event association.</p>
<ul><li>ERL powered by Nitro Concepts: generated 24 August 2025; season-wide driver/start-number list, not confirmed for this Gran Turismo replay.</li>
<li>VCO INFINITY workbook: 24 separate race sheets; race-specific car numbers and drivers must not be merged across sheets.</li>
<li>24h Le Mans Virtual: provisional 13–14 June entry list, dated 23 May 2020; teams/cars and reserves, no driver lineup. Unrelated to the selected clips.</li>
<li>ERL Round 1 workbook: Live for Speed nominated entries; not a verified reference for Gran Turismo 7 or IMSA.</li>
<li>Michelin 240: document heading identifies Daytona on 12 January 2025, despite its 2024 filename. No verified linkage to clips named IMSA round 1; do not rely on filenames or number coincidence.</li></ul>
<p>No Result List was supplied. Scoped owner/series/year, event/session precedence, ambiguity, registered-lineup semantics and saved-tag preservation were checked separately in deterministic tests. Those checks validate behavior, not these videos' recognition accuracy.</p>
<p>Technical checks: 13 video analysis/ingestion tests and 19 recognition/reference/tag-reconciliation tests passed. Original files were read locally through a pilot-only storage adapter; the actual sampler, managed recognition, aggregation, queue and DB save path ran unchanged. Disposable pilot rows were removed after exporting evidence. No production deployment or schema change; no provider or image-default change.</p>
</section></main><script>
document.getElementById("export").addEventListener("click",()=>{
 const safe=v=>String(v).replace(/^[=+@-]/,"'$&");
 const csv=v=>'"'+safe(v).replaceAll('"','""')+'"';
 const rows=[["Clip","Type","AI result","Editor verdict"]];
 document.querySelectorAll("select[data-clip]").forEach(s=>rows.push([s.dataset.clip,s.dataset.type,s.dataset.value,s.value]));
 const blob=new Blob(["\\ufeff"+rows.map(r=>r.map(csv).join(",")).join("\\r\\n")],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob), a=document.createElement("a");a.href=url;a.download="vco-video-editorial-review.csv";a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);document.getElementById("export-status").textContent="Review exported. Keep the downloaded CSV; this page does not auto-save.";
});
</script></body></html>`;
await writeFile(`${root}/editorial-review.html`, html);
await writeFile("docs/video-analysis-live-results.json", JSON.stringify(data, null, 2));
console.log(JSON.stringify({ report: `${root}/editorial-review.html`, totals, bytes: Buffer.byteLength(html) }));
