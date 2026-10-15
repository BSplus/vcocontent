// Real browser controls and network, not request interception or fake responses.
import assert from "node:assert/strict";
import {uiBrowser,delay} from "../../tests/helpers/ui-browser.mjs";

export async function runResumableLiveUi({base,cookie,role,width,title,fixturePath,caption,onPaused}){
  const browser=await uiBrowser();
  const requests=new Map(),accepted=[],started=[];
  const pausedEvidence=[];
  const button=(label,scope='[role="dialog"]')=>
    `[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
  const click=async expression=>{
    await browser.wait(`!!(${expression}) && !(${expression}).matches(':disabled')`);
    await browser.evaluate(`(${expression}).scrollIntoView({block:'center',behavior:'instant'})`);
    await delay(100);
    const point=await browser.evaluate(`(()=>{
      const b=(${expression}),r=b.getBoundingClientRect();
      const x=r.x+r.width/2,y=r.y+r.height/2;
      return {x,y,w:r.width,h:r.height,visible:x>=0&&x<innerWidth&&y>=0&&y<innerHeight,
        unobstructed:document.elementFromPoint(x,y)?.closest('button')===b};
    })()`);
    assert.ok(point.visible&&point.unobstructed,"Control must be reachable and unobstructed");
    assert.ok(point.w>=24&&point.h>=24,"Control meets minimum target size");
    if(width<600){
      await browser.command("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:point.x,y:point.y}]});
      await browser.command("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    }else{
      await browser.command("Input.dispatchMouseEvent",{type:"mousePressed",x:point.x,y:point.y,button:"left",clickCount:1});
      await browser.command("Input.dispatchMouseEvent",{type:"mouseReleased",x:point.x,y:point.y,button:"left",clickCount:1});
    }
  };
  const action=role==="creator"?"Upload Media":"Manage Media";
  const row=`(()=>{
    let e=[...document.querySelectorAll('main *')].find(e=>e.textContent.trim().toLocaleLowerCase()===${JSON.stringify(title.toLocaleLowerCase())});
    while(e && ![...e.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(action)}))e=e.parentElement;
    return e;
  })()`;
  const navigate=async()=>{
    await browser.command("Page.navigate",{url:new URL(`/${role}/dashboard`,base).href});
    await browser.wait("document.readyState==='complete'");
    if(role==="creator"){
      await browser.wait(`!!document.querySelector('nav[aria-label="Creator Studio sections"]')`);
      await click(button("My Galleries","body"));
    }
    await browser.wait(`!!(${row})`);
    await click(`[...(${row}).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(action)})`);
    if(role==="admin")await click(button("Upload Media","main"));
    await browser.wait(`!!document.querySelector('[role="dialog"] input[type="file"]')`);
  };
  const select=async()=>{
    const {root}=await browser.command("DOM.getDocument");
    const {nodeId}=await browser.command("DOM.querySelector",{
      nodeId:root.nodeId,selector:'[role="dialog"] input[type="file"]'});
    assert.ok(nodeId);
    await browser.command("DOM.setFileInputFiles",{nodeId,files:[fixturePath]});
    await browser.wait(`!!document.querySelector('[role="dialog"] img')`);
  };
  const paused=async expected=>{
    await browser.wait(`!!(${button("Pause uploads")})`);
    // Observe real HTTP acknowledgments, rather than delaying/faking a response.
    const until=Date.now()+30000;
    while(accepted.length<expected&&Date.now()<until)await delay(80);
    assert.equal(accepted.length,expected,"Expected real part acknowledgment");
    await click(button("Pause uploads"));
    await browser.wait(`!!(${button("Resume / check status")}) && !(${button("Resume / check status")}).matches(':disabled')`);
    await browser.wait(`document.querySelector('[role="dialog"]')?.textContent.includes('Paused')`);
    const layout=await browser.evaluate(`(()=>{
      const d=document.querySelector('[role="dialog"]');
      return {pageFits:document.documentElement.scrollWidth<=innerWidth+1,dialogFits:d.scrollWidth<=d.clientWidth+1};
    })()`);
    assert.ok(layout.pageFits&&layout.dialogFits,"Upload dialog must not overflow horizontally");
    const evidence=await onPaused(expected);
    pausedEvidence.push(evidence);
  };
  try{
    browser.listeners.add(message=>{
      if(message.method==="Network.requestWillBeSent"){
        const {requestId,request}=message.params;
        const url=new URL(request.url);
        if(url.origin!==new URL(base).origin)return;
        if(request.method==="PUT"&&/\/upload-sessions\/[^/]+\/parts\/\d+$/.test(url.pathname))
          requests.set(requestId,{index:Number(url.pathname.split("/").at(-1)),path:url.pathname});
        if(request.method==="POST"&&/\/events\/\d+\/upload-sessions$/.test(url.pathname))started.push(url.pathname);
      }
      if(message.method==="Network.responseReceived"&&message.params.response.status===200){
        const part=requests.get(message.params.requestId);
        if(part)accepted.push(part.index);
      }
    });
    await browser.command("Network.enable");
    const separator=cookie.indexOf("=");
    await browser.command("Network.setCookie",{name:cookie.slice(0,separator),value:cookie.slice(separator+1),
      url:base,secure:true,httpOnly:true});
    await browser.command("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:width<600});
    if(width<600)await browser.command("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:1});
    // Real requests at 128 KiB/s leave time for a person-like Pause action.
    await browser.command("Network.emulateNetworkConditions",{
      offline:false,latency:10,downloadThroughput:-1,uploadThroughput:131072});
    await navigate();await select();
    await browser.evaluate(`(()=>{
      const set=(id,value,prototype)=>{const e=document.getElementById(id);
        Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,value);
        e.dispatchEvent(new Event('input',{bubbles:true}));};
      set('caption',${JSON.stringify(caption)},HTMLTextAreaElement.prototype);
      set('photographer','Development smoke fixture',HTMLInputElement.prototype);
      set('tagsInput','Development fixture',HTMLInputElement.prototype);
    })()`);
    assert.equal(await browser.evaluate("document.getElementById('caption').value"),caption);
    await click(button("Upload 1 file"));
    await paused(1);
    await click(button("Resume / check status"));
    await paused(2);
    await click(button("Close"));
    await browser.wait(`!document.querySelector('[role="dialog"]')`);
    // A real page load discards component state, retaining only legitimate
    // browser storage/session and the same on-disk file's identity.
    await navigate();await select();
    await click(button("Upload 1 file"));
    await browser.wait(`!document.querySelector('[role="dialog"]')`);
    await browser.wait(`document.body.textContent.includes('1 file saved')`);
    assert.equal(started.length,1,"Reopening must recover the original session, not initialize a duplicate");
    assert.deepEqual(accepted,[0,1,2,3],"Each acknowledged part must be uploaded successfully only once");
    assert.equal([...requests.values()].filter(p=>p.index===0).length,1,"First accepted part never retransmitted");
    assert.deepEqual(browser.errors,[],"No uncaught browser exceptions");
    return {role,width,trustedTouch:width<600,trustedMouse:width>=600,
      realPartAcknowledgments:accepted,sameDialogResume:true,pageReloadReselectionResume:true,
      oneSession:true,noHorizontalOverflow:true,minimumTargetSize:true,pausedEvidence};
  }finally{await browser.close();}
}
