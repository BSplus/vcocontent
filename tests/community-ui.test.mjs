import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser,delay } from "./helpers/ui-browser.mjs";
import { pageMetadata } from "../shared/pagination.ts";

const base=process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const poster="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#20354a"/></svg>');
const date="2026-09-28T12:00:00Z";
const photo={id:64101,eventId:64003,type:"image",caption:"Fixture photo",thumbnail:poster,url:poster,tags:[],downloadCount:3};
const gallery={id:64003,title:"Fixture gallery",date,description:"Fixture description",creatorId:64001,
  visibility:"published",safetyStatus:"legacy",coverImage:poster};

test("community actions, private account and studio work with keyboard and narrow screens",{timeout:120000},async()=>{
  const browser=await uiBrowser();
  let signedIn=true,failLike=false,liked=false,saved=false,count=2;
  let user={id:64001,username:"Fixture Creator",email:"fixture@example.test",isCreator:true,creatorStatus:"approved",
    emailVerifiedAt:date,credits:"0",suspended:false,bio:"Fixture bio"};
  const writes=[],mockErrors=[];
  browser.listeners.add(event=>{
    if(event.method!=="Fetch.requestPaused")return;
    const {requestId,request}=event.params;
    const path=new URL(request.url).pathname;
    let body=[],status=200;
    if(path==="/api/user"){status=signedIn?200:401;body=signedIn?user:{error:"Not signed in"};}
    else if(path.startsWith("/api/community/")){
      if(request.method!=="GET"){
        writes.push(request.method+" "+path);
        if(failLike && path.endsWith("/like")){status=400;body={error:"Synthetic rejection"};failLike=false;}
        else if(path.endsWith("/like")){liked=request.method==="PUT";count=liked?3:2;}
        else if(path.endsWith("/favorite"))saved=request.method==="PUT";
      }
      if(status===200)body={count,liked,saved};
    }
    else if(path==="/api/account/profile"){
      const data=JSON.parse(request.postData);writes.push(data);user={...user,...data};body=user;
    }
    else if(path==="/api/account/favorites")body={items:[{kind:"media",id:photo.id,title:photo.caption,thumbnail:poster,eventTitle:gallery.title,href:`/media/${photo.id}`,date}],hasMore:false};
    else if(path==="/api/account/downloads")body={items:[1,2].map(historyId=>({historyId,id:photo.id,title:photo.caption,thumbnail:poster,eventTitle:gallery.title,href:`/media/${photo.id}`,date,quality:"high"})),hasMore:false};
    else if(path==="/api/creator/usage")body={bytes:12000000,galleries:1,photos:2,unknown:0,pendingCleanup:0,adminExempt:false,
      limits:{bytes:500000000,galleries:5,photos:1000,imageBytes:5000000},eventStats:[{eventId:gallery.id,photos:2,videos:0,downloads:3}]};
    else if(path==="/api/creator/events" || path==="/api/events")body=[gallery];
    else if(path==="/api/creator/media" || path==="/api/creator/recent-media" || path===`/api/events/${gallery.id}/media`)body=[photo];
    else if(path===`/api/media/${photo.id}`)body=photo;
    else if(path===`/api/events/${gallery.id}`)body=gallery;
    else if(path.startsWith("/api/users/"))body=user;
    else if(path==="/api/media/policy")body={community:true,imageBytes:5000000,videoBytes:0,maxPixels:40000000,zipCount:100,zipBytes:104857600};
    if (Array.isArray(body) && new URL(request.url).searchParams.get("pagination") === "true") body = {...pageMetadata(body.length,1,48),items:body};
    if (path.startsWith("/api/account/") && Array.isArray(body.items)) body = {...body,...pageMetadata(body.items.length,1,24)};
    browser.command("Fetch.fulfillRequest",{requestId,responseCode:status,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(body)).toString("base64")}).catch(e=>{
      // Navigation can cancel an intercepted query before fulfillment; this is not an app exception.
      if(!String(e).includes("Invalid InterceptionId")) mockErrors.push(String(e));
    });
  });
  await browser.command("Fetch.enable",{patterns:[{urlPattern:"*/api/*",requestStage:"Request"}]});
  const visit=async(path,ready)=>{await browser.command("Page.navigate",{url:new URL(path,base).href});await browser.wait(ready);};
  const clickText=async(text)=>browser.evaluate(`(()=>{const el=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error('Missing ${text}');el.click();})()`);
  const press=async(key,code,value)=>{await browser.command("Input.dispatchKeyEvent",{type:"keyDown",key,code,windowsVirtualKeyCode:value,...(key==="Enter"?{text:"\r"}:{})});await browser.command("Input.dispatchKeyEvent",{type:"keyUp",key,code,windowsVirtualKeyCode:value});};
  try {
    for(const width of [1280,390]){
      liked=false;saved=false;count=2;
      await browser.command("Emulation.setDeviceMetricsOverride",{width,height:844,deviceScaleFactor:1,mobile:width<600});
      await visit(`/media/${photo.id}`,`!!document.querySelector('button[aria-label^="Like Fixture photo"]:not(:disabled)')`);
      await browser.evaluate(`document.querySelector('button[aria-label^="Like Fixture photo"]').focus()`);
      await press("Enter","Enter",13);
      await browser.wait(`document.querySelector('button[aria-label^="Unlike Fixture photo"]:not(:disabled)')?.getAttribute('aria-pressed')==='true'`);
      assert.equal(count,3);
      await browser.evaluate(`document.querySelector('button[aria-label^="Save to favorites"]').click()`);
      await browser.wait(`!!document.querySelector('button[aria-label^="Remove from favorites"]:not(:disabled)')`);
      failLike=true;
      await browser.evaluate(`document.querySelector('button[aria-label^="Unlike Fixture photo"]').click()`);
      await browser.wait(`document.body.innerText.includes('previous state has been restored')`);
      assert.equal(await browser.evaluate(`document.querySelector('button[aria-label^="Unlike Fixture photo"]').getAttribute('aria-pressed')`),"true");
      await visit("/account?tab=favorites",`document.querySelectorAll('article').length===1`);
      assert.equal(await browser.evaluate(`document.querySelector('article a').getAttribute('href')`),`/media/${photo.id}`);
      await clickText("My Downloads");
      await browser.wait(`document.querySelectorAll('article').length===2`);
      assert.match(await browser.evaluate(`document.querySelector('main').innerText`),/28 September 2026/);
      await clickText("Settings");
      await browser.wait(`!!document.querySelector('#profile-bio')`);
      await browser.evaluate(`(()=>{const input=document.querySelector('#profile-bio');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'Updated fixture bio');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await clickText("Save profile");
      await browser.wait(`document.body.innerText.includes('Your profile was updated')`);
      assert.ok(writes.some(w=>typeof w==="object" && w.bio==="Updated fixture bio" && !("isAdmin" in w)));
      await visit("/creator/dashboard",`!!document.querySelector('#recent-photos-heading')`);
      await clickText("My Galleries");
      await browser.wait(`!!document.querySelector('section[aria-label="My Galleries"] article img')`);
      assert.match(await browser.evaluate(`document.querySelector('section[aria-label="My Galleries"]').innerText`),/2 photos/);
      assert.ok(await browser.evaluate(`document.body.textContent.includes('Upload')`));
      await clickText("Account");
      await browser.wait(`!!document.querySelector('#profile-bio')`);
      assert.equal(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),true,`${width}px account overflow`);
    }
    signedIn=false;
    await visit(`/media/${photo.id}`,`document.body.innerText.includes('Sign in to join in')`);
    await clickText("Sign in to join in");
    await browser.wait(`location.pathname==='/auth'`);
    assert.equal(await browser.evaluate(`new URLSearchParams(location.search).get('next')`),`/media/${photo.id}`);
    assert.deepEqual(mockErrors,[]);
    assert.deepEqual(browser.errors,[]);
  } finally {await browser.close();}
});
