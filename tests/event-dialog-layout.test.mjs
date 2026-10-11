import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser } from "./helpers/ui-browser.mjs";
import { writeFile } from "node:fs/promises";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
for (const [width, height] of [[1280, 900], [402, 874]]) {
  test(`event editor ends at its actions without empty scroll space at ${width}px`, {timeout:60000}, async () => {
    const browser = await uiBrowser();
    const event = {id:95601,title:"Dialog layout fixture",description:"Synthetic layout fixture",
      date:"2026-10-11T00:00:00.000Z",creatorId:null,customThumbnail:null,coverImage:null,
      isPremium:false,visibility:"draft"};
    const errors = [];
    browser.listeners.add(message => {
      if (message.method !== "Fetch.requestPaused") return;
      const {requestId, request} = message.params;
      const path = new URL(request.url).pathname;
      let content = [];
      if (path === "/api/user") content = {id:99999,username:"synthetic-admin",isAdmin:true};
      if (path === "/api/admin/events" || path === "/api/events") content = [event];
      if (path === "/api/events/95601") content = event;
      if (path.endsWith("/thumbnail-options")) content = {page:1,photos:[],hasMore:false};
      if (path.endsWith("/nextcloud/sources")) content = {sources:[
        {id:"layout-source",link:"https://example.invalid/public/folder",hasPassword:true},
      ]};
      if (path.endsWith("/nextcloud")) content = {status:"completed",saved:142,found:209,
        images:141,videos:1,analysisPending:8,analysisCompleted:134,aiWarnings:0,
        run:{found:142,existing:59,imported:16,skipped:8,failed:2},
        files:[{message:"Synthetic file could not be imported."}]};
      if (path === "/api/admin/safety") content = {media:[],events:[]};
      if (path === "/api/admin/media-usage") content = {total:{bytes:"0",count:"0",legacy:"0"},
        byEvent:[],byCreator:[],cleanupCount:"0",policy:{eventBytes:1000000,creatorBytes:1000000,eventCount:100,creatorCount:100}};
      browser.command("Fetch.fulfillRequest", {requestId,responseCode:200,
        responseHeaders:[{name:"Content-Type",value:"application/json"}],
        body:Buffer.from(JSON.stringify(content)).toString("base64")}).catch(e=>errors.push(String(e)));
    });
    try {
      await browser.command("Emulation.setDeviceMetricsOverride", {width,height,deviceScaleFactor:1,mobile:width<500});
      await browser.command("Fetch.enable", {patterns:[{urlPattern:"*/api/*"}]});
      await browser.command("Page.navigate", {url:new URL("/admin/dashboard",base).href});
      await browser.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Edit Event')");
      await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Edit Event').click()");
      await browser.wait("document.getElementById('title')?.value==='Dialog layout fixture'");
      await browser.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Update Event')");
      await browser.wait("document.body.innerText.includes('Imports resume automatically')");
      // Wait for dialog animations to settle before measuring or scrolling.
      await browser.evaluate("new Promise(resolve=>setTimeout(resolve,300))");
      const geometry = await browser.evaluate(`(()=>{
        const dialog=document.querySelector('[role=dialog]');
        const button=[...dialog.querySelectorAll('button')].find(b=>b.textContent.trim()==='Update Event');
        dialog.scrollTop=dialog.scrollHeight;
        const bounds=dialog.getBoundingClientRect(), actions=button.getBoundingClientRect();
        return {viewport:innerWidth,height:innerHeight,top:bounds.top,bottom:bounds.bottom,
          dialogHeight:bounds.height,scrollHeight:dialog.scrollHeight,scrollTop:dialog.scrollTop,
          trailingSpace:bounds.bottom-actions.bottom,buttonTop:actions.top,buttonBottom:actions.bottom,
          display:getComputedStyle(dialog).display,
          horizontalOverflow:dialog.scrollWidth-dialog.clientWidth};
      })()`);
      console.log("EVENT_DIALOG_GEOMETRY", geometry);
      assert.equal(geometry.viewport,width);
      assert.equal(geometry.display,"block", "long form uses normal document flow, not stretched grid tracks");
      assert.ok(geometry.trailingSpace <= 40, `Unnecessary trailing space: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.trailingSpace >= 0 && geometry.buttonTop >= geometry.top);
      assert.ok(geometry.top >= 0 && geometry.bottom <= height+1);
      assert.ok(geometry.horizontalOverflow <= 1);
      assert.deepEqual(errors,[]);
      assert.deepEqual(browser.errors,[]);
      const screenshot = await browser.command("Page.captureScreenshot", {format:"png"});
      await writeFile(`/tmp/vco-event-layout-${width}.png`, Buffer.from(screenshot.data,"base64"));
    } finally { await browser.close(); }
  });
}
