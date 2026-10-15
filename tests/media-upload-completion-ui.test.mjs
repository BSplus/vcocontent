import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const id = 96701;
const poster = "/attached_assets/%2389_3.png";
const button = label => `[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
const click = async (browser, label) => {
  await browser.wait(`!!(${button(label)}) && !(${button(label)}).matches(':disabled')`);
  await browser.evaluate(`(${button(label)}).click()`);
};

async function fixture(role, width, resumable=false) {
  const browser = await uiBrowser();
  try {
  const state = { mode: "success", posts: [], reads: [], held: [], photos: [], mockErrors: [], analysis: "queued" };
  state.session=null;state.sessionStarts=0;state.partAttempts=[];
  const gallery = { id, title: "Upload fixture", description: "Isolated browser data",
    date: "2026-10-13T00:00:00Z", creatorId: role === "admin" ? null : 96700,
    visibility: "published", safetyStatus: "approved", coverImage: poster };
  const fulfill = (requestId, body, status = 200, raw) => browser.command("Fetch.fulfillRequest", {
    requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    body: Buffer.from(raw ?? JSON.stringify(body)).toString("base64"),
  }).catch(error => {
    if (!String(error).includes("Invalid InterceptionId")) state.mockErrors.push(String(error));
  });
  const save = requestId => {
    const photo = { id: 96800 + state.photos.length, eventId: id, type: "image",
      caption: `Saved fixture ${state.photos.length + 1}`, tags: [], url: poster, thumbnail: poster,
      safetyStatus: "pending", downloadCount: 0 };
    state.photos.push(photo);
    return fulfill(requestId, photo, 201);
  };
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    if(resumable && path.includes("upload-sessions")){
      if(path.includes("/by-request/")){
        void fulfill(requestId,state.session || {error:"Not found"},state.session?200:404);return;
      }
      if(request.method==="POST" && path.endsWith("/upload-sessions")){
        const body=JSON.parse(request.postData);
        state.sessionStarts++;
        state.session={id:"11111111-1111-4111-8111-111111111111",state:"receiving",size:body.size,
          sha256:body.sha256,partBytes:1048576,received:0,uploadedBytes:0,mediaId:null,
          expiresAt:new Date(Date.now()+3600000).toISOString()};
        void fulfill(requestId,state.session);return;
      }
      if(request.method==="PUT"){
        const index=Number(path.split("/").at(-1));state.partAttempts.push(index);
        if(index===1 && state.mode==="resume-delay"){state.held.push(requestId);return;}
        state.session.received=index+1;
        state.session.uploadedBytes=Math.min(state.session.size,(index+1)*1048576);
        void fulfill(requestId,state.session);return;
      }
      if(request.method==="POST" && path.endsWith("/complete")){
        const photo={id:96800,eventId:id,type:"image",caption:"Saved resumable fixture",
          tags:[],url:poster,thumbnail:poster,safetyStatus:"pending",analysis:{status:"queued"}};
        state.photos.push(photo);
        state.session={...state.session,state:"completed",mediaId:photo.id,item:photo};
        void fulfill(requestId,state.session);return;
      }
    }
    if (request.method !== "GET") {
      if (path !== `/api/events/${id}/media/upload` || request.method !== "POST") {
        state.mockErrors.push(`Unexpected write: ${request.method} ${path}`);
        void fulfill(requestId, { error: "No real writes allowed" }, 405);
        return;
      }
      state.posts.push(request.postData ?? "");
      const attempt = state.posts.length;
      if (state.mode === "delay") state.held.push(requestId);
      else if (state.mode === "rejected" || state.mode === "partial" && attempt === 2)
        void fulfill(requestId, { error: "Synthetic file rejection" }, 413);
      else if (state.mode === "lost")
        void browser.command("Fetch.failRequest", { requestId, errorReason: "ConnectionClosed" })
          .catch(error => state.mockErrors.push(String(error)));
      else if (state.mode === "invalid") void fulfill(requestId, null, 201, "{invalid JSON");
      else if (state.mode === "missing-id") void fulfill(requestId, { eventId: id }, 201);
      else if (state.mode === "gateway") void fulfill(requestId, { error: "Synthetic gateway outage" }, 502);
      else void save(requestId);
      return;
    }
    state.reads.push(path);
    let body = [];
    if (path === "/api/user") body = { id: 96700, username: "SyntheticUploader", isAdmin: role === "admin",
      isCreator: true, creatorStatus: "approved", emailVerifiedAt: gallery.date };
    else if (path === "/api/admin/events" || path === "/api/creator/events" || path === "/api/events") body = [gallery];
    else if (path === "/api/admin/safety") body = { media: [], events: [] };
    else if (path === "/api/admin/media-usage") body = { total: { bytes: String(state.photos.length * 1000000),
      count: String(state.photos.length), legacy: "0" }, byEvent: [], byCreator: [], cleanupCount: "0",
      policy: { eventBytes: 100000000, creatorBytes: 100000000, eventCount: 100, creatorCount: 100 }, warningFraction: 0.8 };
    else if (path === "/api/creator/usage") body = { bytes: state.photos.length * 1000000, galleries: 1,
      photos: state.photos.length, unknown: 0, pendingCleanup: 0, adminExempt: false,
      limits: { bytes: 500000000, galleries: 5, photos: 1000, imageBytes: 5000000 },
      eventStats: [{ eventId: id, photos: state.photos.length, videos: 0, downloads: 0 }] };
    else if (path === "/api/media" || path === "/api/creator/media" || path === `/api/events/${id}/media`) {
      body = state.photos;
      if (new URL(request.url).searchParams.get("pagination") === "true")
        body = { items: state.photos, page: 1, totalPages: 1, hasMore: false };
    } else if (path === "/api/media/policy") body = { community: role !== "admin", imageBytes: 5000000,
      videoBytes: role === "admin" ? 10000000 : 0, maxPixels: 40000000, zipCount: 100, zipBytes: 104857600,
      resumableUploads:resumable };
    else if (path === `/api/events/${id}/analysis`) body = state.photos.map(photo => ({
      mediaId: photo.id, status: state.analysis,
      error: state.analysis === "failed" ? "Synthetic analysis failure" : null,
      tags: state.analysis === "completed" ? ["Race Action"] : null,
    }));
    void fulfill(requestId, body);
  });
  await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
  await browser.command("Page.navigate", { url: new URL(`/${role}/dashboard`, base).href });
  if (role === "creator") {
    await browser.wait(`!!document.querySelector('nav[aria-label="Creator Studio sections"]')`);
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='My Galleries').click()`);
  }
  const open = async () => {
    await browser.wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Upload Media')`);
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Upload Media').click()`);
    await browser.wait(`!!document.querySelector('[role="dialog"] input[type="file"]')`);
    await delay(100);
  };
  const select = async (names,padding=0) => {
    await browser.evaluate(`(()=>{
      const input=document.querySelector('[role="dialog"] input[type="file"]');
      const files=new DataTransfer();
      for(const name of ${JSON.stringify(names)}) files.items.add(new File(['synthetic image',new Uint8Array(${padding})],name,{type:'image/png'}));
      input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.wait(`document.querySelectorAll('[role="dialog"] img').length===${names.length}`);
  };
  const reset = () => { state.posts = []; state.held = []; state.mode = "success"; state.analysis = "queued"; };
  return { browser, state, open, select, save, reset };
  } catch(error) {await browser.close();throw error;}
}

for (const role of ["creator", "admin"]) for (const width of [1280, 390])
  test(`${role} upload completion, retry and dismissal protection at ${width}px`, { timeout: 180000 }, async () => {
    const { browser, state, open, select, save, reset } = await fixture(role, width);
    try {
      // Track actual preview cleanup, not just a blank-looking re-opened form.
      await browser.evaluate(`(()=>{
        window.uploadPreviews=[];window.revokedPreviews=[];
        const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
        URL.createObjectURL=blob=>{const url=create(blob);window.uploadPreviews.push(url);return url;};
        URL.revokeObjectURL=url=>{window.revokedPreviews.push(url);revoke(url);};
      })()`);
      for (const count of [1, 3]) {
        reset(); await open();
        await select(Array.from({ length: count }, (_, i) => `success-${i}.png`));
        const readsBefore = state.reads.length;
        await click(browser, `Upload ${count} ${count === 1 ? "file" : "files"}`);
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
        await browser.wait(`document.body.textContent.includes('${count} ${count === 1 ? "file" : "files"} saved')`);
        assert.match(await browser.evaluate("document.body.innerText"), /Saving does not confirm publication; unchecked media stays private/);
        assert.equal(state.posts.length, count);
        await browser.wait(`window.uploadPreviews.every(url=>window.revokedPreviews.includes(url))`);
        assert.ok(state.reads.slice(readsBefore).includes(role === "admin" ? "/api/admin/media-usage" : "/api/creator/usage"));
        assert.ok(state.reads.slice(readsBefore).includes(role === "admin" ? "/api/media" : "/api/creator/media"));
      }
      // Partial success remains visible, including an independent failed AI job.
      reset(); state.mode = "partial"; state.analysis = "failed";
      await open(); await select(["saved.png", "rejected.png"]);
      await click(browser, "Upload 2 files");
      await browser.wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('1 saved · 1 rejected')`);
      await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Analysis failed')`);
      assert.match(await browser.evaluate("document.querySelector('[role=\"dialog\"]').innerText"), /rejected.png[\s\S]*Synthetic file rejection/);
      assert.equal(await browser.evaluate(`(${button("Close")}).matches(':disabled')`), false);
      assert.equal(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), true);
      await browser.evaluate(`(${button("Close")}).scrollIntoView()`);
      const bounds = await browser.evaluate(`(()=>{const r=(${button("Close")}).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight}})()`);
      assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height, "completion action is reachable on narrow screens");
      state.mode = "success";
      await click(browser, "Retry upload");
      await click(browser, "Upload 1 file");
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      await browser.wait(`document.body.textContent.includes('2 files saved')`);
      assert.equal(state.posts.length, 3, "retry sends only the rejected file");
      // All rejections remain actionable; closing and reopening discards the selection.
      reset(); state.mode = "rejected";
      await open(); await select(["denied-one.png", "denied-two.png"]);
      await click(browser, "Upload 2 files");
      await browser.wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('0 saved · 2 rejected')`);
      assert.equal(await browser.evaluate(`document.querySelectorAll('[role="dialog"] button').length>0 && [...document.querySelectorAll('[role="dialog"] button')].filter(b=>b.textContent.trim()==='Retry upload').length===2`), true);
      await click(browser, "Close"); await browser.wait(`!document.querySelector('[role="dialog"]')`);
      reset(); await open();
      assert.equal(await browser.evaluate("document.querySelectorAll('[role=\"dialog\"] img').length"), 0);
      assert.equal(await browser.evaluate("document.querySelector('#caption').value"), "");
      // A delayed POST cannot be discarded or started twice.
      state.mode = "delay"; await select(["delayed.png"]);
      await browser.evaluate(`(()=>{const f=document.querySelector('[role="dialog"] form');f.requestSubmit();f.requestSubmit();})()`);
      await browser.wait(`document.querySelector('[role="dialog"] [role="status"]')?.textContent.includes('Uploading')`);
      await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", x: 2, y: 2, button: "left", clickCount: 1 });
      await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 2, y: 2, button: "left", clickCount: 1 });
      await browser.evaluate(`(()=>{
        const d=document.querySelector('[role="dialog"]');
        [...d.querySelectorAll('button')].find(b=>b.querySelector('.sr-only')?.textContent==='Close').click();
        d.querySelector('button[aria-label="Remove delayed.png"]').click();
        const files=new DataTransfer();files.items.add(new File(['x'],'injected.png',{type:'image/png'}));
        const input=d.querySelector('input[type="file"]');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
        d.querySelector('form').requestSubmit();
      })()`);
      await delay(200);
      assert.equal(state.posts.length, 1, "no concurrent or automatic duplicate POST");
      assert.equal(state.held.length, 1);
      assert.equal(await browser.evaluate("document.querySelectorAll('[role=\"dialog\"] img').length"), 1);
      assert.equal(await browser.evaluate("document.querySelector('[role=\"dialog\"]').innerText.includes('delayed.png')"), true);
      assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"] input[type="file"]').matches(':disabled')`), true);
      if (role === "admin") assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"] [role="combobox"]').matches(':disabled')`), true);
      await save(state.held.pop());
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      await browser.wait(`document.body.textContent.includes('1 file saved')`);
      assert.equal(state.posts.length, 1);
      reset(); await open();
      assert.equal(await browser.evaluate("document.querySelectorAll('[role=\"dialog\"] img').length"), 0);
      await click(browser, "Cancel"); await browser.wait(`!document.querySelector('[role="dialog"]')`);
      // The second dashboard entry refreshes its active paginated media view and usage.
      await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Manage Media' && b.getAttribute('role')!=='tab').click()`);
      await browser.wait(`document.querySelector('main')?.textContent.includes('Media for: Upload fixture')`);
      reset(); await open(); await select(["media-entry.png"]);
      const mediaReadsBefore = state.reads.length;
      await click(browser, "Upload 1 file");
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      await browser.wait(`document.querySelector('main')?.textContent.includes('Saved fixture ${state.photos.length}')`);
      await browser.wait(`document.querySelector('main')?.textContent.includes('${role === "creator" ? `${state.photos.length.toFixed(1)} MB` : `${(state.photos.length * 1000000 / 1048576).toFixed(1)} MiB`}')`);
      assert.ok(state.reads.slice(mediaReadsBefore).includes(`/api/events/${id}/media`));
      // Re-opening resets all metadata and admin media type, not only thumbnails.
      await open();
      await browser.evaluate(`(()=>{
        const set=(id,value)=>{const e=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));};
        set('photographer','Discarded fixture photographer');set('tagsInput','Discarded fixture tag');
        const caption=document.getElementById('caption');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(caption,'Discarded fixture caption');caption.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      if (role === "admin") {
        await browser.evaluate(`document.querySelector('[role="dialog"] [role="combobox"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',bubbles:true}))`);
        await browser.wait(`!!document.querySelector('[role="option"]')`);
        await browser.evaluate(`[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent==='Video').click()`);
        await browser.wait(`document.querySelector('[role="dialog"] input[type="file"]').accept==='.mp4,.mov,.webm'`);
      }
      await click(browser, "Cancel"); await browser.wait(`!document.querySelector('[role="dialog"]')`);
      await open();
      assert.equal(await browser.evaluate("document.querySelector('#caption').value"), "");
      assert.equal(await browser.evaluate("document.querySelector('#photographer').value"), "");
      assert.equal(await browser.evaluate("document.querySelector('#tagsInput').value"), "");
      assert.equal(await browser.evaluate("document.querySelector('[role=\"dialog\"] input[type=\"file\"]').accept"), ".jpg,.jpeg,.png,.gif,.webp,.zip");
      await click(browser, "Cancel"); await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.deepEqual(state.mockErrors, []); assert.deepEqual(browser.errors, []);
    } finally { await browser.close(); }
  });

for(const [role,width] of [["creator",390],["admin",1280]])
  test(`resumable ${role} can pause and resume without repeating accepted parts at ${width}px`,{timeout:90000},async()=>{
    const {browser,state,open,select}=await fixture(role,width,true);
    try{
      state.mode="resume-delay";await open();await select(["resume-fixture.png"],1048576);
      await click(browser,"Upload 1 file");
      await browser.wait(`document.querySelector('[role="dialog"]').textContent.includes('99% transferred')`);
      await click(browser,"Pause uploads");
      await browser.wait(`!!(${button("Resume / check status")}) && !(${button("Resume / check status")}).matches(':disabled')`);
      assert.equal(state.session.received,1);
      assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]').scrollWidth<=document.querySelector('[role="dialog"]').clientWidth+1`),true);
      for(const requestId of state.held.splice(0))
        await browser.command("Fetch.failRequest",{requestId,errorReason:"Aborted"}).catch(()=>{});
      state.mode="success";
      await click(browser,"Resume / check status");
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.equal(state.sessionStarts,1);assert.equal(state.photos.length,1);
      assert.deepEqual(state.partAttempts,[0,1,1]);
      assert.equal(state.posts.length,0,"No legacy non-idempotent upload fallback");
      assert.deepEqual(state.mockErrors,[]);
    }finally{await browser.close();}
  });

for (const mode of ["lost", "invalid", "missing-id", "gateway"])
  test(`unconfirmed ${mode} upload never retries or claims success`, { timeout: 60000 }, async () => {
    const { browser, state, open, select } = await fixture("creator", 390);
    try {
      state.mode = mode; await open(); await select(["uncertain.png"]); await click(browser, "Upload 1 file");
      await browser.wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('0 saved · 0 rejected · 1 unconfirmed')`);
      await delay(3500); // Exceeds the global mutation retry delay.
      assert.equal(state.posts.length, 1);
      const text = await browser.evaluate("document.querySelector('[role=\"dialog\"]').innerText");
      assert.match(text, /uncertain.png[\s\S]*may already be stored/);
      assert.doesNotMatch(text, /Done — all files saved|Retry upload/);
      assert.equal(await browser.evaluate("document.body.textContent.includes('1 file saved')"), false);
      await click(browser, "Close"); await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.deepEqual(state.mockErrors, []); assert.deepEqual(browser.errors, []);
    } finally { await browser.close(); }
  });
