import test from "node:test";
import assert from "node:assert/strict";
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
  let media = [];
  let writes = [];
  let failFirstOptions = false;
  let failedTargetOptions = false;
  let analysisRunning = false;
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
    else if (path === "/api/creator/media" || path === "/api/media" || path === `/api/events/${event.id}/media`) body = media;
    else if (path === "/api/admin/media-usage") body = {
      total: { bytes: "0", count: "2", legacy: "0", legacyTextBytes: "0" }, byEvent: [], byCreator: [],
      cleanupCount: "0", policy: { eventBytes: 500000000, creatorBytes: 500000000, eventCount: 500, creatorCount: 500 }, warningFraction: 0.8,
    };
    else if (path === "/api/admin/safety") body = { media: [], events: [] };
    else if (path.endsWith("/analyze")) {
      analysisRunning = true;
      body = { status: "queued", generation: 2 };
    } else if (path.endsWith("/analysis")) {
      const item = media.find(entry => path.includes(`/${entry.id}/`));
      body = { status: analysisRunning ? "running" : "not_requested", generation: analysisRunning ? 2 : 1,
        caption: item?.caption || "", tags: item?.tags || [], identification: item?.identification || [],
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
          identification: [{ number: "12", team: "Old team", drivers: "Prior lineup", vehicle: "Old car", manufacturer: "Old Works", racingClass: "GT", source: "manual" }],
          caption: "Fixture original caption", session: "Race 2",
          context: "Race 2 · Fixture event · Practice",
          options: [
            { id: "entry-77", number: "77", identification: { number: "77", team: "Northstar Motorsport", drivers: "M. Vale / J. Ibarra",
              vehicle: "Vantage GT3", manufacturer: "Aston Martin", racingClass: "GT3", source: "reference" },
              contexts: ["Race 2", "Registered lineup"], conflict: true, ...(replacement ? { caption: "Corrected replacement caption — #77 Northstar Motorsport" } : { caption: "Added caption — #77 Northstar Motorsport" }) },
            { id: "entry-8", number: "8", identification: { number: "8", team: "Paddock Works", drivers: "L. Chen",
              vehicle: "R9", manufacturer: "Rennsport", racingClass: "GT3", source: "reference" },
              contexts: ["Qualifying", "Class GT3"], conflict: false, caption: "Caption for #8 Paddock Works" },
          ],
        };
      }
    } else if (path.endsWith("/assign-number") && request.method === "POST") {
      const payload = JSON.parse(request.postData);
      writes.push(payload);
      if (writes.length === 1) {
        status = 409;
        body = { error: "Reference snapshot changed. Reload and choose a number again." };
      } else {
        media = media.map(item => item.id === Number(path.split("/")[3]) ? {
          ...item, caption: payload.replaceIndex === undefined ? "Added caption — #77 Northstar Motorsport" : "Corrected replacement caption — #77 Northstar Motorsport",
          identification: [{ number: "77", team: "Northstar Motorsport", drivers: "M. Vale / J. Ibarra", source: "reference" }],
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
        await browser.evaluate(`document.querySelector('[role="dialog"] [role="radio"]').focus()`);
        await browser.command("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
        await browser.command("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
        await browser.wait(`document.querySelector('[role="dialog"] [role="radio"]')?.getAttribute('aria-checked')==='true'`);
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
        await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.includes('Save assignment')).click()`);
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
        await browser.wait(`document.body.innerText.includes('Corrected replacement caption')`);
        assert.equal(writes.length, 2);
        assert.equal(writes[0].snapshot, "snapshot-replace");
        assert.equal(writes[0].selectionId, "entry-77");
        assert.equal(writes[0].replaceIndex, 0);
        assert.equal(writes[0].replaceCaption, true);
        assert.equal(writes[1].snapshot, "snapshot-replace");
        assert.equal(writes[1].replaceCaption, true);
      }
    }
    assert.deepEqual(failures, []);
    assert.deepEqual(browser.errors, []);
  } finally {
    await browser.close();
    await rm(temp,{recursive:true,force:true});
  }
});
