import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { build } from "esbuild";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

test("download sizes load only on open, show exact bytes, handle errors and respect sign-in", { timeout: 30000 }, async () => {
  const output = await build({ stdin: { contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import Label from './client/src/components/download-option-label';
    const client=new QueryClient();const root=createRoot(document.getElementById('root'));
    const item={id:1,type:'image',highBytes:9000000,lowBytes:123,url:'/api/media/files/media-01999999-0000-7000-8000-000000000000.jpg'};
    window.show=(quality='low',id=1,signedIn=true)=>{window.fixtureUser=signedIn?{id:7}:null;
      flushSync(()=>root.render(<QueryClientProvider client={client}><Label item={{...item,id}} quality={quality}/></QueryClientProvider>));};
    window.hide=()=>flushSync(()=>root.render(null));`,
    resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "esm", jsx: "automatic",
    plugins: [{name:"fixture-auth",setup(build){
      build.onResolve({filter:/^@\/hooks\/use-auth$/},()=>({path:"auth",namespace:"fixture"}));
      build.onResolve({filter:/^@\/lib\/media-download$/},()=>({path:process.cwd()+"/client/src/lib/media-download.ts"}));
      build.onResolve({filter:/^@shared\/image-provenance$/},()=>({path:process.cwd()+"/shared/image-provenance.ts"}));
      build.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export function useAuth(){return {user:window.fixtureUser};}"}));
    }}] });
  const requests=[];
  const app=express();
  app.get("/",(_req,res)=>res.type("html").send('<div id="root"></div><script type="module" src="/fixture.js"></script>'));
  app.get("/fixture.js",(_req,res)=>res.type("js").send(output.outputFiles[0].text));
  app.get("/api/media/:id/download-info",(req,res)=>{
    requests.push([req.params.id,req.query.quality]);
    setTimeout(()=>req.params.id==="2"?res.status(503).json({error:"busy"}):res.json({bytes:129345}),150);
  });
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");
  const browser=await uiBrowser();
  try{
    await browser.command("Page.navigate",{url:`http://127.0.0.1:${server.address().port}`});
    await browser.wait("typeof window.show==='function'");
    assert.equal(requests.length,0,"closed options do not prepare grid-wide downloads");
    await browser.evaluate("window.show()");
    await browser.wait("document.body.textContent.includes('calculating size')");
    await browser.wait("document.body.textContent.includes('129,345 bytes')");
    assert.ok((await browser.evaluate("document.body.textContent")).includes("0.13 MB"));
    assert.equal(await browser.evaluate("document.querySelector('span').title"),"129,345 bytes");
    await browser.evaluate("window.show('low',2)");
    await browser.wait("document.body.textContent.includes('Size unavailable')");
    await delay(300);
    assert.equal(requests.filter(r=>r[0]==="2").length,1,"no automatic retry storm");
    const before=requests.length;
    await browser.evaluate("window.show('high',3,false)");
    await browser.wait("document.body.textContent.includes('sign in to see size')");
    await delay(200);assert.equal(requests.length,before,"anonymous high-res size requests are not made");
    assert.ok(requests.every(r=>r[1]==="low"),"size checks never issue download authorizations");
  }finally{await browser.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
});
