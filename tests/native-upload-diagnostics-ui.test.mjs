import test from "node:test";
import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {uiBrowser,delay} from "./helpers/ui-browser.mjs";

const base=process.env.TEST_BASE_URL||`https://${process.env.REPLIT_DEV_DOMAIN}`;
const diagnosticPath="/api/admin/native-upload-diagnostics";
const sample={
  availability:"ready",nativeEnabled:false,uploadsEnabled:false,
  sampledAt:"2026-10-16T12:00:00Z",sampleLimit:200,truncated:true,
  counts:{sessions:200,receiving:12,finalizing:180,completedAwaitingCleanup:8,
    held:50,retryScheduled:70,due:68,expired:9},
  reservedBytes:"123456789",
  reasons:[{reason:"integrity",count:35},{reason:"uploads_paused",count:15}],
};
const target=text=>`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
async function click(browser,text,touch){
  const selector=target(text);
  await browser.evaluate(`(${selector}).scrollIntoView({block:'center'})`);
  const rect=await browser.evaluate(`(()=>{const r=(${selector}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  if(touch){
    await browser.command("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[rect]});
    await browser.command("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  }else{
    await browser.command("Input.dispatchMouseEvent",{type:"mousePressed",...rect,button:"left",clickCount:1});
    await browser.command("Input.dispatchMouseEvent",{type:"mouseReleased",...rect,button:"left",clickCount:1});
  }
}

for(const width of [390,1280])test(`native diagnostics are read-only and recover from errors at ${width}px`,{timeout:60000},async()=>{
  const browser=await uiBrowser(),requests=[],unexpected=[],pending=[],mockErrors=[];
  let mode="ready";
  const fulfill=(requestId,body,status=200)=>browser.command("Fetch.fulfillRequest",{
    requestId,responseCode:status,responseHeaders:[{name:"Content-Type",value:"application/json"}],
    body:Buffer.from(JSON.stringify(body)).toString("base64"),
  }).catch(error=>mockErrors.push(String(error)));
  try{
    browser.listeners.add(event=>{
      if(event.method!=="Fetch.requestPaused")return;
      const {requestId,request}=event.params,path=new URL(request.url).pathname;
      if(request.method!=="GET"){unexpected.push(request.method+" "+path);void fulfill(requestId,{error:"No writes"},405);return;}
      if(path===diagnosticPath){
        requests.push(path);
        if(mode==="pending"){pending.push(requestId);return;}
        if(mode==="error"){void fulfill(requestId,{error:"Synthetic unavailable"},503);return;}
        void fulfill(requestId,{...sample,availability:mode==="ready"?"ready":mode});return;
      }
      let body=[];
      if(path==="/api/user")body={id:99901,username:"SyntheticAdmin",isAdmin:true,isCreator:true,
        creatorStatus:"approved",emailVerifiedAt:"2026-10-16T12:00:00Z"};
      else if(path==="/api/admin/safety")body={media:[],events:[]};
      else if(path==="/api/admin/media-usage")body={total:{bytes:"0",count:"0",legacy:"0"},
        byEvent:[],byCreator:[],cleanupCount:"0",
        policy:{eventBytes:100000000,creatorBytes:100000000,eventCount:100,creatorCount:100},warningFraction:0.8};
      else if(path==="/api/media/policy")body={community:false,imageBytes:5000000,videoBytes:10000000,
        maxPixels:40000000,zipCount:100,zipBytes:104857600,resumableUploads:false};
      void fulfill(requestId,body);
    });
    await browser.command("Fetch.enable",{patterns:[{urlPattern:"*/api/*"}]});
    await browser.command("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<600});
    if(width<600)await browser.command("Emulation.setTouchEmulationEnabled",{enabled:true});
    await browser.command("Page.navigate",{url:new URL("/admin/dashboard",base).href});
    await browser.wait(`!!(${target("Media Management")})`);
    assert.equal(requests.length,0,"inactive tab must not request diagnostics");
    mode="pending";await click(browser,"Media Management",width<600);
    await browser.wait(`!!document.querySelector('[aria-label="Loading native upload diagnostics"]')`);
    assert.equal(pending.length,1);await fulfill(pending.shift(),sample);mode="ready";
    await browser.wait(`document.body.innerText.includes('File integrity conflict — review required')`);
    const text=await browser.evaluate("document.body.innerText");
    assert.match(text,/Uploads paused — space remains reserved/);
    assert.match(text,/Sample limit reached/);assert.match(text,/16 October 2026/);
    assert.match(text,/Flags describe configuration only/);
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true);
    assert.equal(await browser.evaluate("innerWidth"),width);
    const readCount=requests.length;await delay(800);assert.equal(requests.length,readCount);
    const image=await browser.command("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    await writeFile(`/tmp/native-upload-diagnostics-${width}.png`,Buffer.from(image.data,"base64"));

    mode="error";await click(browser,"Refresh status",width<600);
    await browser.wait(`document.body.textContent.includes('Native-upload diagnostics unavailable')`);
    assert.equal(await browser.evaluate("document.body.innerText.includes('File integrity conflict — review required')"),false);
    await delay(1500);assert.equal(requests.length,readCount+1,"no hidden transport/React Query retry");
    mode="schema_unavailable";await click(browser,"Refresh status",width<600);
    await browser.wait(`document.body.textContent.includes('Native-upload schema unavailable')`);
    assert.equal(await browser.evaluate("document.body.innerText.includes('Required schema is ready')"),false);
    mode="not_development";await click(browser,"Refresh status",width<600);
    await browser.wait(`document.body.textContent.includes('Native-upload diagnostics are development-only')`);
    assert.deepEqual(unexpected,[]);assert.deepEqual(mockErrors,[]);assert.deepEqual(browser.errors,[]);
  }finally{await browser.close();}
});
