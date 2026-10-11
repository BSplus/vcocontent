import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser } from "./helpers/ui-browser.mjs";
import { profileImageBytes } from "./helpers/profile-image.mjs";

const base=process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const poster="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="640"><rect width="1920" height="640" fill="#263541"/></svg>');

test("creator profile, follow, name previews, following list and visual profile editor work on desktop and mobile",{timeout:120000},async()=>{
  const source = await profileImageBytes(1_500_000);
  const maximum = await profileImageBytes(3_000_000, "#abcdef");
  const oversized = await profileImageBytes(3_000_001);
  const browser=await uiBrowser(), mockErrors=[], writes=[];
  let following=false, failFollow=false, owner=false;
  const creator={id:64200,username:"FixtureCreator",displayName:"Fixture Photographer",isCreator:true,
    creatorStatus:"approved",bio:"Fixture motorsport photographer",profileImage:poster,coverImage:poster,
    publicContactEmail:null,websiteUrl:"https://example.invalid/",instagramUrl:null};
  const user=()=>owner?{...creator,email:"private-owner@example.invalid",profileCoverImage:creator.coverImage,emailVerifiedAt:new Date().toISOString()}:
    {id:64201,username:"FixtureViewer",email:"private-viewer@example.invalid",isCreator:false,creatorStatus:"none"};
  const profile=()=>({...creator,following,followerCount:following?1:0});
  browser.listeners.add(event=>{
    if(event.method!=="Fetch.requestPaused")return;
    const {request,requestId}=event.params, path=new URL(request.url).pathname;
    let body=[],status=200;
    if(path==="/api/user")body=user();
    else if(path===`/api/users/${creator.id}`)body=profile();
    else if(path===`/api/creators/${creator.id}/follow`){
      if(failFollow){status=503;body={error:"Fixture follow failure"};failFollow=false;}
      else {following=request.method==="PUT";body={following,followerCount:following?1:0};}
    }
    else if(path==="/api/account/following")body={items:following?[profile()]:[],hasMore:false};
    else if(path==="/api/account/profile"){
      const data=JSON.parse(request.postData);writes.push(data);Object.assign(creator,data);body=user();
    }
    else if(path==="/api/account/downloads" || path==="/api/account/favorites")body={items:[],hasMore:false};
    else if(path==="/api/media/policy")body={community:true,imageBytes:5000000,videoBytes:0,maxPixels:40000000};
    browser.command("Fetch.fulfillRequest",{requestId,responseCode:status,responseHeaders:[{name:"Content-Type",value:"application/json"}],
      body:Buffer.from(JSON.stringify(body)).toString("base64")}).catch(error=>{
        if(!String(error).includes("Invalid InterceptionId"))mockErrors.push(String(error));
      });
  });
  await browser.command("Fetch.enable",{patterns:[{urlPattern:"*/api/*",requestStage:"Request"}]});
  const click=async text=>browser.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled&&!b.closest('nav[aria-label="Account sections"]'));if(!b)throw Error('Missing active button '+${JSON.stringify(text)});b.click();})()`);
  const readyButton=text=>`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled&&!b.closest('nav[aria-label="Account sections"]'))`;
  const visit=async(path,ready)=>{await browser.command("Page.navigate",{url:new URL(path,base).href});await browser.wait(ready);};
  const pick=async(id,bytes,type="image/jpeg")=>browser.evaluate(`(()=>{
    const raw=atob(${JSON.stringify(bytes.toString("base64"))}), data=Uint8Array.from(raw,c=>c.charCodeAt(0));
    const transfer=new DataTransfer();transfer.items.add(new File([data],"fixture.jpg",{type:${JSON.stringify(type)}}));
    const input=document.getElementById(${JSON.stringify(id)});input.files=transfer.files;input.dispatchEvent(new Event("change",{bubbles:true}));
  })()`);
  try{
    for(const width of [1280,390]){
      following=false;owner=false;
      creator.profileImage=poster;creator.coverImage=poster;
      await browser.command("Emulation.setDeviceMetricsOverride",{width,height:850,deviceScaleFactor:1,mobile:width<500});
      await visit(`/creator/${creator.id}`,readyButton("Follow"));
      assert.ok(await browser.evaluate(`document.querySelector('h1').textContent.includes('Fixture Photographer')`));
      assert.equal(await browser.evaluate(`document.body.innerText.includes('private-owner@example.invalid')`),false);
      assert.ok(await browser.evaluate(`!!document.querySelector('img[src=${JSON.stringify(poster)}]')`));
      failFollow=true;await click("Follow");await browser.wait(`document.body.innerText.includes('Fixture follow failure')`);
      assert.equal(following,false);
      await click("Follow");await browser.wait(readyButton("Following"));
      await browser.wait(`document.body.innerText.includes('1 followers')`);
      await visit("/account?tab=following",`document.body.innerText.includes('Fixture Photographer')`);
      if(width<500){
        await browser.evaluate(`document.querySelector('button[aria-label="Preview Fixture Photographer\\'s creator profile"]').click()`);
        await browser.wait(`!!document.querySelector('[role=dialog]')`);
      }else{
        const bounds=await browser.evaluate(`(()=>{const a=[...document.querySelectorAll('a[href="/creator/${creator.id}"]')].find(a=>a.textContent.includes('Fixture Photographer')&&a.getBoundingClientRect().width>0);const r=a.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        await browser.command("Input.dispatchMouseEvent",{type:"mouseMoved",...bounds,button:"none"});
        await browser.wait(`[...document.querySelectorAll('a')].some(a=>a.textContent.trim()==='View profile')`);
      }
      await browser.wait(readyButton("Following")); await click("Following");
      await browser.wait(`!document.body.innerText.includes('Fixture Photographer')`);
      assert.equal(following,false);
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth+1`));
      owner=true;
      await visit("/account?tab=settings",`!!document.querySelector('#profile-display-name')`);
      assert.equal(await browser.evaluate(`document.querySelector('#profile-public-email').value`),"");
      assert.equal(await browser.evaluate(`document.querySelector('img[alt="Creator cover preview"]').getAttribute('src')`),poster);
      await browser.evaluate(`(()=>{const set=(id,value)=>{const e=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));};set('profile-display-name','Edited Photographer');set('profile-public-email','public@example.invalid');})()`);
      await click("Save profile");await browser.wait(`document.body.innerText.includes('Your profile was updated') && ${readyButton("Save profile")}`);
      assert.equal(writes.at(-1).publicContactEmail,"public@example.invalid");
      assert.equal(writes.at(-1).displayName,"Edited Photographer");
      assert.equal("coverImage" in writes.at(-1),false);
      assert.ok(await browser.evaluate(`!!document.querySelector('img[alt="Creator cover preview"]')`));
      const hints=await browser.evaluate(`document.querySelector('[aria-labelledby="profile-settings-heading"]').innerText`);
      assert.equal((hints.match(/3 MB per image/g)||[]).length,2);
      assert.equal(/1 MB|1.4 MB/.test(hints),false);
      // Sources above the old limit are selectable for each asset and sent together.
      for(const input of ["profile-image","profile-cover"]){
        await pick(input,source);
        const alt=input==="profile-image"?"Profile photo preview":"Creator cover preview";
        await browser.wait(`document.querySelector('img[alt="${alt}"]').getAttribute('src')?.length===2000023`);
      }
      await click("Save profile");await browser.wait(`document.body.innerText.includes('Your profile was updated') && ${readyButton("Save profile")}`);
      assert.equal(Buffer.from(writes.at(-1).profileImage.split(",")[1],"base64").length,1_500_000);
      assert.equal(Buffer.from(writes.at(-1).coverImage.split(",")[1],"base64").length,1_500_000);
      for(const input of ["profile-image","profile-cover"]){
        const alt=input==="profile-image"?"Profile photo preview":"Creator cover preview";
        await pick(input,maximum);
        await browser.wait(`document.querySelector('img[alt="${alt}"]').getAttribute('src')?.length===4000023`);
        const selected=await browser.evaluate(`document.querySelector('img[alt="${alt}"]').getAttribute('src')`);
        await pick(input,oversized);
        await browser.wait(`document.querySelector('[role="alert"]')?.textContent.includes('3 MB')`);
        assert.equal(await browser.evaluate(`document.getElementById("${input}").value`),"");
        assert.equal(await browser.evaluate(`document.querySelector('img[alt="${alt}"]').getAttribute('src')`),selected);
      }
      const count=writes.length;
      await click("Save profile");await browser.wait(`document.body.innerText.includes('Your profile was updated') && ${readyButton("Save profile")}`);
      assert.equal(writes.length,count+1);
      assert.equal(Buffer.from(writes.at(-1).profileImage.split(",")[1],"base64").length,3_000_000);
      assert.equal(Buffer.from(writes.at(-1).coverImage.split(",")[1],"base64").length,3_000_000);
      creator.displayName="Fixture Photographer";creator.publicContactEmail=null;
    }
    assert.deepEqual(mockErrors,[]);assert.deepEqual(browser.errors,[]);
  }finally{await browser.close();}
});
