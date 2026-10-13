import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEntryFile } from "../server/entry-list.ts";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const file = await readFile(new URL("../attached_assets/eventresult_82799828_0_1791893901877.csv", import.meta.url));
const parsed = await parseEntryFile(file, "text/csv", "iracing.csv");
const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
async function click(browser, expression) {
  await browser.wait(`!!(${expression}) && !(${expression}).disabled`);
  await browser.evaluate(`(${expression}).click()`);
}
async function type(browser, id, value) {
  await browser.evaluate(`(()=>{
    const el=document.getElementById(${JSON.stringify(id)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
}
async function selectFile(browser, label, bytes = file) {
  await browser.evaluate(`(()=>{
    const input=document.querySelector('input[aria-label=${JSON.stringify(label)}]');
    const dt=new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}),c=>c.charCodeAt(0))],
      'iracing.csv',{type:'text/csv'}));
    input.files=dt.files; input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
}

for (const admin of [true, false]) for (const editing of [true, false])
  test(`iRacing ${admin ? "admin" : "creator"} ${editing ? "edit" : "create"} previews both paths before explicit saving`,
    { timeout: 90000 }, async () => {
      const browser = await uiBrowser(), errors = [], writes = [];
      const user = { id: 99800, username: "isolated-entry-fixture", isAdmin: admin,
        isCreator: !admin, creatorStatus: "approved", emailVerifiedAt: "2026-01-01" };
      let event = { id: 99801, title: "Entry import fixture", description: "Isolated fixture",
        date: "2026-10-11T00:00:00.000Z", creatorId: admin ? null : user.id,
        coverImage: "/attached_assets/%2389_3.png", customThumbnail: null, isPremium: false, visibility: "draft" };
      let entries = [{ number: "777", team: "Saved team", car: "GT3", drivers: "Saved driver" }];
      let documents = [{ id: 99802, title: "Saved source.csv", kind: "entry", scope: "event",
        seasonYear: 2026, session: null, rows: entries, downloadUrl: "/api/events/99801/references/99802/source" }];
      let invalidPreview = false;
      browser.listeners.add(message => {
        if (message.method !== "Fetch.requestPaused") return;
        const task = async () => {
          const { requestId, request } = message.params, path = new URL(request.url).pathname;
          let content = [], status = 200;
          if (path === "/api/user") content = user;
          if (["/api/events", "/api/admin/events", "/api/creator/events"].includes(path)) content = [event];
          if (path === "/api/events/99801") content = event;
          if (path.endsWith("/nextcloud/sources")) content = { sources: [] };
          if (path.endsWith("/thumbnail-options")) content = { photos: [], page: 1, hasMore: false };
          if (path.endsWith("/photo-matching")) content = { enabled: false };
          if (path === "/api/admin/safety") content = { media: [], events: [] };
          if (path === "/api/creator/usage") content = { photos: 0, galleries: 1, bytes: 0,
            limits: { photos: 10000, galleries: 100, bytes: 1000000 }, adminExempt: admin };
          if (path === "/api/admin/media-usage") content = { total: { bytes: "0", count: "0", legacy: "0" },
            byEvent: [], byCreator: [], cleanupCount: "0", policy: { eventBytes: 1000000, creatorBytes: 1000000,
              eventCount: 100, creatorCount: 100 }, warningFraction: 0.8 };
          if (path.endsWith("/entries/preview")) {
            status = invalidPreview ? 400 : 200;
            content = invalidPreview ? { error: "Invalid iRacing metadata preamble." } : parsed;
          }
          if (path === "/api/events/99801/entries") {
            content = entries;
            if (request.method === "PUT") {
              entries = JSON.parse(request.postData).rows;
              writes.push({ path, rows: entries }); content = { rows: entries };
            }
          }
          if (path === "/api/events/99801/references") {
            content = { documents, seasonYear: 2026, canUseSeason: false, seriesId: null };
            if (request.method === "POST") {
              const captured = await browser.evaluate("window.__referenceWrites.at(-1)");
              writes.push({ path, ...captured });
              documents = [{ ...documents[0], id: 99803, rows: captured.rows, title: "iracing.csv" }];
              content = { id: 99803, rows: captured.rows }; status = 201;
            }
          }
          if (request.method === "POST" && ["/api/events", "/api/creator/events"].includes(path)) {
            const body = JSON.parse(request.postData);
            writes.push({ path, rows: body.entryRows });
            event = { ...event, ...body }; content = event; status = 201;
          }
          await browser.command("Fetch.fulfillRequest", { requestId, responseCode: status,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
            body: Buffer.from(JSON.stringify(content)).toString("base64") });
        };
        void task().catch(error => errors.push(String(error)));
      });
      try {
        await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
        await browser.command("Page.addScriptToEvaluateOnNewDocument", { source: `
          window.__referenceWrites=[];
          const original=window.fetch;
          window.fetch=function(url,options) {
            if(String(url).endsWith('/references') && options?.method==='POST' && options.body instanceof FormData)
              window.__referenceWrites.push({rows:JSON.parse(options.body.get('rows')),kind:options.body.get('kind')});
            return original.apply(this,arguments);
          };` });
        await browser.command("Page.navigate", { url: new URL(admin ? "/admin/dashboard" : "/creator/dashboard", base).href });
        if (!admin && editing) await click(browser, button("Manage galleries"));
        await click(browser, button(editing ? "Edit Event" : admin ? "Create VCO Event" : "Create gallery"));
        await browser.wait(`!!document.querySelector('input[aria-label="Choose an entry list file"]')`);
        if (!editing) {
          await type(browser, "title", "Reviewed import");
          await browser.evaluate(`(()=>{
            const el=document.getElementById('description');
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Synthetic fixture');
            el.dispatchEvent(new Event('input',{bubbles:true}));
          })()`);
        }
        // The existing source and entry rows stay saved while the reference is reviewed.
        await selectFile(browser, "Choose an entry or result reference");
        await browser.wait(`document.querySelector('[aria-label="Reference import preview"]')?.textContent.includes('59 vehicle entries')`);
        assert.equal(writes.length, 0);
        assert.equal(entries[0].team, "Saved team");
        assert.equal(documents[0].title, "Saved source.csv");
        assert.equal(await browser.evaluate(`(${button("Confirm and save reference")}).disabled`), true);
        if (!editing) assert.equal(await browser.evaluate(`(${button("Create Event")}).disabled`), true);
        await browser.evaluate(`document.querySelector('[aria-label="Reference import preview"] details').open=true`);
        await type(browser, "reference-preview-0-team", "Reviewed reference");
        await browser.evaluate(`document.querySelector('[aria-label="Reference import preview"] input[type="checkbox"]').click()`);
        // Editing after confirmation invalidates confirmation.
        await type(browser, "reference-preview-0-team", "Corrected reference");
        assert.equal(await browser.evaluate(`(${button("Confirm and save reference")}).disabled`), true);
        await browser.evaluate(`document.querySelector('[aria-label="Reference import preview"] input[type="checkbox"]').click()`);
        await click(browser, button("Confirm and save reference"));
        await browser.wait(`!document.querySelector('[aria-label="Reference import preview"]')`);
        if (editing) {
          await browser.wait(`document.body.textContent.includes('59 imported entries')`);
          assert.equal(writes.at(-1).rows[0].team, "Corrected reference");
          assert.equal(writes.at(-1).rows.find(row => row.number === "091").number, "091");
          // Invalid reimport is rejected before any source is replaced; discard is safe.
          const count = writes.length;
          invalidPreview = true;
          await selectFile(browser, "Choose an entry or result reference");
          await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Invalid iRacing metadata preamble')`);
          await click(browser, button("Discard reference preview"));
          assert.equal(writes.length, count);
          assert.equal(documents[0].rows[0].team, "Corrected reference");
          invalidPreview = false;
        }
        await selectFile(browser, "Choose an entry list file");
        await browser.wait(`!!document.querySelector('#entry-0-team') || document.body.textContent.includes('59 imported rows')`);
        if (!editing) {
          await click(browser, `[...document.querySelectorAll('summary')].find(el=>el.textContent==='Edit 59 imported entries')`);
          await browser.wait(`!!document.getElementById('entry-0-team')`);
        }
        await type(browser, "entry-0-team", "Reviewed entry");
        // Operator resolves leading-zero ambiguities while keeping 08 and 091 intact.
        const seen = new Set();
        for (const [i, row] of parsed.rows.entries()) {
          const number = String(Number(row.number));
          if (seen.has(number)) await type(browser, `entry-${i}-number`, String(900 + i));
          seen.add(number);
        }
        await browser.evaluate(`(()=>{
          const section=document.querySelector('section[aria-labelledby="entry-list-heading"]');
          [...section.querySelectorAll('label')].find(el=>el.textContent.includes('I reviewed these rows and confirm')&&!el.closest('[aria-label="Reference import preview"]')).querySelector('input').click();
        })()`);
        await click(browser, button(editing ? "Confirm and save entry list" : "Create Event"));
        if (editing) await browser.wait(`!!(${button("Confirm and save entry list")}) && (${button("Confirm and save entry list")}).disabled`);
        else await browser.wait(`!!(${button("Done")}) && !(${button("Done")}).disabled`);
        const saved = writes.find(write => write.rows?.[0]?.team === "Reviewed entry");
        assert.equal(saved.rows.length, 59);
        assert.equal(saved.rows.find(row => row.number === "08").number, "08");
        if (!editing) {
          assert.equal(writes.at(-1).rows[0].team, "Corrected reference");
          assert.equal(writes.at(-1).rows.length, 59);
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(browser.errors, []);
      } finally { await browser.close(); }
    });
