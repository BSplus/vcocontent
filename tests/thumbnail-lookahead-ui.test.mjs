import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { build } from "esbuild";
import path from "node:path";
import sharp from "sharp";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

// Exercise the actual component in a deterministic layout, independent of
// application auth, fonts and data fixtures. All image requests are real HTTP.
for (const width of [1600,390]) test(`bounded look-ahead, fast scroll and source replacement at ${width}px`,{timeout:60000},async()=>{
  const output=await build({stdin:{contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import Thumbnail from './client/src/components/visible-thumbnail';
    const root=createRoot(document.getElementById('root'));
    window.renderFixture=(version='a')=>flushSync(()=>root.render(<>
      {Array.from({length:12},(_,row)=><div className="row" key={version+row} style={{top:row===0?0:row===1?innerHeight+120:innerHeight+700+(row-2)*500}}>
        {Array.from({length:6},(_,card)=><div className="card" key={card}><Thumbnail src={'/image/'+version+'-'+row+'-'+card} /></div>)}
      </div>)}</>));
    window.renderFixture();`,resolveDir:process.cwd(),loader:"tsx"},
    bundle:true,write:false,format:"esm",jsx:"automatic",alias:{"@":path.resolve("client/src")}});
  const pixels=await sharp({create:{width:80,height:60,channels:3,background:"#137fe1"}}).webp().toBuffer();
  const app=express(),requests=[];
  app.get("/",(_req,res)=>res.type("html").send(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{margin:0;height:8000px}.row{position:absolute;left:0;width:100%;display:flex;gap:12px;overflow-x:auto;height:160px}
    .card{flex:0 0 ${width<768?330:380}px;height:150px}img{width:100%;height:150px;object-fit:fill}
    </style><div id="root"></div><script type="module" src="/fixture.js"></script>`));
  app.get("/fixture.js",(_req,res)=>res.type("js").send(output.outputFiles[0].text));
  app.get("/image/:id",async(req,res)=>{
    requests.push(req.params.id);await delay(60);
    res.type("webp").send(pixels);
  });
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");
  const browser=await uiBrowser();
  try{
    await browser.command("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
    await browser.command("Page.navigate",{url:`http://127.0.0.1:${server.address().port}`});
    await browser.wait(`document.querySelector('img')?.naturalWidth>0`);
    await browser.wait(`Array.from(document.querySelectorAll('.row')[1].querySelectorAll('img')).some(i=>i.naturalWidth>0)`);
    assert.ok(requests.includes("a-1-0"),"The next vertical row starts 120px before visibility");
    assert.ok(!requests.some(id=>Number(id.split("-")[1])>=2),"Distant rows stay unloaded");
    if(width<768){
      assert.deepEqual(requests.filter(id=>id.startsWith("a-0-")).sort(),["a-0-0","a-0-1"]);
      await browser.evaluate(`document.querySelector('.row').scrollLeft=250`);
      await browser.wait(`document.querySelectorAll('.row img')[2].naturalWidth>0`);
      const geometry=await browser.evaluate(`document.querySelectorAll('.row img')[2].getBoundingClientRect().left`);
      assert.ok(geometry>=width,"Next horizontal image is loaded while still clipped");
      assert.ok(!requests.includes("a-0-3"));
    }
    const high=await browser.evaluate(`document.querySelectorAll('img[fetchpriority="high"]').length`);
    assert.ok(high<=2,"High priority limited to the initial visible images");
    const count=requests.length;
    // Replace sources and scroll in a single turn before scheduled work. Old
    // queued geometry must not activate newly distant rows.
    await browser.evaluate(`window.scrollTo(0,3000);window.renderFixture('b');window.scrollTo(0,6000)`);
    await browser.wait(`Array.from(document.images).some(i=>i.naturalWidth>0&&i.getAttribute('src')?.startsWith('/image/b-'))`);
    assert.ok(!requests.slice(count).some(id=>/^b-[012]-/.test(id)));
    // A new source in a currently visible card must really decode, not retain
    // the previous source's readiness.
    await browser.evaluate(`window.scrollTo(0,0);window.renderFixture('c')`);
    await browser.wait(`document.querySelector('img')?.getAttribute('src')==='/image/c-0-0'&&document.querySelector('img').naturalWidth>0`);
    // Verify actual painted pixels, not just loaded DOM nodes.
    const screenshot=await browser.command("Page.captureScreenshot",{format:"png"});
    const sample=await sharp(Buffer.from(screenshot.data,"base64")).extract({left:20,top:20,width:1,height:1}).raw().toBuffer();
    assert.ok(sample[2]>180&&sample[0]<40,"Decoded blue thumbnail is actually painted");
    assert.deepEqual(browser.errors,[]);
  }finally{await browser.close();await new Promise(r=>server.close(r));}
});
