import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Every API request is intercepted: even when testing deployed frontend assets,
// no real events, imports, sessions or counted downloads are read or changed.
let base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
let buildServer, searchData, originalEvents;
if (process.env.EVENT_LAYOUT_BUILD === "1") {
  before(async () => {
    const { default: express } = await import("express");
    const { serveStatic } = await import("../server/vite.ts");
    ({ searchData } = await import("../server/public-search-data.ts"));
    originalEvents = searchData.events;
    searchData.events = async () => [];
    const app = express();
    // Fail closed if any request escapes browser interception.
    app.all("/api/*", (_req,res) => res.status(501).json({error:"Unmocked layout fixture request"}));
    app.use("/attached_assets",express.static(path.resolve("attached_assets")));
    serveStatic(app,path.resolve("dist/public"));
    buildServer = app.listen(0,"127.0.0.1");
    await new Promise(resolve=>buildServer.once("listening",resolve));
    base = `http://127.0.0.1:${buildServer.address().port}`;
  });
  after(async () => {
    if (searchData) searchData.events = originalEvents;
    if (buildServer) {
      buildServer.closeAllConnections();
      await new Promise(resolve=>buildServer.close(resolve));
    }
  });
}
const output = process.env.EVENT_LAYOUT_OUTPUT;
const button = label => `[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
const sources = [
  {id:"layout-source-1",link:"https://example.invalid/public/race-photos",hasPassword:true,photographer:"Fixture photographer"},
  {id:"layout-source-2",link:"https://example.invalid/public/race-videos",hasPassword:false,photographer:"Fixture videographer"},
];
const progress = status => ({
  status, error:status === "partial" ? "One file could not be imported. Check the saved source and resume failed files." : undefined,
  total:209,imported:208,importedImages:207,importedVideos:1,failed:1,skipped:0,warnings:0,
  analysisPending:0,analysisCompleted:208,
  run:{found:209,existing:192,imported:16,skipped:0,failed:status === "partial" ? 1 : 0},
  files:status === "partial" ? [{name:"Kinetic_Move_of_the_Race_IMSA_R2_Sebring_9_16.mp4",
    type:"video",status:"failed",message:"The file could not be imported."}] : [],
});

async function measure(browser) {
  return browser.evaluate(`(()=>{
    const dialog=document.querySelector('[role=dialog]'), form=dialog.querySelector('form');
    const actions=${button("Update Event")}.parentElement;
    dialog.scrollTop=dialog.scrollHeight;
    const d=dialog.getBoundingClientRect(), f=form.getBoundingClientRect(), a=actions.getBoundingClientRect();
    const css=getComputedStyle(dialog), scale=d.height/dialog.offsetHeight;
    return {viewport:innerWidth,height:innerHeight,top:d.top,bottom:d.bottom,
      dialogHeight:d.height,clientHeight:dialog.clientHeight,scrollHeight:dialog.scrollHeight,scrollTop:dialog.scrollTop,
      formHeight:f.height,formScrollHeight:form.scrollHeight,
      trailingSpace:(d.bottom-a.bottom)/scale,formTrailingSpace:(f.bottom-a.bottom)/scale,
      actionTop:a.top,actionBottom:a.bottom,paddingBottom:parseFloat(css.paddingBottom),
      display:css.display,transform:css.transform,
      children:[...dialog.children].map(el=>({tag:el.tagName,height:el.getBoundingClientRect().height,
        display:getComputedStyle(el).display,minHeight:getComputedStyle(el).minHeight})),
      ancestors:(()=>{let el=dialog.parentElement,result=[];while(el){result.push({tag:el.tagName,
        transform:getComputedStyle(el).transform});el=el.parentElement;}return result;})(),
      horizontalOverflow:dialog.scrollWidth-dialog.clientWidth,
      pageOverflow:document.documentElement.scrollWidth-innerWidth};
  })()`);
}

function assertGeometry(g, width, height, settled = true) {
  assert.equal(g.viewport,width,"measure the CSS viewport, not just screenshot size");
  assert.equal(g.height,height);
  assert.ok(Math.abs(g.trailingSpace-g.paddingBottom) <= 3, `Unexpected space below actions: ${JSON.stringify(g)}`);
  assert.ok(Math.abs(g.formTrailingSpace) <= 1,"the form ends at the action row");
  assert.ok(g.scrollTop+g.clientHeight >= g.scrollHeight-1,"measurement reaches the actual scroll end");
  assert.ok(g.horizontalOverflow <= 1 && g.pageOverflow <= 1,"no horizontal scroll");
  if (settled) {
    assert.ok(g.top >= 0 && g.bottom <= height+1,"dialog stays within viewport");
    assert.ok(g.actionTop >= g.top && g.actionBottom <= g.bottom,"both actions are visible at scroll end");
  }
}

for (const [width,height] of [[1280,900],[1600,1800],[390,844]]) {
  for (const scenario of ["admin-errors","admin-empty","creator-empty"]) {
    test(`event editor ${scenario} has no empty scroll space at ${width}x${height}`, {timeout:60000}, async () => {
      const browser=await uiBrowser(), errors=[], requests=[], measurements={};
      const creator=scenario === "creator-empty", withSources=scenario === "admin-errors";
      const event={id:95601,title:"Dialog layout fixture",description:"Synthetic layout fixture",
        date:"2026-10-11T00:00:00.000Z",creatorId:creator ? 99999 : null,customThumbnail:null,
        coverImage:null,isPremium:false,visibility:"draft"};
      let pendingSources, pendingProgress;
      const fulfill = (requestId, content) => browser.command("Fetch.fulfillRequest", {
        requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"application/json"}],
        body:Buffer.from(JSON.stringify(content)).toString("base64"),
      }).catch(e=>errors.push(String(e)));
      browser.listeners.add(message => {
        if (message.method !== "Fetch.requestPaused") return;
        const {requestId,request}=message.params, url=new URL(request.url), p=url.pathname;
        requests.push({path:p,method:request.method});
        let content=[];
        if (p === "/api/user") content={id:99999,username:"synthetic-layout-user",isAdmin:!creator,
          isCreator:creator,creatorStatus:creator ? "approved" : null,emailVerifiedAt:"2026-01-01"};
        if (["/api/admin/events","/api/events","/api/creator/events"].includes(p)) content=[event];
        if (p === "/api/events/95601") content=event;
        if (p.endsWith("/thumbnail-options")) content={page:1,photos:[],hasMore:false};
        if (p.endsWith("/nextcloud/sources")) {pendingSources=requestId;return;}
        if (p.endsWith("/nextcloud")) {pendingProgress=requestId;return;}
        if (p === "/api/admin/safety") content={media:[],events:[]};
        if (p === "/api/admin/media-usage") content={total:{bytes:"0",count:"0",legacy:"0"},
          byEvent:[],byCreator:[],cleanupCount:"0",policy:{eventBytes:1000000,creatorBytes:1000000,eventCount:100,creatorCount:100}};
        if (p === "/api/creator/usage") content={bytes:0,galleries:1,photos:0,unknown:0,pendingCleanup:0,
          limits:{bytes:500000000,galleries:5,photos:1000,imageBytes:5000000},eventStats:[]};
        void fulfill(requestId,content);
      });
      const record = async (stage, settled=true) => {
        const g=await measure(browser);
        measurements[stage]=g;
        console.log("EVENT_DIALOG_GEOMETRY",scenario,`${width}x${height}`,stage,JSON.stringify(g));
        assertGeometry(g,width,height,settled);
        if (output && settled) {
          await mkdir(output,{recursive:true});
          const shot=await browser.command("Page.captureScreenshot",{format:"png"});
          await writeFile(path.join(output,`${scenario}-${width}x${height}-${stage}.png`),Buffer.from(shot.data,"base64"));
        }
      };
      try {
        await browser.command("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:width<500});
        await browser.command("Fetch.enable",{patterns:[{urlPattern:"*/api/*"}]});
        await browser.command("Page.navigate",{url:new URL(creator ? "/creator/dashboard" : "/admin/dashboard",base).href});
        if (creator) {
          await browser.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('My Galleries'))");
          await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('My Galleries')).click()");
        }
        await browser.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Edit Event')");
        await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Edit Event').click()");
        await browser.wait(`!!(${button("Update Event")})`);
        await record("opening",false);
        await browser.wait("document.getElementById('title')?.value==='Dialog layout fixture'");
        await delay(300);
        await record("before-sources");
        if (!creator) {
          assert.ok(pendingSources && pendingProgress,"both asynchronous requests are held");
          await fulfill(pendingSources,{sources:withSources ? sources : []});
          await browser.wait(withSources ? "document.getElementById('nc-credit-1')!==null" :
            `!(${button("Update Event")}).disabled`);
          await delay(100);
          await record("sources-loaded");
          await fulfill(pendingProgress,progress(withSources ? "partial" : "completed"));
          if (withSources) {
            await browser.wait(`!!(${button("Resume failed files")})`);
            assert.equal(await browser.evaluate("document.querySelector('[role=dialog]').textContent.includes('Kinetic_Move_of_the_Race_IMSA_R2_Sebring_9_16.mp4: The file could not be imported.')"),true);
            await record("failed-import");
            // Locally add/remove a third source. No source is saved or imported.
            await browser.evaluate(`(${button("Add another link")}).click()`);
            await browser.wait("document.getElementById('nc-credit-2')!==null");
            await record("source-added");
            await browser.evaluate(`[...document.querySelectorAll('[role=dialog] button')].filter(b=>b.textContent.trim()==='Remove link').at(-1).click()`);
            await browser.wait("document.getElementById('nc-credit-1')!==null && document.getElementById('nc-credit-2')===null");
            await record("source-removed");
          } else await record("no-sources");
        }
        // Ensure every form control and the close action can be reached by scrolling/focus.
        assert.equal(await browser.evaluate(`(()=>{
          const d=document.querySelector('[role=dialog]');
          return [...d.querySelectorAll('input:not([type=hidden]):not([type=file]),textarea,button')]
            .filter(el=>!el.disabled && el.getClientRects().length).every(el=>{
              el.focus();el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect(),b=d.getBoundingClientRect();
              return document.activeElement===el && r.top>=b.top-1 && r.bottom<=b.bottom+1 &&
                r.left>=b.left && r.right<=b.right;
            });
        })()`),true,"all fields, error recovery and actions remain reachable");
        // Negative control proves these assertions detect real excess space,
        // regardless of whether the container uses block, flex or grid.
        await browser.evaluate("document.querySelector('[role=dialog] form').style.paddingBottom='600px'");
        const broken=await measure(browser);
        assert.throws(()=>assertGeometry(broken,width,height), /Unexpected space below actions/);
        await browser.evaluate("document.querySelector('[role=dialog] form').style.paddingBottom=''");
        await record("restored");
        assert.equal(requests.every(r=>r.method === "GET"),true,"layout checks never save, resume or download");
        assert.ok(!requests.some(r=>/download|resume/.test(r.path)));
        assert.deepEqual(errors,[]);
        assert.deepEqual(browser.errors,[]);
        await browser.command("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
        await browser.command("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
        await browser.wait("!document.querySelector('[role=dialog]')");
      } finally {
        if (output) {
          await mkdir(output,{recursive:true});
          await writeFile(path.join(output,`${scenario}-${width}x${height}.json`),JSON.stringify({base,measurements},null,2));
        }
        await browser.close();
      }
    });
  }
}
