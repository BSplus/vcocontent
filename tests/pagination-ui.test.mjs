import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";
import { pageMetadata } from "../shared/pagination.ts";

const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const date = "2026-10-01T12:00:00Z";
const poster = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="navy"/></svg>');
const album = {id:97501,title:"Pagination fixture",creatorId:null,description:"Synthetic pagination",
  date,visibility:"published",safetyStatus:"legacy",isPremium:false};
const user = {id:97500,username:"Pagination fixture",isAdmin:true,isCreator:true,creatorStatus:"approved",emailVerifiedAt:date};
const adminUsage = {total:{bytes:"0",count:"0",legacy:"0",legacyTextBytes:"0"},byEvent:[],byCreator:[],
  cleanupCount:"0",policy:{eventBytes:1000000,creatorBytes:1000000,eventCount:1000,creatorCount:1000},warningFraction:0.8};

test("search, event, managed media and account page boundaries, scopes, history, narrow layout and keyboard", {timeout:180000}, async () => {
  const browser = await uiBrowser();
  let total=0, fail=false, pause=0, galleryTotal=1;
  const requests=[], failures=[];
  browser.listeners.add(event=>{
    if(event.method!=="Fetch.requestPaused")return;
    void (async()=>{
      const {requestId,request}=event.params,url=new URL(request.url),path=url.pathname;
      let body=[],status=200;
      const page=Number(url.searchParams.get("page") || 1);
      const list = path==="/api/media" || /\/api\/events\/\d+\/media$/.test(path) || /\/api\/account\/(favorites|downloads|following)$/.test(path);
      if(path==="/api/user")body=user;
      else if(path==="/api/admin/events" || path==="/api/creator/events")body=Array.from({length:galleryTotal},(_,i)=>({...album,id:album.id+i,title:`Pagination fixture ${i}`}));
      else if(/\/api\/events\/\d+$/.test(path))body={...album,id:Number(path.split("/").at(-1))};
      else if(path==="/api/admin/safety")body={media:[],events:[]};
      else if(path==="/api/admin/media-usage")body=adminUsage;
      else if(path==="/api/community/event/97501")body={count:0,liked:false,saved:false};
      else if(path==="/api/creator/usage")body={bytes:0,galleries:galleryTotal,photos:total,unknown:0,pendingCleanup:0,adminExempt:true,
        limits:{bytes:500000000,galleries:5,photos:1000,imageBytes:5000000},eventStats:[]};
      else if(list) {
        const size=path.startsWith("/api/account/")?24:48;
        const meta=pageMetadata(total,page,size);
        const items=Array.from({length:Math.min(size,Math.max(0,total-(meta.page-1)*size))},(_,i)=>{
          const id=(meta.page-1)*size+i+1;
          return path.endsWith("/following") ? {id,username:`Creator ${id}`,displayName:`Creator ${id}`} :
            path.startsWith("/api/account/") ? {kind:"media",id,historyId:id,title:`Item ${id}`,thumbnail:poster,
              eventTitle:album.title,href:`/media/${id}`,date,quality:"high"} :
              {id,eventId:album.id,type:"image",caption:`Photo ${id}`,url:poster,thumbnail:poster,tags:[],downloadCount:0};
        });
        body=url.searchParams.get("pagination")==="true" || path.startsWith("/api/account/") ? {...meta,items} : items;
        requests.push({path,page});
        if(pause)await delay(pause);
        if(fail){status=503;body={error:"Synthetic pagination error"};}
      }
      await browser.command("Fetch.fulfillRequest",{requestId,responseCode:status,
        responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(body)).toString("base64")});
    })().catch(error=>{if(!/Invalid InterceptionId|closed|session/i.test(String(error)))failures.push(String(error));});
  });
  const visit=async path=>{
    await browser.command("Page.navigate",{url:new URL(path,base).href});
  };
  const click=async text=>{
    const expr=`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled&&b.getAttribute('role')!=='tab')`;
    await browser.wait(`!!(${expr})`);await browser.evaluate(`(${expr}).click()`);
  };
  const nav=label=>`document.querySelector('nav[aria-label=${JSON.stringify(label)}]')`;
  const check=async(label,current,pages)=>{
    await browser.wait(`${nav(label)}?.textContent.includes('PAGE ${current} OF ${pages}')`);
    const state=await browser.evaluate(`(()=>{const n=${nav(label)},b=n.querySelectorAll('button');return {
      previous:b[0].disabled,next:b[b.length-1].disabled,text:n.textContent,
      overflow:document.documentElement.scrollWidth>innerWidth,
      statusFits:[...n.querySelectorAll('span')].filter(e=>e.textContent.startsWith('PAGE ')).every(e=>e.getBoundingClientRect().width<=innerWidth)
    };})()`);
    assert.equal(state.previous,current===1);
    assert.equal(state.next,current===pages);
    assert.equal(state.overflow,false,label);
    assert.equal(state.statusFits,true,label);
    assert.doesNotMatch(state.text,/\bPage\b/);
  };
  try {
    await browser.command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await browser.command("Fetch.enable",{patterns:[{urlPattern:"*/api/*",requestStage:"Request"}]});
    for (const [route,label,size] of [
      ["/search","Search result pages",48],
      ["/events/97501",null,48],
      ["/account?tab=favorites","favorites pages",24],
      ["/account?tab=downloads","downloads pages",24],
      ["/account?tab=following","Following pages",24],
      ["/admin/dashboard","admin-media",48],
      ["/creator/dashboard","creator-media",48],
    ]) {
      for (const count of [0,1,size,size+1,size*2]) {
        total=count;await visit(route);
        if(label==="admin-media"){
          await click("Manage Media");
        } else if(label==="creator-media"){
          await click("My Galleries");await click("Manage Media");
        }
        if(count===0){
          const empty=route==="/search"?"No matching media":route.startsWith("/events/")?"No media available":
            label==="Following pages"?"Your circuit starts here":label==="favorites pages"?"Nothing saved":
            label==="downloads pages"?"No completed downloads":"No media uploaded";
          await browser.wait(`document.body.innerText.toLowerCase().includes(${JSON.stringify(empty.toLowerCase())})`);
          if(route==="/search")await check(label,1,1);
          continue;
        }
        // Existing event/managed controls are divs, not navigation elements.
        if(!label || label.endsWith("-media")) {
          await browser.wait(`(()=>{const buttons=[...document.querySelectorAll('button')],
            next=buttons.find(b=>b.textContent==='Next'),previous=buttons.find(b=>b.textContent==='Previous');
            return next?.disabled===${count<=size} && previous?.disabled===true &&
              next.parentElement.textContent.includes('PAGE 1 OF ${Math.ceil(count/size)}');})()`);
        } else await check(label,1,Math.ceil(count/size));
        if(count>size){
          await click("Next");
          await browser.wait(`document.body.innerText.includes('PAGE 2 OF 2')`);
          assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Next').disabled`),true,"full last page has no empty successor");
          if(label && !label.endsWith("-media"))await check(label,2,2);
          // A shrinking collection clamps the request and the local state.
          total=1;
          await browser.evaluate(`import('/src/lib/queryClient.ts').then(m=>m.queryClient.invalidateQueries({predicate:q=>String(q.queryKey[0]).includes('/media')||String(q.queryKey[0]).includes('/account/')}))`);
          await browser.wait(`document.body.innerText.includes('PAGE 1 OF 1')`);
        }
      }
    }
    // Client-computed event and gallery pages use their existing eight-item size.
    galleryTotal=16;total=0;await visit("/admin/dashboard");
    await check("VCO Events pages",1,2);await click("Next");await check("VCO Events pages",2,2);
    await browser.evaluate(`(()=>{const e=document.querySelector('#admin-event-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'fixture 15');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await browser.wait(`!document.querySelector('nav[aria-label="VCO Events pages"]') && document.body.innerText.includes('Pagination fixture 15')`);
    await visit("/creator/dashboard");await click("My Galleries");
    await check("Gallery pages",1,2);await click("Next");await check("Gallery pages",2,2);
    galleryTotal=1;total=96;
    await visit("/search?q=photo&fields=caption");await check("Search result pages",1,2);
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Next').focus()`);
    await browser.command("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13,text:"\r"});
    await browser.command("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
    await check("Search result pages",2,2);
    await browser.evaluate("history.back()");await check("Search result pages",1,2);
    await browser.evaluate("history.forward()");await check("Search result pages",2,2);
    assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('fields')"),"caption");
    total=1;await visit("/search?q=photo&fields=caption&page=99&extra=keep");
    await check("Search result pages",1,1);
    await browser.wait(`!new URLSearchParams(location.search).has('page')`);
    assert.equal(await browser.evaluate("new URLSearchParams(location.search).get('extra')"),"keep");
    total=96;await visit("/account?tab=downloads");await check("downloads pages",1,4);
    await click("Next");await check("downloads pages",2,4);
    await browser.evaluate("history.pushState(null,'','/account?tab=favorites')");
    await check("favorites pages",1,4);
    await browser.evaluate("history.back()");await check("downloads pages",1,4);
    total=96;await visit("/events/97501");await browser.wait("document.body.innerText.includes('PAGE 1 OF 2')");
    await click("Next");await browser.wait("document.body.innerText.includes('PAGE 2 OF 2')");
    await browser.evaluate("history.pushState(null,'','/events/97502')");
    await browser.wait("document.body.innerText.includes('PAGE 1 OF 2')");
    pause=900;await visit("/search");
    await browser.wait("document.body.innerText.includes('Searching media')");
    assert.equal(await browser.evaluate("document.body.innerText.includes('PAGE ')"),false);
    pause=0;fail=true;await visit("/search");
    await browser.wait("document.body.innerText.includes('Could not load search results')");
    assert.equal(await browser.evaluate("document.body.innerText.includes('PAGE ')"),false);
    assert.deepEqual(failures,[]);assert.deepEqual(browser.errors,[]);
  } finally {await browser.close();}
});

test("a photo-matching response slower than the polling interval still loads and navigates", {timeout:60000},async()=>{
  const browser=await uiBrowser();
  const reads=[],failures=[];
  browser.listeners.add(event=>{
    if(event.method!=="Fetch.requestPaused")return;
    void(async()=>{
      const {requestId,request}=event.params,url=new URL(request.url),path=url.pathname;
      let body=[];
      if(path==="/api/user")body=user;
      else if(path==="/api/admin/events")body=[album];
      else if(path==="/api/admin/safety")body={media:[],events:[]};
      else if(path==="/api/admin/media-usage")body=adminUsage;
      else if(path===`/api/events/${album.id}`)body=album;
      else if(path===`/api/events/${album.id}/references`)body={documents:[],canUseSeason:false};
      else if(path===`/api/events/${album.id}/thumbnail-options`)body={...pageMetadata(0,1,24),photos:[]};
      else if(path===`/api/events/${album.id}/photo-matching`){
        const page=url.searchParams.has("before")?2:1;
        reads.push(page);
        await delay(5500);
        body={...pageMetadata(1000,page,500),enabled:true,platform:null,
          nextCursor:page===1?501:null,
          photos:Array.from({length:500},(_,i)=>({id:(page===1?1000:500)-i,caption:"Synthetic slow photo",
            captionSource:null,identificationManual:false,status:"not_requested",error:null,matchStatus:null}))};
      }
      await browser.command("Fetch.fulfillRequest",{requestId,responseCode:200,
        responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(body)).toString("base64")});
    })().catch(error=>{if(!/Invalid InterceptionId|closed|session/i.test(String(error)))failures.push(String(error));});
  });
  const root=`document.querySelector('[aria-labelledby="photo-matching-heading"]')`;
  try{
    await browser.command("Fetch.enable",{patterns:[{urlPattern:"*/api/*",requestStage:"Request"}]});
    await browser.command("Page.navigate",{url:new URL("/admin/dashboard",base).href});
    await browser.wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Edit Event')`);
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Edit Event').click()`);
    await browser.wait(`${root}?.textContent.includes('PAGE 1 OF 2')`);
    assert.deepEqual(reads,[1],"a polling tick must not replace the initial slow request");
    await browser.evaluate(`${root}.querySelector('button[aria-label="Select photo 1000"]').click()`);
    await browser.wait(`${root}.textContent.includes('1 of 50 photos selected')`);
    await browser.evaluate(`[...${root}.querySelectorAll('button')].find(b=>b.textContent==='Older photos').click()`);
    await browser.wait(`${root}?.textContent.includes('PAGE 2 OF 2')`);
    assert.deepEqual(reads,[1,2],"a polling tick must not replace slow cursor navigation");
    assert.equal(await browser.evaluate(`${root}.textContent.includes('1 of 50 photos selected')`),false);
    await browser.wait(`${root}.querySelector('button[aria-label="Select photo 500"]')?.disabled===false`);
    assert.deepEqual(failures,[]);assert.deepEqual(browser.errors,[]);
  }finally{await browser.close();}
});

test("thumbnail and 500-photo cursor page counts retain safe selection and reset changed positions", {timeout:120000},async()=>{
  const browser=await uiBrowser();
  let total=0,thumbnailTotal=0,fail=false;
  const failures=[];
  browser.listeners.add(event=>{
    if(event.method!=="Fetch.requestPaused")return;
    void(async()=>{
      const {requestId,request}=event.params,url=new URL(request.url),path=url.pathname;
      let body=[],status=200;
      if(path==="/api/user")body=user;
      else if(path==="/api/admin/events")body=[album];
      else if(path===`/api/events/${album.id}`)body=album;
      else if(path==="/api/admin/safety")body={media:[],events:[]};
      else if(path==="/api/admin/media-usage")body=adminUsage;
      else if(path===`/api/events/${album.id}/references`)body={documents:[],canUseSeason:false};
      else if(path===`/api/events/${album.id}/thumbnail-options`){
        const bounds=pageMetadata(thumbnailTotal,Number(url.searchParams.get("page")||1),24);
        body={...bounds,photos:Array.from({length:Math.min(24,Math.max(0,thumbnailTotal-(bounds.page-1)*24))},(_,i)=>{
          const id=(bounds.page-1)*24+i+1;
          return {id,reference:`/api/media/legacy/${id}/thumbnail`,preview:poster,caption:`Photo ${id}`};
        })};
        if(fail){status=503;body={error:"Synthetic options error"};}
      } else if(path===`/api/events/${album.id}/photo-matching`){
        const before=Number(url.searchParams.get("before")||0);
        const preceding=before?total-before+1:0;
        const positionReset=!!before&&(preceding%500!==0||preceding>=total||preceding<500);
        const bounds=pageMetadata(total,before&&!positionReset?preceding/500+1:1,500);
        body={...bounds,positionReset,enabled:true,platform:null,
          photos:Array.from({length:Math.min(500,Math.max(0,total-(bounds.page-1)*500))},(_,i)=>({
            id:total-(bounds.page-1)*500-i,caption:`Photo ${total-(bounds.page-1)*500-i}`,captionSource:null,
            identificationManual:false,status:"not_requested",error:null,matchStatus:null,
          }))};
        body.nextCursor=bounds.hasMore?body.photos.at(-1).id:null;
      }
      await browser.command("Fetch.fulfillRequest",{requestId,responseCode:status,
        responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(body)).toString("base64")});
    })().catch(error=>{if(!/Invalid InterceptionId|closed|session/i.test(String(error)))failures.push(String(error));});
  });
  const matching=`document.querySelector('[aria-labelledby="photo-matching-heading"]')`;
  const thumbnails=`document.querySelector('section[aria-label="Choose a gallery photo"]')`;
  const click=async(label,root="document")=>{
    const expr=`[...${root}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
    await browser.wait(`!!(${expr})`);await browser.evaluate(`(${expr}).click()`);
  };
  const open=async()=>{
    await browser.command("Page.navigate",{url:new URL("/admin/dashboard",base).href});
    await click("Edit Event");
    await browser.wait(`!!${matching} && !!${thumbnails}`);
  };
  try{
    await browser.command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await browser.command("Fetch.enable",{patterns:[{urlPattern:"*/api/*",requestStage:"Request"}]});
    for(const [photos,covers] of [[0,0],[1,1],[500,24],[501,25],[1000,48]]){
      total=photos;thumbnailTotal=covers;await open();
      await browser.wait(`${matching}.textContent.includes('PAGE 1 OF ${Math.max(1,Math.ceil(total/500))}')`);
      assert.equal(await browser.evaluate(`[...${matching}.querySelectorAll('button')].find(b=>b.textContent==='Older photos').disabled`),photos<=500);
      assert.equal(await browser.evaluate(`[...${matching}.querySelectorAll('button')].find(b=>b.textContent==='Newer photos').disabled`),true);
      if(!photos){
        await browser.wait(`${matching}.textContent.includes('No photos to match')`);
        await browser.wait(`${thumbnails}.textContent.includes('No eligible photos')`);
        continue;
      }
      await browser.wait(`${thumbnails}.textContent.includes('PAGE 1 OF ${Math.ceil(covers/24)}')`);
      assert.equal(await browser.evaluate(`[...${thumbnails}.querySelectorAll('button')].find(b=>b.textContent==='More photos').disabled`),covers<=24);
      await browser.evaluate(`${thumbnails}.querySelector('button[aria-label="Select photo: Photo 1"]').click()`);
      await browser.wait(`${thumbnails}.querySelector('button[aria-label="Select photo: Photo 1"]').getAttribute('aria-pressed')==='true'`);
      if(covers>24){
        await click("More photos",thumbnails);
        await browser.wait(`${thumbnails}.textContent.includes('PAGE 2 OF 2')`);
        assert.equal(await browser.evaluate(`[...${thumbnails}.querySelectorAll('button')].find(b=>b.textContent==='More photos').disabled`),true);
        thumbnailTotal=1;
        await click("Previous photos",thumbnails);
        await browser.wait(`${thumbnails}.textContent.includes('PAGE 1 OF 1')`);
        assert.equal(await browser.evaluate(`${thumbnails}.querySelector('button[aria-label="Select photo: Photo 1"]').getAttribute('aria-pressed')`),"true");
      }
      // Only selection UI is exercised, never AI processing or publication.
      await browser.evaluate(`${matching}.querySelector('button[aria-label="Select photo ${photos}"]').click()`);
      await browser.wait(`${matching}.textContent.includes('1 of 50 photos selected')`);
      if(photos>500){
        await click("Older photos",matching);
        await browser.wait(`${matching}.textContent.includes('PAGE 2 OF 2')`);
        assert.equal(await browser.evaluate(`${matching}.textContent.includes('1 of 50 photos selected')`),false);
        assert.equal(await browser.evaluate(`[...${matching}.querySelectorAll('button')].find(b=>b.textContent==='Older photos').disabled`),true);
        await browser.evaluate(`${matching}.querySelector('button[aria-label^="Select photo"]').click()`);
        await browser.wait(`${matching}.textContent.includes('1 of 50 photos selected')`);
        total++;
        await browser.evaluate(`${matching}.querySelector('button[aria-label="Refresh photo matching status"]').click()`);
        await browser.wait(`${matching}.textContent.includes('PAGE 1 OF ${Math.ceil(total/500)}') && ${matching}.textContent.includes('Returned to the first page')`);
        assert.equal(await browser.evaluate(`${matching}.textContent.includes('1 of 50 photos selected')`),false);
        await browser.wait(`${matching}?.querySelector('button[aria-label^="Select photo"]')?.getAttribute('aria-checked')==='false' &&
          ${matching}.textContent.includes('Returned to the first page')`);
      }
      assert.equal(await browser.evaluate(`document.querySelector('[role="dialog"]').scrollWidth<=document.querySelector('[role="dialog"]').clientWidth+1`),true);
    }
    fail=true;await open();
    await browser.wait(`${thumbnails}.textContent.includes('Photos could not be loaded')`);
    assert.equal(await browser.evaluate(`${thumbnails}.textContent.includes('PAGE ')`),false);
    assert.deepEqual(failures,[]);assert.deepEqual(browser.errors,[]);
  }finally{await browser.close();}
});
