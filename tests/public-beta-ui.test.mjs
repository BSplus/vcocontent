import test from "node:test";
import assert from "node:assert/strict";
import { pageMetadata } from "../shared/pagination.ts";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

test("mobile verified creator activation, gallery/photo upload and publication need no payment or wizard",{timeout:90000},async()=>{
  const browser=await uiBrowser();
  const base=process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
  let user={id:78101,username:"Synthetic beta creator",email:"fixture@example.test",emailVerifiedAt:null,isCreator:false,isAdmin:false,creatorStatus:"none",suspended:false};
  let gallery,photo;const requests=[];
  browser.listeners.add(message=>{
    if (message.method!=="Fetch.requestPaused") return;
    const {requestId,request}=message.params,path=new URL(request.url).pathname;
    requests.push({path,method:request.method});
    let data=[];
    if(path==="/api/user") data=user;
    else if(path==="/api/email-verification/send") data={sent:true};
    else if(path==="/api/email-verification/confirm") {user={...user,emailVerifiedAt:"2026-10-10T12:00:00Z"};data={verified:true};}
    else if(path==="/api/creator/request") {user={...user,isCreator:true,creatorStatus:"approved"};data=user;}
    else if(path==="/api/creator/events" && request.method==="POST") {
      gallery={...JSON.parse(request.postData),id:78102,creatorId:user.id,createdAt:"2026-10-10T12:00:00Z",visibility:"draft",safetyStatus:"approved",adminHidden:false,isPremium:false};data=gallery;
    } else if(path==="/api/creator/events" || path==="/api/events") data=gallery?[gallery]:[];
    else if(path==="/api/creator/usage") data={bytes:photo?1200:0,galleries:gallery?1:0,photos:photo?1:0,limits:{bytes:500000000,galleries:5,photos:1000,imageBytes:5000000},exception:false};
    else if(path==="/api/media/policy") data={community:true,imageBytes:5000000,videoBytes:0,zipBytes:100000000,zipCount:100,maxPixels:40000000,displayEdge:2560};
    else if(path==="/api/creator/media" || path===`/api/events/${gallery?.id}/media`) data=
      new URL(request.url).searchParams.get("pagination")==="true" ? {...pageMetadata(photo?1:0,1,48),items:photo?[photo]:[]} : photo?[photo]:[];
    else if(path===`/api/events/${gallery?.id}/media/upload`) {
      photo={id:78103,eventId:gallery.id,type:"image",caption:"Synthetic photo",url:"/synthetic-private-file",thumbnail:"data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#175943"/></svg>'),
        tags:["Day"],identification:[],safetyStatus:"approved",isPremium:false};data=photo;
    } else if(path===`/api/events/${gallery?.id}/publish`) {gallery={...gallery,visibility:"published"};data=gallery;}
    else if(path===`/api/media/${photo?.id}/analysis`) data={status:"completed",generatedTags:["Day"]};
    else if(path===`/api/events/${gallery?.id}`) data=gallery;
    void browser.command("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(data)).toString("base64")});
  });
  const click=async label=>{
    await browser.wait(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`);
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled).click()`);
  };
  try {
    await browser.command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await browser.command("Fetch.enable",{patterns:[{urlPattern:"*/api/*",requestStage:"Request"}]});
    await browser.command("Page.navigate",{url:new URL("/creator/apply",base).href});
    await browser.wait("document.body.innerText.toLowerCase().includes('verify your email first')");
    await click("Resend verification email");
    await browser.wait("document.body.innerText.toLowerCase().includes('verification email sent')");
    await browser.command("Page.navigate",{url:new URL("/auth#verify="+"a".repeat(64),base).href});
    await browser.wait("document.body.innerText.toLowerCase().includes('email verified')");
    assert.equal(await browser.evaluate("location.hash"),"");
    await browser.command("Page.navigate",{url:new URL("/creator/apply",base).href});
    await click("Activate creator access");
    await delay(300);
    assert.ok(requests.some(r=>r.path==="/api/creator/request"&&r.method==="POST"),JSON.stringify({requests,user}));
    await browser.wait("location.pathname==='/creator/dashboard' && document.body.innerText.includes('500 MB')");
    await click("My Galleries");
    await click("Create New Event");
    await browser.wait("!!document.querySelector('[role=dialog]')");
    await browser.evaluate(`for(const [name,value] of [['title','Synthetic mobile gallery'],['description','Neutral racing photography'],['date','2026-10-10']]){
      const element=document.querySelector('[role=dialog] [name="'+name+'"]');
      const proto=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));
    }`);
    await browser.evaluate("document.querySelector('[role=dialog] form').requestSubmit()");
    await click("Done");
    await browser.wait("!document.querySelector('[role=dialog]') && document.body.textContent.includes('Synthetic mobile gallery')");
    // Use the gallery's existing upload control, not an additional onboarding step.
    await browser.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Upload Media')).click()");
    await browser.wait("!!document.querySelector('[role=dialog] input[type=file]')");
    await browser.evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;
      canvas.getContext('2d').fillRect(0,0,64,48);
      await new Promise(resolve=>canvas.toBlob(blob=>{const transfer=new DataTransfer();transfer.items.add(new File([blob],'synthetic.png',{type:'image/png'}));
      const input=document.querySelector('[role=dialog] input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));resolve();},'image/png'));})()`);
    await browser.wait("[...document.querySelectorAll('[role=dialog] button')].some(b=>b.textContent.toLowerCase().includes('upload 1 file')&&!b.disabled)");
    await browser.evaluate("[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.includes('Upload')&&!b.disabled).click()");
    for(let i=0;i<100 && !photo;i++) await delay(30);
    assert.ok(photo,"Upload was saved through the photo endpoint");
    await delay(200);
    await click("Cancel");
    await browser.wait("!document.querySelector('[role=dialog]')");
    await click("Publish");
    await browser.wait("document.body.innerText.toLowerCase().includes('unpublish')");
    await delay(150);
    assert.equal(await browser.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"),true);
    assert.ok(requests.some(r=>r.path.endsWith("/media/upload")&&r.method==="POST"));
    assert.ok(requests.some(r=>r.path.endsWith("/publish")&&r.method==="POST"));
    assert.equal(requests.some(r=>/credits|checkout|purchase|subscription|earnings/.test(r.path)),false);
    assert.deepEqual(browser.errors,[]);
  } catch(error) {
    console.error({requests:requests.slice(-12),creator:user.isCreator,errors:browser.errors});
    throw error;
  } finally {await browser.close();}
});
