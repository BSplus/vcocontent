import test from "node:test";
import assert from "node:assert/strict";
import { pageMetadata } from "../shared/pagination.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { uiBrowser } from "./helpers/ui-browser.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("manual number assignment dialog works on creator and admin desktop/mobile", { timeout: 180000 }, async () => {
  const browser = await uiBrowser();
  const temp=await mkdtemp(`${tmpdir()}/assign-ui-video-`);
  await promisify(execFile)("ffmpeg",["-v","error","-f","lavfi","-i","color=c=green:s=160x90:r=12:d=1",
    "-threads","1","-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart",`${temp}/clip.mp4`]);
  const video="data:video/mp4;base64,"+(await readFile(`${temp}/clip.mp4`)).toString("base64");
  const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const event = { id: 64902, creatorId: 64901, title: "Assignment fixture", description: "Fixture",
    date: "2026-07-12T00:00:00Z", createdAt: "2026-07-12T00:00:00Z", isPremium: false };
  const user = { id: 64901, username: "Fixture creator", emailVerifiedAt: "2026-01-01", isCreator: true,
    isAdmin: true, creatorStatus: "approved" };
  const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#273d45"/></svg>');
  const vehicleCaption = "#77 Northstar Motorsport — Vantage GT3 — M. Vale / J. Ibarra";
  const addedCaption = `Added caption — ${vehicleCaption}`;
  const correctedCaption = `Corrected replacement caption — ${vehicleCaption}`;
  let media = [];
  let writes = [];
  let failFirstOptions = false;
  let failedTargetOptions = false;
  let analysisRunning = false;
  let lateAnalysis = false;
  let lateAnalysisResponses = 0;
  let delayPreview = false;
  const failures = [];
  const respond = (requestId, value, responseCode = 200) => browser.command("Fetch.fulfillRequest", {
    requestId, responseCode,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    body: Buffer.from(JSON.stringify(value)).toString("base64"),
  }).catch(error => { if (!String(error).includes("Invalid InterceptionId")) failures.push(String(error)); });

  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const url = new URL(request.url);
    const path = url.pathname;
    let body = [];
    let status = 200;
    if (path === "/api/user") body = user;
    else if (path === "/api/creator/usage") body = { bytes: 0, galleries: 1, photos: 2,
      limits: { bytes: 500000000, galleries: 5, photos: 1000, imageBytes: 5000000 },
      exception: false, adminExempt: true, eventStats: [{ eventId: event.id, photos: 2, videos: 0, downloads: 0 }] };
    else if (path === "/api/creator/events" || path === "/api/admin/events" || path === "/api/events") body = [event];
    else if (path === `/api/events/${event.id}`) body = event;
    else if (path === "/api/creator/media" || path === "/api/media" || path === `/api/events/${event.id}/media`) body =
      url.searchParams.get("pagination")==="true" ? {...pageMetadata(media.length,1,48),items:media} : media;
    else if (path === "/api/admin/media-usage") body = {
      total: { bytes: "0", count: "2", legacy: "0", legacyTextBytes: "0" }, byEvent: [], byCreator: [],
      cleanupCount: "0", policy: { eventBytes: 500000000, creatorBytes: 500000000, eventCount: 500, creatorCount: 500 }, warningFraction: 0.8,
    };
    else if (path === "/api/admin/safety") body = { media: [], events: [] };
    else if (path.endsWith("/analyze")) {
      analysisRunning = true;
      body = { status: "queued", generation: 2 };
    } else if (path.endsWith("/analysis")) {
      if (lateAnalysis) lateAnalysisResponses++;
      const item = media.find(entry => path.includes(`/${entry.id}/`));
      body = { status: analysisRunning ? "running" : "not_requested", generation: analysisRunning ? 2 : 1,
        caption: lateAnalysis ? "Late analysis caption" : item?.caption || "", tags: item?.tags || [],
        identification: lateAnalysis ? [] : item?.identification || [],
        recognitionSession: item?.recognitionSession || "" };
    }
    else if (path.endsWith("/number-options") && request.method === "GET") {
      if (failFirstOptions && path.includes("/64903/") && !failedTargetOptions) {
        failedTargetOptions = true;
        status = 503;
        body = { error: "Number references are temporarily unavailable." };
      } else if (path.includes("/64904/")) {
        body = { snapshot: "empty-snapshot", replaceCaptionRequired: false, identification: [], caption: "No number",
          session: "Race 2", options: [], context: "Race 2 · Fixture event" };
      } else {
        const replacement = url.searchParams.get("replaceIndex") === "0";
        body = {
          snapshot: replacement ? "snapshot-replace" : "snapshot-add",
          replaceCaptionRequired: true,
          identification: media[0].identification.length ? media[0].identification : [{ number: "12", team: "Old team", drivers: "Prior lineup", vehicle: "Old car", manufacturer: "Old Works", racingClass: "GT", source: "manual" }],
          caption: "Fixture original caption", session: "Race 2",
          context: "Race 2 · Fixture event · Practice",
          options: [
            { id: "entry-77", number: "77", identification: { number: "77", team: "Northstar Motorsport", drivers: "M. Vale / J. Ibarra",
              vehicle: "Vantage GT3", manufacturer: "Aston Martin", racingClass: "GT3", source: "reference" },
              contexts: ["Race 2", "Registered lineup"], conflict: true, caption: replacement ? correctedCaption : addedCaption },
            { id: "entry-8", number: "8", identification: { number: "8", team: "Paddock Works", drivers: "L. Chen",
              vehicle: "R9", manufacturer: "Rennsport", racingClass: "GT3", source: "reference" },
              contexts: ["Qualifying", "Class GT3"], conflict: false, caption: "Caption for #8 Paddock Works" },
            { id: "entry-9", number: "9", identification: { number: "9", team: "Third team", drivers: "Third lineup", vehicle: "Third car", source: "manual" },
              contexts: ["Race 2"], conflict: false, caption: "Third caption" },
            { id: "entry-alt77", number: "077", identification: { number: "077", team: "Alternative", drivers: "Alt lineup", vehicle: "Alt car", source: "manual" },
              contexts: ["Race 2"], conflict: true, caption: "Alternative caption" },
          ],
        };
      }
    } else if (path.endsWith("/number-assignment-preview")) {
      const payload=JSON.parse(request.postData);
      body={caption:payload.replaceIndex===undefined ? `${addedCaption} | ${payload.selectionIds.join(" | ")}` : correctedCaption,
        identification:payload.selectionIds.map(id=>({number:id.replace("entry-","")}))};
      if(delayPreview && payload.selectionIds.length===1 && payload.selectionIds[0]==="entry-8") {
        delayPreview=false;
        setTimeout(()=>respond(requestId,{...body,caption:"Obsolete single-car preview"}),700);
        return;
      }
    } else if (path.endsWith("/assign-number") && request.method === "POST") {
      const payload = JSON.parse(request.postData);
      writes.push(payload);
      if (writes.length === 1) {
        status = 409;
        body = { error: "Reference snapshot changed. Reload and choose a number again." };
      } else {
        media = media.map(item => item.id === Number(path.split("/")[3]) ? {
          ...item, caption: payload.replaceIndex === undefined ? `${addedCaption} | ${payload.selectionIds.join(" | ")}` : correctedCaption,
          identification: payload.replaceIndex === undefined ? [...item.identification,...payload.selectionIds.map(id=>({
            number:id.replace("entry-",""),team:id==="entry-8"?"Paddock Works":"Third team",drivers:"Fixture lineup",source:"manual",
          }))] : [{ number: "77", team: "Northstar Motorsport", drivers: "M. Vale / J. Ibarra", source: "manual" }],
        } : item);
        body = media.find(item => item.id === Number(path.split("/")[3]));
      }
    }
    respond(requestId, body, status);
  });

  await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
  const click = selector => browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
  const fillInput = (selector, value) => browser.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const openDashboard = async (role, width) => {
    const touch = width < 600;
    await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: touch });
    await browser.command("Emulation.setTouchEmulationEnabled", { enabled: touch });
    await browser.command("Page.navigate", { url: new URL(role === "creator" ? "/creator/dashboard" : "/admin/dashboard", base).href });
    if (role === "creator") {
      await browser.wait(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='My Galleries')`);
      await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='My Galleries').click()`);
      await browser.wait(`[...document.querySelectorAll('[role="tab"]')].some(t=>t.textContent.includes('Manage Media'))`);
      await browser.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(t=>t.textContent.includes('Manage Media')).focus()`);
      await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    } else {
      await browser.wait(`[...document.querySelectorAll('[role="tab"]')].some(t=>t.textContent.includes('Media Management'))`);
      await browser.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(t=>t.textContent.includes('Media Management')).focus()`);
      await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    }
    await browser.wait(`!!document.querySelector('select')`);
    await browser.evaluate(`(()=>{const s=document.querySelector('select');s.value='${event.id}';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await browser.wait(`!!document.querySelector('[aria-label="Assign number to Fixture target"]')`);
  };

  try {
    for (const role of ["creator", "admin"]) {
      user.isAdmin=role==="admin";
      for (const width of [1280, 390]) {
        media = [
          { id: 64903, eventId: event.id, type: "image", thumbnail: image, url: image, caption: "Fixture target",
            photographer: "", createdAt: "2026-07-12T00:00:00Z", tags: [], identification: [], recognitionSession: "Race 2", isPremium: false },
          { id: 64904, eventId: event.id, type: "image", thumbnail: image, url: image, caption: "No number reference",
            photographer: "", createdAt: "2026-07-12T00:00:00Z", tags: [], identification: [], recognitionSession: "Race 2", isPremium: false },
        ];
        if (role === "creator" && width === 390) {media[0].type = "video";media[0].url=video;}
        writes = [];
        failFirstOptions = true;
        failedTargetOptions = false;
        analysisRunning = false;
        lateAnalysis = false;
        lateAnalysisResponses = 0;
        await openDashboard(role, width);
        await browser.wait(`document.querySelector('[role="alert"]')?.innerText.includes('temporarily unavailable')`);

        await browser.evaluate(role === "creator"
          ? `document.querySelector('[aria-label="Edit media: Fixture target"]').click()`
          : `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Edit Media').click()`);
        await browser.wait(`!!document.querySelector('[role="dialog"] #photographer')`);
        if (role === "creator" && width === 390) {
          await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.includes('Analyze video')).click()`);
          await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Analyzing video')`);
          await browser.wait(`!document.querySelector('[role="dialog"] [aria-label="Assign number to Fixture target"]').disabled`);
        }
        await fillInput('[role="dialog"] #photographer', "Unsaved photographer");
        await fillInput('[role="dialog"] #recognition-session', "Unsaved session");
        await browser.wait(`document.querySelector('[role="dialog"] [aria-label="Assign number to Fixture target"]').disabled`);
        assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]')?.innerText.includes('Save changes first before assigning a number')`), true);
        if(media[0].type==="video"){
          // Native media controls can consume Escape in touch-emulated Chromium.
          await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Close').click()`);
        }else{
          await browser.evaluate(`document.querySelector('[role="dialog"] #photographer').focus()`);
          await browser.command("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
          await browser.command("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
        }
        await browser.wait(`!document.querySelector('[role="dialog"]')`);

        await browser.wait(`document.querySelector('[aria-label="Assign number to No number reference"]')?.disabled`);
        await browser.wait(`document.body.innerText.includes('Upload or save an entry/reference list with race numbers')`);
        assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Assign number to No number reference"]').disabled`), true);
        await click('[aria-label="Assign number to No number reference"]');
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
        await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Refresh references')).click()`);
        await browser.wait(`document.querySelector('[aria-label="Assign number to No number reference"]')?.disabled`);

        await browser.wait(`document.querySelector('[role="alert"]')?.innerText.includes('temporarily unavailable')`);
        await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Retry reference check')).click()`);
        await browser.wait(`!document.querySelector('[role="alert"]')?.innerText.includes('temporarily unavailable')`);
        await browser.wait(`!document.querySelector('[aria-label="Assign number to Fixture target"]').disabled`);

        await click('[aria-label="Assign number to Fixture target"]');
        await browser.wait(`document.querySelector('[role="dialog"]')?.innerText.includes('Northstar Motorsport')`);
        if (role === "creator" && width === 390) {
          assert.equal(await browser.evaluate(`!!document.querySelector('[role="dialog"] video[aria-label="Video preview"]')`), true);
        }
        await browser.evaluate(`document.querySelector('[role="dialog"] button[role="checkbox"]').focus()`);
        await browser.command("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
        await browser.command("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
        await browser.wait(`document.querySelector('[role="dialog"] button[role="checkbox"]')?.getAttribute('aria-checked')==='true'`);
        await fillInput('[role="dialog"] input[type="search"]',"Alternative");
        await browser.wait(`document.querySelector('[role="dialog"] button[role="checkbox"]')?.textContent.includes('Alternative')`);
        assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"] button[role="checkbox"]').disabled`),true);
        await fillInput('[role="dialog"] input[type="search"]',"8");
        await browser.wait(`document.querySelector('[aria-label="Selected vehicles"]')?.innerText.includes('#77')`);
        await click('[role="dialog"] button[role="checkbox"]');
        await browser.wait(`document.querySelector('[aria-label="Selected vehicles"]')?.innerText.includes('(2)')`);
        await click('[aria-label="Remove selected #77 Northstar Motorsport"]');
        await browser.wait(`!document.querySelector('[aria-label="Selected vehicles"]')?.innerText.includes('#77')`);
        await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Cancel').click()`);
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
        assert.equal(writes.length, 0, "cancelling a selected candidate must not persist an assignment");

        await click('[aria-label="Assign number to Fixture target"]');
        await browser.wait(`document.querySelector('[role="dialog"]')?.innerText.includes('Northstar Motorsport')`);
        await browser.evaluate(`(()=>{const s=document.querySelector('[role="dialog"] select');s.value='0';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await browser.wait(`document.querySelector('[role="dialog"] select')?.selectedOptions[0].text.includes('#12')`);
        await browser.wait(`!!document.querySelector('[role="dialog"] input[type="search"]')`);
        const search = await browser.evaluate(`document.querySelector('[role="dialog"] input[type="search"]')?.getAttribute('placeholder')`);
        assert.ok(search?.includes("Search number"));
        await browser.evaluate(`(()=>{const input=document.querySelector('[role="dialog"] input[type="search"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'77');
          input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await browser.wait(`document.querySelector('[role="dialog"]')?.innerText.includes('conflicting reference details')`);
        await browser.evaluate(`document.querySelector('[role="dialog"] [role="radio"]').click()`);
        await browser.wait(`document.querySelector('[role="dialog"]')?.innerText.includes('Corrected replacement caption')`);
        assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]')?.innerText.includes(${JSON.stringify(correctedCaption)})`), true);
        const bounds=await browser.evaluate(`(()=>{const r=document.querySelector('[role="dialog"]').getBoundingClientRect();
          return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
        assert.ok(bounds.left>=0 && bounds.right<=bounds.width && bounds.top>=0 && bounds.bottom<=bounds.height,
          "assignment dialog stays within the CSS viewport");
        if(role==="admin" && width===390){
          await mkdir("generated-artifacts",{recursive:true});
          const shot=await browser.command("Page.captureScreenshot",{format:"jpeg",quality:75});
          await writeFile("generated-artifacts/assign-number-mobile.jpg",Buffer.from(shot.data,"base64"));
        }
        assert.equal(await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.includes('Save assignment')).disabled`), true);
        await browser.evaluate(`document.querySelector('[role="dialog"] [role="checkbox"]').click()`);
        assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"] [role="checkbox"]').getAttribute('aria-checked')`), "true");
        await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.includes('Save assignment')).click()`);
        await browser.wait(`document.querySelector('[role="dialog"]')?.innerText.includes('changed')`);
        await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.includes('Reload references and choose again')).click()`);
        await browser.wait(`!!document.querySelector('[role="dialog"]')?.querySelector('[role="radio"]')`);
        await browser.evaluate(`document.querySelector('[role="dialog"] [role="radio"]').click()`);
        await browser.evaluate(`document.querySelector('[role="dialog"] [role="checkbox"]').click()`);
        await browser.wait(`[...document.querySelectorAll('[role="dialog"] button')].some(b=>b.textContent.includes('Save assignment') && !b.disabled)`);
        await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.includes('Save assignment')).click()`);
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
        await browser.wait(`document.body.innerText.includes('Corrected replacement caption')`);
        assert.equal(await browser.evaluate(`document.body.innerText.includes(${JSON.stringify(correctedCaption)})`), true);
        assert.equal(writes.length, 2);
        assert.equal(writes[0].snapshot, "snapshot-replace");
        assert.deepEqual(writes[0].selectionIds, ["entry-77"]);
        assert.equal(writes[0].replaceIndex, 0);
        assert.equal(writes[0].replaceCaption, true);
        assert.equal(writes[1].snapshot, "snapshot-replace");
        assert.equal(writes[1].replaceCaption, true);

        // Add two cars from the parent editor, then deliver obsolete analysis.
        analysisRunning=false;
        await browser.evaluate(role === "creator"
          ? `[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith('Edit media:')).click()`
          : `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Edit Media').click()`);
        await browser.wait(`!!document.querySelector('[role="dialog"] #caption')`);
        await browser.wait(`!document.querySelector('[role="dialog"] button[aria-label^="Assign number to"]').disabled`);
        await browser.wait(`[...document.querySelectorAll('[role="dialog"] button')].some(b=>b.textContent.includes('Generate tags') || b.textContent.includes('Analyze video'))`);
        await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.includes('Generate tags') || b.textContent.includes('Analyze video')).click()`);
        await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Adding tags') || document.querySelector('[role="dialog"]')?.textContent.includes('Analyzing video')`);
        await browser.evaluate(`document.querySelector('[role="dialog"] button[aria-label^="Assign number to"]').click()`);
        await browser.wait(`!!document.querySelector('button[role="checkbox"]')`);
        delayPreview=true;
        await fillInput('input[type="search"]',"8");
        await browser.wait(`document.querySelector('button[role="checkbox"]')?.textContent.includes('Paddock Works')`);
        await click('button[role="checkbox"]');
        await browser.wait(`document.querySelector('[aria-label="Selected vehicles"]')?.textContent.includes('Paddock Works')`);
        await fillInput('input[type="search"]',"Third team");
        await browser.wait(`document.querySelector('button[role="checkbox"]')?.textContent.includes('Third team')`);
        await click('button[role="checkbox"]');
        await browser.wait(`document.querySelector('[aria-label="Caption preview"]')?.innerText.includes('entry-8 | entry-9')`);
        await new Promise(resolve=>setTimeout(resolve,850));
        assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Caption preview"]')?.innerText.includes('Obsolete single-car preview')`),false);
        await browser.evaluate(`document.querySelector('[role="dialog"] label [role="checkbox"]').click()`);
        await browser.wait(`[...document.querySelectorAll('[role="dialog"] button')].some(b=>b.textContent.includes('Save assignment') && !b.disabled)`);
        await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.includes('Save assignment')).click()`);
        await browser.wait(`document.querySelectorAll('[role="dialog"]').length===1 && !!document.querySelector('#identification-2-number')`);
        assert.deepEqual(writes[2].selectionIds,["entry-8","entry-9"]);
        assert.deepEqual(media[0].identification.map(i=>i.number),["77","8","9"]);
        assert.equal(await browser.evaluate(`document.querySelector('#caption').value`),media[0].caption);
        // The polling response is deliberately an older state than the confirmed save.
        lateAnalysis=true;
        const deadline=Date.now()+10000;
        while(!lateAnalysisResponses && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,100));
        assert.ok(lateAnalysisResponses>0,"obsolete analysis actually reached the editor");
        await new Promise(resolve=>setTimeout(resolve,150));
        assert.equal(await browser.evaluate(`document.querySelector('#caption').value`),media[0].caption);
        assert.equal(await browser.evaluate(`document.querySelector('#identification-2-number').value`),"9");
        await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Close').click()`);
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
        analysisRunning=false;lateAnalysis=false;
        await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Assign number' && !b.disabled).click()`);
        await browser.wait(`document.querySelector('[role="dialog"]')?.innerText.includes('3 / 12 vehicles')`);
        assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"] button[role="checkbox"]').disabled`),true);
        await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Cancel').click()`);
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
        media[0]={...media[0],caption:"Fixture target",identification:Array.from({length:11},(_,i)=>({
          number:String(100+i),team:"Existing",vehicle:"Car",drivers:"Lineup",source:"manual",
        }))};
        await openDashboard(role,width);
        await click('[aria-label="Assign number to Fixture target"]');
        await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes('11 / 12 vehicles')`);
        await click('button[role="checkbox"]');
        await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes('12 / 12 vehicles')`);
        assert.equal(await browser.evaluate(`[...document.querySelectorAll('button[role="checkbox"]')].find(b=>b.textContent.includes('Paddock Works')).disabled`),true);
        await click('[aria-label="Remove selected #77 Northstar Motorsport"]');
        await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes('11 / 12 vehicles')`);
        assert.equal(await browser.evaluate(`[...document.querySelectorAll('button[role="checkbox"]')].find(b=>b.textContent.includes('Paddock Works')).disabled`),false);
        await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Cancel').click()`);
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
      }
    }
    assert.deepEqual(failures, []);
    assert.deepEqual(browser.errors, []);
  } finally {
    await browser.close();
    await rm(temp,{recursive:true,force:true});
  }
});
