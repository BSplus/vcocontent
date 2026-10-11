// Compare an archived, untouched revision using synthetic video/auth/storage.
// Usage: VIDEO_BASELINE_ROOT=generated-artifacts/video-baseline \
// node --import tsx scripts/probe-video-preview-baseline.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { videoFixture } from "../tests/helpers/video-fixture.mjs";
import { uiBrowser, delay } from "../tests/helpers/ui-browser.mjs";
const root=process.env.VIDEO_BASELINE_ROOT;
if(!root)throw new Error("VIDEO_BASELINE_ROOT must point to an archived baseline");
const {registerRoutes}=await import(pathToFileURL(path.resolve(root,"server/routes.ts")));
const {storage}=await import(pathToFileURL(path.resolve(root,"server/storage.ts")));
process.env.VIDEO_TEST_STATIC=path.resolve(root,"dist/public");
const fixture=await videoFixture({register:registerRoutes,store:storage});
let browser;
try {
  browser=await uiBrowser({startupTimeout:60000});
  await browser.command("Network.enable");
  await browser.command("Network.setCookie",{name:"fixture-role",value:"admin",url:fixture.base,path:"/"});
  const results=[];
  for(const view of ["gallery","home","detail","editor"]) {
    const route=view==="home"?"/":view==="detail"?"/media/91101":`/events/${fixture.event.id}`;
    await browser.command("Page.navigate",{url:fixture.base+route});
    await browser.wait(`document.body.textContent.includes('Moving H264 fixture')`);
    if(view!=="detail") {
      const selector=view==="editor"?'button[aria-label="Edit media"]':'button[aria-label="Preview video: Moving H264 fixture"]';
      await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    }
    await browser.wait(`!!document.querySelector('video')`);
    await delay(300);
    await browser.evaluate(`document.querySelector('video').scrollIntoView({block:'center'})`);
    const {root:document}=await browser.command("DOM.getDocument",{depth:-1,pierce:true});
    const find=node=>{
      if(node.attributes?.includes("-webkit-media-controls-play-button"))return node;
      for(const child of [...(node.children||[]),...(node.shadowRoots||[])]) {const found=find(child);if(found)return found;}
    };
    const control=find(document);assert.ok(control);
    const {model}=await browser.command("DOM.getBoxModel",{nodeId:control.nodeId});
    const point={x:(model.content[0]+model.content[2])/2,y:(model.content[1]+model.content[5])/2};
    await browser.command("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});
    await browser.command("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point});
    let playing=true;
    try {await browser.wait(`document.querySelector('video')?.currentTime>0.5`);}
    catch {playing=false;}
    const state=await browser.evaluate(`(()=>{const v=document.querySelector('video');v.pause();return {time:v.currentTime,width:v.videoWidth,ready:v.readyState,error:v.error?.code,src:v.currentSrc}})()`);
    results.push({view,playing,...state});
  }
  console.log(JSON.stringify({baseline:true,codec:fixture.codec,results,
    delivery:fixture.requests.filter(r=>r.path.includes("/files/"))},null,2));
} finally {await browser?.close();await fixture.close();}
