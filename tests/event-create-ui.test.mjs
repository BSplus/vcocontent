import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const findButton = text => `[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
const input = (browser,id,value) => browser.evaluate(`(()=>{
  const el=document.getElementById(${JSON.stringify(id)});
  Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
  el.dispatchEvent(new Event('input',{bubbles:true}));
})()`);

for (const mode of ["started","source-rejected","creation-rejected","lost","invalid"])
  test(`event creation ${mode}: clear feedback, background import and no duplicate`, { timeout: 90000 }, async () => {
    const browser = await uiBrowser(), mockErrors = [];
    let creates = 0, starts = 0, sourceWrites = 0;
    const event = {id:95831,title:"Creation fixture",description:"Fixture",
      date:"2026-10-13T00:00:00Z",creatorId:null,visibility:"draft",safetyStatus:"legacy"};
    const progress = {status:"queued",total:1,imported:0,importedImages:0,importedVideos:0,
      failed:0,skipped:0,warnings:0,analysisPending:0,analysisCompleted:0,files:[]};
    browser.listeners.add(message => {
      if (message.method !== "Fetch.requestPaused") return;
      const {requestId,request} = message.params, pathname = new URL(request.url).pathname;
      let body = [], status = 200;
      if (pathname === "/api/user") body = {id:99999,username:"Synthetic admin",isAdmin:true};
      else if (pathname === "/api/admin/safety") body = {media:[],events:[]};
      else if (pathname === "/api/admin/media-usage") body = null;
      else if (pathname.endsWith("/nextcloud/preview")) body = {count:1,images:1,videos:0,skipped:0};
      else if (pathname.endsWith("/nextcloud/sources")) {
        sourceWrites++;
        if (mode === "source-rejected" && sourceWrites === 1) {
          status = 400; body = {error:"Synthetic source access expired"};
        } else body = {sources:[{id:"synthetic",link:"https://nextcloud.vco-motorsports.com/s/SYNTHETIC",hasPassword:false}]};
      } else if (pathname.endsWith("/nextcloud/update")) { starts++; status = 202; body = progress; }
      else if (pathname.endsWith("/nextcloud")) body = progress;
      else if (pathname === "/api/events" && request.method === "POST") {
        creates++;
        if (mode === "creation-rejected") {status=400;body={error:"Synthetic gallery limit reached"};}
        else if (mode === "lost") {
          void browser.command("Fetch.failRequest",{requestId,errorReason:"ConnectionClosed"}).catch(e=>mockErrors.push(String(e)));
          return;
        } else {status=201;body=event;}
      } else if (pathname === "/api/events" || pathname === "/api/admin/events") body = creates ? [event] : [];
      void browser.command("Fetch.fulfillRequest",{requestId,responseCode:status,
        responseHeaders:[{name:"Content-Type",value:"application/json"}],
        body:Buffer.from(JSON.stringify(body)).toString("base64")}).catch(e=>{
          // Closing the dialog cancels in-flight query requests; their CDP IDs expire.
          if (!String(e).includes("Invalid InterceptionId")) mockErrors.push(String(e));
        });
    });
    const click = async text => {
      await browser.wait(`!!(${findButton(text)})&&!(${findButton(text)}).disabled`);
      await browser.evaluate(`(${findButton(text)}).click()`);
    };
    try {
      await browser.command("Fetch.enable",{patterns:[{urlPattern:"*/api/*"}]});
      await browser.command("Page.navigate",{url:new URL("/admin/dashboard",base).href});
      await browser.wait(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Create VCO Event'))`);
      await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Create VCO Event')).click()`);
      await browser.wait("!!document.getElementById('title')");
      if (mode === "invalid") {
        await click("Create Event");
        await browser.wait(`document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('Title is required')`);
        assert.match(await browser.evaluate(`document.querySelector('[role="dialog"] [role="alert"]').textContent`),/Description is required/);
        assert.equal(creates,0);
        return;
      }
      await input(browser,"title","Creation fixture");
      await input(browser,"description","Fixture");
      await browser.evaluate("document.getElementById('image-source').focus()");
      await browser.command("Input.dispatchKeyEvent",{type:"keyDown",key:" ",code:"Space",windowsVirtualKeyCode:32});
      await browser.command("Input.dispatchKeyEvent",{type:"keyUp",key:" ",code:"Space",windowsVirtualKeyCode:32});
      await browser.wait("!!document.querySelector('[role=option]')");
      const position = await browser.evaluate(`(()=>{
        const el=[...document.querySelectorAll('[role=option]')].find(n=>n.textContent.includes('Import a Nextcloud folder'));
        el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
      await browser.command("Input.dispatchMouseEvent",{type:"mouseMoved",...position});
      await browser.command("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...position});
      await browser.command("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...position});
      await browser.wait("!!document.getElementById('nc-link-0')");
      assert.equal(await browser.evaluate(`(${findButton("Create event and import")}).disabled`),true);
      assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]').textContent.includes('Use Check access and media')`),true);
      await input(browser,"nc-link-0","https://nextcloud.vco-motorsports.com/s/SYNTHETIC");
      await click("Check access and media");
      await click("Create event and import");
      if (mode === "started") {
        await browser.wait(`!document.querySelector('[role="dialog"]')`);
        await browser.wait(`document.body.textContent.includes('Event created — import started')`);
        assert.equal(starts,1);
      } else {
        await browser.wait(`!!document.querySelector('[role="dialog"] [role="alert"]')`);
        const alert = await browser.evaluate(`document.querySelector('[role="dialog"] [role="alert"]').textContent`);
        assert.equal(await browser.evaluate("document.getElementById('title').value"),"Creation fixture");
        if (mode === "lost") {
          assert.match(alert,/may already exist|did not confirm/);
          assert.equal(await browser.evaluate(`(${findButton("Create event and import")}).disabled`),true);
        } else if (mode === "creation-rejected") assert.match(alert,/Synthetic gallery limit reached/);
        else {
          assert.match(alert,/event is saved.*Synthetic source access expired/i);
          await click("Start / resume import");
          await browser.wait(`!document.querySelector('[role="dialog"]')`);
          assert.equal(starts,1);
        }
      }
      assert.equal(creates,1);
      assert.deepEqual(mockErrors,[]);
      assert.deepEqual(browser.errors,[]);
    } finally {await browser.close();}
  });
