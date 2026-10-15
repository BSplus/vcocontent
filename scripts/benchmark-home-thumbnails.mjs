// Isolated, real HTTP routes + production frontend; never writes to a database/bucket.
import express from "express";
import sharp from "sharp";
import { once } from "node:events";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "@replit/object-storage";
import { uiBrowser, delay } from "../tests/helpers/ui-browser.mjs";
process.env.DATABASE_URL = "postgresql://fixture:fixture@localhost/fixture";
process.env.MEDIA_STORAGE_ROUTING = "enabled";
process.env.MEDIA_STORAGE_PROVIDER = "replit";
process.env.MEDIA_STORAGE_ENVIRONMENT = "test";
const { mediaDatabaseFingerprint } = await import("../server/media-storage-config.ts");
process.env.MEDIA_STORAGE_DATABASE_FINGERPRINT = mediaDatabaseFingerprint(process.env.DATABASE_URL);
process.env.MEDIA_EDGE_ORIGIN = "";
const { storage } = await import("../server/storage.ts");
const { pool } = await import("../server/db.ts");
const { db } = await import("../server/db.ts");
process.env.MEDIA_STORAGE_ENVIRONMENT = "development";
const { ReplitStore } = await import("../server/object-store.ts");
const { thumbnailCache } = await import("../server/thumbnail-cache.ts");
const { registerRoutes } = await import("../server/routes.ts");
const { publicEventThumbnails } = await import("../server/event-thumbnails.ts");
const phase = process.argv[2] || "after";
// Deterministic textured photo-sized data, not an unrealistically tiny solid swatch.
const pixels=Buffer.alloc(2400*1600*3);
let seed=192;
for(let i=0;i<pixels.length;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  pixels[i]=((i%7200)/7200*100+(seed>>>24)*0.6)&255;
}
const jpeg = await sharp(pixels,{raw:{width:2400,height:1600,channels:3}}).jpeg().toBuffer();
const data = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
const webp = await sharp(jpeg).resize(640).webp({quality:72}).toBuffer();
const key = "thumb-00000000-0000-0000-0000-000000000001.webp";
const modern = `/api/media/files/${key}`;
const modernFor = i => `/api/media/files/thumb-00000000-0000-0000-0000-${String(i+1).padStart(12,"0")}.webp`;
const recentDate = new Date(Date.now()-86400000);
const events = Array.from({length:8}, (_,i)=>({
  id:96000+i,title:`Benchmark race ${i}`,description:"Synthetic isolated fixture",
  date:recentDate,creatorId:i<4?null:99000,seriesId:null,
  visibility:"published",safetyStatus:"legacy",adminHidden:false,isPremium:false,
  contentVersion:0,safetyVersion:0,coverImage:null,
  customThumbnail:i%4===0 && i<4 ? data : i%4===1 ? `/api/media/legacy/${97000+i}/thumbnail` : i%4===2? modernFor(i):null,
}));
const items = events.map((event,i)=>({id:97000+i,eventId:event.id,type:"image",
  url:data,thumbnail:i%2?data:modernFor(i),caption:`Frame ${i}`,tags:[],isPremium:false,
  safetyStatus:"legacy",contentVersion:0,safetyVersion:0,downloadCount:20}));
const owner = {id:99000,username:"Fixture",creatorStatus:"approved",suspended:false};
let queries=0, queryMs=0, storageReads=0, storageMs=0, conversions=0, conversionMs=0;
let metadataReads=0;
const digest=createHash("sha256").update(webp).digest("hex");
// No SQL reaches a connected database. Current route and HEAD are deliberately
// separate: byte reuse must never reuse a routing/metadata decision.
db.execute=async()=>({rows:[{provider:"replit",state:"verified",sha256:digest,
  size:webp.length,mime:"image/webp",object_version:"fixture-v1"}]});
ReplitStore.prototype.metadata=async()=>{metadataReads++;await delay(5);
  return {size:webp.length,mime:"image/webp",version:"fixture-v1"};};
const read = async value => {const t=performance.now();queries++;await delay(30);queryMs+=performance.now()-t;return value;};
const listed = item => ({...item,url:`/api/media/legacy/${item.id}/file`,
  thumbnail:item.thumbnail.startsWith("data:")?`/api/media/legacy/${item.id}/thumbnail`:item.thumbnail});
Object.assign(storage,{
  getEvents:()=>read(events),getEvent:id=>read(events.find(e=>e.id===id)),
  getEventsWithCardFallbacks:()=>read(events.map(event=>({...event,galleryThumbnail:listed(items.find(i=>i.eventId===event.id)).thumbnail}))),
  getUser:()=>read(owner),getMediaItem:id=>read(items.find(i=>i.id===id)),
  getMediaThumbnail:id=>read(items.find(i=>i.id===id)),
  findMediaByKey:key=>read(items.find(i=>i.thumbnail===`/api/media/files/${key}`)),
  getPublicEventMediaItems:id=>read(items.filter(i=>i.eventId===id).map(listed)),
  getEventCardFallbacks:ids=>read(new Map(ids.map(id=>[id,listed(items.find(i=>i.eventId===id)).thumbnail]))),
  topMedia:(_limit,creator)=>read(items.filter(i=>creator===null?i.eventId<96004:i.eventId>=96004).slice(0,3).map(listed)),
});
ReplitStore.prototype.open = Client.prototype.downloadAsStream = () => {
  storageReads++;
  return Readable.from((async function*(){const t=performance.now();await delay(40);storageMs+=performance.now()-t;yield webp;})());
};
const originalToBuffer=sharp.prototype.toBuffer;
sharp.prototype.toBuffer=async function(...args){const t=performance.now();conversions++;
  try{return await originalToBuffer.apply(this,args);}finally{conversionMs+=performance.now()-t;}};
const app=express();
app.use((req,_res,next)=>{req.isAuthenticated=()=>false;next();});
app.get("/api/user",(_req,res)=>res.status(401).json({}));
app.get("/api/users/99000",(_req,res)=>res.json(owner));
app.get(/^\/api\/community\//,(_req,res)=>res.json({count:0,liked:false,saved:false}));
const server=await registerRoutes(app,{workers:false});
app.use(express.static("dist/public"));
app.get("*",(_req,res)=>res.sendFile(`${process.cwd()}/dist/public/index.html`));
server.listen(0,"127.0.0.1");await once(server,"listening");
const base=`http://127.0.0.1:${server.address().port}`;
const results={phase,fixture:{databaseDelayMs:30,storageDelayMs:40,jpegBytes:jpeg.length,webpBytes:webp.length},http:[],browser:[]};
const counters=()=>({queries,queryMs,metadataReads,storageReads,storageMs,conversions,conversionMs});
const diff=(a,b)=>Object.fromEntries(Object.keys(a).map(k=>[k,b[k]-a[k]]));
try {
  for(const [name,path] of [["inline",publicEventThumbnails(events[0]).customThumbnail],
    ["legacy",`/api/media/legacy/${items[1].id}/thumbnail`],["modern",modern]]) {
    let etag;
    for(const mode of ["parallel-cold","warm","parallel"]) {
      const start=performance.now(),before=counters();
      const responses=await Promise.all(Array.from({length:mode.startsWith("parallel")?6:1},async()=>{
        const t=performance.now(),res=await fetch(base+path,{headers:mode==="warm"&&etag?{"If-None-Match":etag}:{}});
        etag=res.headers.get("etag");const bytes=(await res.arrayBuffer()).byteLength;
        return {status:res.status,bytes,ms:performance.now()-t};
      }));
      results.http.push({name,mode,totalMs:performance.now()-start,responses,...diff(before,counters())});
    }
  }
  for(const width of [1600,390]) {
    const browser=await uiBrowser();
    try {
      await browser.command("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width<768});
      await browser.command("Network.enable");
      await browser.command("Page.addScriptToEvaluateOnNewDocument",{source:`
        window.imagePaints=[];
        const recorded=new WeakMap(),scheduled=new WeakMap();
        const visible=image=>{
          const r=image.getBoundingClientRect();
          return !document.documentElement.hasAttribute('data-app-starting')
            &&getComputedStyle(image).visibility==='visible'
            &&r.width>0&&r.height>0&&r.left<innerWidth&&r.right>0&&r.top<innerHeight&&r.bottom>0;
        };
        function track(){
          for(const image of document.images){
            const src=image.getAttribute('src');
            if(!src||!image.complete||!image.naturalWidth||!visible(image)
              ||recorded.get(image)===src||scheduled.get(image)===src)continue;
            scheduled.set(image,src);
            requestAnimationFrame(()=>requestAnimationFrame(()=>{
              scheduled.delete(image);
              if(image.getAttribute('src')!==src||!visible(image)||!image.naturalWidth)return;
              recorded.set(image,src);window.imagePaints.push({
                section:image.closest('section')?.getAttribute('aria-labelledby'),src,
                ms:performance.now(),width:image.naturalWidth
              });
            }));
          }
          requestAnimationFrame(track);
        }
        requestAnimationFrame(track);`});
      for(const section of ["recent-heading","top-shots-heading","creator-media-heading"]) for(const mode of ["cold","warm","scroll"]) {
        if(mode==="cold") await browser.command("Network.clearBrowserCache");
        if(mode==="cold") {
          // Separate cold browser AND cold output caches from warm repeats.
          thumbnailCache.clear?.();
          const prepared=await import("../server/prepared-thumbnail.ts");
          prepared.preparedThumbnailCache?.clear();
        }
        const before=counters();
        const responses=[],initiated=[];
        const onResponse=message=>{
          if(message.method==="Network.requestWillBeSent" && message.params.request.url.includes("/api/"))
            initiated.push(new URL(message.params.request.url).pathname);
          if(message.method==="Network.responseReceived" && message.params.response.url.includes("/api/"))
            responses.push({path:new URL(message.params.response.url).pathname,status:message.params.response.status,
              disk:!!message.params.response.fromDiskCache});
        };
        browser.listeners.add(onResponse);
        await browser.evaluate("window.__oldBenchmarkDocument = true");
        await browser.command("Page.navigate",{url:base+"/"});
        await browser.wait("!window.__oldBenchmarkDocument && !!document.querySelector('h1')");
        const sections=[];
        // Same scenario in each version: bring the selected row into view as
        // soon as its list is ready, not after other rows finish loading.
        for(const name of [section]) {
          await browser.wait(`!!document.querySelector('section[aria-labelledby="${name}"] img')`);
          if(mode==="scroll") {
            await browser.evaluate(`window.scrollTo(0,Math.max(0,document.querySelector('section[aria-labelledby="${name}"]').getBoundingClientRect().top+scrollY-innerHeight-120))`);
            await delay(160);
            await browser.evaluate("window.scrollBy(0,180)");
            await delay(200);
          }
          const visibleAt=await browser.evaluate(`(()=>{document.querySelector('section[aria-labelledby="${name}"]').scrollIntoView();return performance.now();})()`);
          await browser.wait(`Array.from(document.querySelectorAll('section[aria-labelledby="${name}"] img')).filter(i=>{const r=i.getBoundingClientRect();return r.left<innerWidth&&r.right>0}).every(i=>i.complete&&i.naturalWidth>0)`);
          await browser.wait(`window.imagePaints.filter(i=>i.section===${JSON.stringify(name)}&&i.src.startsWith('/api/')).length >= Array.from(document.querySelectorAll('section[aria-labelledby="${name}"] img')).filter(i=>{const r=i.getBoundingClientRect();return r.left<innerWidth&&r.right>0&&r.top<innerHeight&&r.bottom>0}).length`);
          await delay(120);
          sections.push(await browser.evaluate(`({section:${JSON.stringify(name)},visibleAt:${visibleAt},at:performance.now(),images:window.imagePaints.filter(i=>i.section===${JSON.stringify(name)})})`));
          if(mode==="scroll" && width<768) {
            await browser.evaluate(`document.querySelector('section[aria-labelledby="${name}"] .mobile-gallery-row').scrollTo({left:10000,behavior:'instant'})`);
            await browser.wait(`Array.from(document.querySelectorAll('section[aria-labelledby="${name}"] img')).filter(i=>{const r=i.getBoundingClientRect();return r.left<innerWidth&&r.right>0}).every(i=>i.complete&&i.naturalWidth>0)`);
            await delay(100);
            sections.push(await browser.evaluate(`({section:${JSON.stringify(name)},swipe:true,at:performance.now(),images:window.imagePaints.filter(i=>i.section===${JSON.stringify(name)})})`));
          }
        }
        // Compare request/byte counts over the same two-second window, not
        // different windows chosen by each version's image completion time.
        const elapsed=await browser.evaluate("performance.now()");
        await delay(Math.max(0,2000-elapsed));
        const network=await browser.evaluate(`performance.getEntriesByType('resource').filter(e=>e.name.includes('/api/')).map(e=>({path:new URL(e.name).pathname,bytes:e.transferSize,body:e.encodedBodySize,responseMs:e.responseEnd-e.startTime,startMs:e.startTime}))`);
        browser.listeners.delete(onResponse);
        if(responses.some(r=>r.status>=400 && r.path!=="/api/user"))throw Error(JSON.stringify(responses));
        results.browser.push({width,mode,section,sections,network,responses,initiated,requests:initiated.length,completed:network.length,bytes:network.reduce((n,r)=>n+r.bytes,0),...diff(before,counters())});
      }
      if(browser.errors.length) throw new Error(browser.errors.join("\n"));
    }finally{await browser.close();}
  }
  await mkdir("generated-artifacts/home-thumbnails",{recursive:true});
  await writeFile(`generated-artifacts/home-thumbnails/${phase}.json`,JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
} finally {
  await new Promise(resolve=>server.close(resolve));
  storage.sessionStore.close();await pool.end();
}
