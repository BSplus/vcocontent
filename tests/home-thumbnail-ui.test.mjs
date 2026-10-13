import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";
const base=process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const bytes=await sharp({create:{width:80,height:60,channels:3,background:"#137fe1"}}).webp().toBuffer();
const image=id=>`/api/fixture-image/${id}`;
const recent=new Date(Date.now()-86400000).toISOString();
const events=Array.from({length:4},(_,i)=>({id:95020+i,title:`Thumbnail fixture ${i}`,date:recent,
  creatorId:null,seriesId:null,isPremium:false,customThumbnail:i===0?image("broken"):i===1?image(1):null,
  coverImage:i===0?image("cover"):i===2?image(2):"/attached_assets/%2389_3.png",
  galleryThumbnail:image(`gallery-${i}`)}));
const media=Array.from({length:3},(_,i)=>({id:95400+i,type:"image",thumbnail:image(`shot-${i}`),url:image(`shot-${i}`),
  caption:`Frame ${i}`,tags:[],downloadCount:10}));
for(const width of [1600,390])test(`visible cards, image failure independence and deferred horizontal thumbnails at ${width}px`,{timeout:90000},async()=>{
  const browser=await uiBrowser(),requests=[],errors=[];
  let topFinished=false,creatorBeforeTop=false;
  browser.listeners.add(message=>{
    if(message.method!=="Fetch.requestPaused")return;
    const {requestId,request}=message.params,path=new URL(request.url).pathname;requests.push(path);
    void(async()=>{
      let body=[],status=200,type="application/json";
      if(path==="/api/user")status=401;
      else if(path==="/api/events")body=events;
      else if(path.startsWith("/api/community/"))body={count:0,liked:false,saved:false};
      else if(path==="/api/media/top-shots"){await delay(1000);topFinished=true;body=media;}
      else if(path==="/api/media/creator-top"){creatorBeforeTop=!topFinished;body=media.map((m,i)=>({...m,id:m.id+10,thumbnail:image(`creator-${i}`)}));}
      else if(path.startsWith("/api/fixture-image/")){type="image/webp";body=bytes;if(path.endsWith("/broken")||path.endsWith("/cover")){status=404;body=Buffer.from("broken-image");}}
      await browser.command("Fetch.fulfillRequest",{requestId,responseCode:status,responseHeaders:[{name:"Content-Type",value:type}],
        body:(type==="image/webp"?body:Buffer.from(JSON.stringify(body))).toString("base64")});
    })().catch(error=>errors.push(String(error)));
  });
  try{
    await browser.command("Fetch.enable",{patterns:[{urlPattern:"*/api/*"}]});
    await browser.command("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
    await browser.command("Emulation.setTouchEmulationEnabled",{enabled:width<768});
    await browser.command("Page.navigate",{url:new URL("/",base).href});
    await browser.wait(`document.querySelector('section[aria-labelledby="recent-heading"] img')?.naturalWidth>0`);
    assert.equal(creatorBeforeTop,true,"Creator request must not depend on Top shots completion");
    assert.ok(requests.includes(image("gallery-0")),"Own thumbnail then cover then gallery on failures");
    assert.ok(!requests.some(p=>/\/events\/\d+\/(media|card-preview)$/.test(p)));
    assert.ok(!requests.includes(image("shot-2")),"Only the first poster may use native look-ahead; the rest wait for visibility");
    const row='document.querySelector(\'section[aria-labelledby="recent-heading"] .mobile-gallery-row\')';
    if(width<768){
      assert.ok(!requests.includes(image(2)));assert.ok(!requests.includes(image("gallery-3")));
      await browser.evaluate(`${row}.scrollLeft=${row}.scrollWidth`);
      await browser.wait(`document.querySelector('section[aria-labelledby="recent-heading"] img[src="${image(2)}"]')?.naturalWidth>0`);
      assert.ok(requests.includes(image("gallery-3")));
    }else{
      await browser.wait(`Array.from(document.querySelectorAll('section[aria-labelledby="recent-heading"] img')).every(i=>i.naturalWidth>0)`);
    }
    await browser.wait(`!!document.querySelector('section[aria-labelledby="top-shots-heading"] button')`);
    await browser.evaluate(`document.querySelector('section[aria-labelledby="top-shots-heading"]').scrollIntoView()`);
    await browser.wait(`document.querySelector('section[aria-labelledby="top-shots-heading"] img')?.naturalWidth>0`);
    if(width<768)assert.ok(!requests.includes(image("shot-2")));
    await browser.evaluate(`document.querySelector('section[aria-labelledby="top-shots-heading"] button').click()`);
    await browser.wait(`document.querySelector('[role="dialog"] img')?.naturalWidth>0`);
    assert.equal(browser.errors.length,0);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
