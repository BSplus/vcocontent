import test from "node:test";
import assert from "node:assert/strict";
import { videoFixture } from "./helpers/video-fixture.mjs";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

async function playback({views=true,errors=true,widths=[1280,390]}={}) {
  const fixture=await videoFixture();
  let browser;
  try { browser=await uiBrowser({startupTimeout:60000}); }
  catch(error) { await fixture.close(); throw error; }
  let touch=false;
  const tap=async point=>{
    if(touch) {
      await browser.command("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[point]});
      await browser.command("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    } else {
      await browser.command("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,...point});
      await browser.command("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,...point});
    }
  };
  const state=()=>browser.evaluate(`(()=>{const v=document.querySelector('video');return v&&({time:v.currentTime,paused:v.paused,error:v.error?.code,ready:v.readyState,width:v.videoWidth,height:v.videoHeight,inline:v.playsInline,src:v.currentSrc})})()`);
  const visit=async path=>{
    await browser.evaluate("window.fixtureNavigating = true");
    await browser.command("Page.navigate",{url:fixture.base+path});
    await browser.wait("!window.fixtureNavigating && !document.documentElement.hasAttribute('data-app-starting')");
    const item = /^\/media\/(\d+)/.exec(path);
    const caption = item ? fixture.media.find(row=>row.id===Number(item[1]))?.caption : "Moving H264 fixture";
    await browser.wait(`!!document.querySelector('main') && document.body.textContent.includes(${JSON.stringify(caption)})`);
  };
  const click=async selector=>{
    await browser.wait(`!!document.querySelector(${JSON.stringify(selector)})`);
    await browser.wait(`!!document.querySelector(${JSON.stringify(selector)}) && !document.documentElement.hasAttribute('data-app-starting')`);
    const point=await browser.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await tap(point);
  };
  const play=async()=>{
    await browser.wait(`document.querySelector('video')?.readyState>=2`);
    await delay(300); // Radix's entrance transition changes the control position.
    // Resolve the UA control itself: current Chromium puts the timeline below
    // the play button, so guessing bottom-left can seek instead of playing.
    await browser.evaluate(`document.querySelector('video').scrollIntoView({block:'center'})`);
    const {root}=await browser.command("DOM.getDocument",{depth:-1,pierce:true});
    const find=node=>{
      if(node.attributes?.includes("-webkit-media-controls-play-button"))return node;
      for(const child of [...(node.children||[]),...(node.shadowRoots||[])]) {
        const found=find(child);if(found)return found;
      }
    };
    const control=find(root);assert.ok(control,"native play control");
    const {model}=await browser.command("DOM.getBoxModel",{nodeId:control.nodeId});
    const point={x:(model.content[0]+model.content[2])/2,y:(model.content[1]+model.content[5])/2};
    await tap(point);
    try { await browser.wait(`(()=>{const v=document.querySelector('video');return !!v&&!v.paused&&v.currentTime>0.35})()`); }
    catch(error) { console.log("Playback state",await state(),point);throw error; }
  };
  const exercise=async()=>{
    await browser.wait(`document.querySelector('video')?.readyState>=2`);
    assert.ok((await state()).src.includes("/api/media/"));
    assert.equal((await state()).inline,true);
    await play();
    const frame=()=>browser.evaluate(`(()=>{const v=document.querySelector('video'),c=document.createElement('canvas');c.width=160;c.height=90;const ctx=c.getContext('2d');ctx.drawImage(v,0,0,160,90);return [...ctx.getImageData(0,0,160,90).data].reduce((s,n,i)=>(s+n*(i%17+1))>>>0,0)})()`);
    const time=(await state()).time, a=await frame();await delay(800);
    assert.ok((await state()).time>time+0.3);assert.notEqual(await frame(),a,"decoded pixels change");
    await browser.evaluate(`document.querySelector('video').pause()`);
    const paused=(await state()).time;await delay(250);
    assert.equal((await state()).paused,true);assert.ok(Math.abs((await state()).time-paused)<0.05);
    for(const time of [17,3]) {
      await browser.evaluate(`document.querySelector('video').currentTime=${time}`);
      await browser.wait(`(()=>{const v=document.querySelector('video');return !v.seeking&&v.readyState>=2&&Math.abs(v.currentTime-${time})<0.1})()`);
      // The first start above was a trusted control action. Resume the same
      // player after seeking; do not repeatedly serialize the entire UA DOM.
      await browser.evaluate(`document.querySelector('video').play()`);
      await browser.wait(`document.querySelector('video').currentTime>${time}+0.2`);
      await browser.evaluate(`document.querySelector('video').pause()`);
    }
  };
  const close=async()=>{
    await delay(100);
    // Native media controls consume Escape themselves; use the dialog's
    // visible Close action to verify its actual lifecycle.
    await click('[role="dialog"] button[class*="right-4"]');
    await browser.wait(`!document.querySelector('[role="dialog"]')`);
    assert.equal(await browser.evaluate(`window.oldVideo?.paused`),true);
    assert.equal(await browser.evaluate(`window.oldVideo?.getAttribute('src')`),null);
  };
  try {
    await browser.command("Network.enable");
    await browser.command("Network.setCacheDisabled",{cacheDisabled:true});
    await browser.command("Network.setCookie",{name:"fixture-role",value:"admin",url:fixture.base,path:"/"});
    for(const width of views ? widths : []) {
      touch=width===390;
      await browser.command("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width===390});
      await browser.command("Emulation.setTouchEmulationEnabled",{enabled:width===390});
      await visit(`/events/${fixture.event.id}`);
      await click('button[aria-label="Preview video: Moving H264 fixture"]');await exercise();
       if (touch) {
         const point=await browser.evaluate(`(()=>{const r=document.querySelector('video').getBoundingClientRect();return{x:r.x+r.width*.7,y:r.y+r.height*.4}})()`);
         await browser.command("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[point]});
         for(let step=1;step<=6;step++){
           await browser.command("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:point.x-step*18,y:point.y}]});
           await delay(20);
         }
         await browser.command("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
         assert.ok((await state()).src.includes(fixture.keys[0]),"video touches must not navigate the gallery");
       }
      console.log("Playback checked",width,"gallery");
      await browser.evaluate(`void(window.oldVideo=document.querySelector('video'))`);
      await click('button[aria-label="Next media item"]');
      await browser.wait(`document.querySelector('video')?.currentSrc.includes('/legacy/')`);
      assert.equal(await browser.evaluate(`window.oldVideo.paused&&!window.oldVideo.getAttribute('src')`),true);
      await exercise();await browser.evaluate(`void(window.oldVideo=document.querySelector('video'))`);await close();
      assert.equal(await browser.evaluate(`document.activeElement.getAttribute('aria-label')`),"Preview video: Moving H264 fixture");

      await visit("/");await click('button[aria-label="Preview video: Moving H264 fixture"]');await exercise();
      console.log("Playback checked",width,"home");
      await browser.evaluate(`void(window.oldVideo=document.querySelector('video'))`);await close();

      await visit("/media/91101");await exercise();
      console.log("Playback checked",width,"detail");
      await browser.evaluate(`void(window.oldVideo=document.querySelector('video'))`);
      await click(`a[href="/events/${fixture.event.id}"]`);
      await browser.wait(`!document.querySelector('video')`);
      assert.equal(await browser.evaluate(`window.oldVideo.paused&&!window.oldVideo.getAttribute('src')`),true);

      await click('button[aria-label="Edit media"]');await exercise();
      console.log("Playback checked",width,"editor");
      await browser.evaluate(`void(window.oldVideo=document.querySelector('video'))`);await close();
      assert.equal(await browser.evaluate(`document.querySelectorAll('video').length`),0);
    }
    if(errors) {
    const message=expected=>browser.wait(`Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).some(el=>el.textContent.includes(${JSON.stringify(expected)}))`);
    for(const [id,expected] of [[91103,"has no playback source"],[91104,"damaged"],[91105,"codec"]]) {
      await visit(`/media/${id}`.replace(/$/, ""));
      await message(expected);
      if(id!==91103) assert.ok((await state()).error,"real decoder error, not the caption");
    }
    // Stale UI identity is intentional: backend session has expired.
    await visit("/media/91101");
    await browser.wait(`document.querySelector('video')?.readyState>=2`);
    await browser.command("Network.setCookie",{name:"fixture-role",value:"anonymous",url:fixture.base,path:"/"});
    await browser.evaluate(`(()=>{const v=document.querySelector('video');v.src+='?fixture=expired';v.load()})()`);
    await message("Your session has expired");
    await browser.command("Network.setCookie",{name:"fixture-role",value:"admin",url:fixture.base,path:"/"});
    await click('button[class*="underline"]');
    await browser.wait(`document.querySelector('video')?.readyState>=2`);await play();
    fixture.media[0].isPremium=true;
    await browser.evaluate(`(()=>{const v=document.querySelector('video');v.src+='?fixture=denied';v.load()})()`);
    await message("You do not have permission");fixture.media[0].isPremium=false;
    fixture.objects.delete(fixture.keys[0]);
    await visit("/media/91101");
    await message("temporarily unavailable");
    const removed=fixture.media.shift();
    // Keep the rendered item while forcing a fresh, non-buffered file request.
    await browser.evaluate(`(()=>{const v=document.querySelector('video'), src=v.src;v.pause();v.removeAttribute('src');v.load();v.src=src+'?fixture=deleted';v.load()})()`);
    await message("missing or is no longer available");
    fixture.media.unshift(removed);
    await browser.command("Network.setCookie",{name:"fixture-role",value:"anonymous",url:fixture.base,path:"/"});
    await visit("/media/91101");
    await message("Sign in to play this video");
    assert.equal(await browser.evaluate(`!!document.querySelector('video')`),false);
    }
    assert.ok(fixture.requests.some(r=>r.status===206&&r.contentRange),"real server served partial bytes");
    console.log(JSON.stringify({codec:fixture.codec,views:views?4:0,widths:views?widths:[],errors,
      statuses:[...new Set(fixture.requests.filter(r=>r.path.includes('/files/')||r.path.includes('/legacy/')).map(r=>r.status))]}));
    assert.deepEqual(browser.errors,[]);
  } finally {await browser.close();await fixture.close();}
}

test("decoded motion, play/pause/seek and lifecycle in four real desktop views",
  {timeout:300000},()=>playback({errors:false,widths:[1280]}));
test("decoded motion, play/pause/seek and lifecycle in four real touch views",
  {timeout:300000},()=>playback({errors:false,widths:[390]}));
test("English playback errors: missing source, corrupt/unsupported video, expired session, access and retry",
  {timeout:120000},()=>playback({views:false}));
