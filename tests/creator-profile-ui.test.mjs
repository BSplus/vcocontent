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
  let profileFailure;
  const creator={id:64200,username:"FixtureCreator",displayName:"Fixture Photographer",isCreator:true,
    creatorStatus:"approved",bio:"Fixture motorsport photographer",profileImage:poster,coverImage:poster,
    publicContactEmail:null,websiteUrl:"https://example.invalid/",instagramUrl:null};
  const viewer={id:64201,username:"FixtureViewer",email:"private-viewer@example.invalid",isCreator:false,creatorStatus:"none",bio:""};
  const user=()=>owner?{...creator,email:"private-owner@example.invalid",profileCoverImage:creator.coverImage,emailVerifiedAt:new Date().toISOString()}:viewer;
  const profile=()=>({...creator,following,followerCount:following?1:0});
  browser.listeners.add(event=>{
    if(event.method!=="Fetch.requestPaused")return;
    const {request,requestId}=event.params, path=new URL(request.url).pathname;
    let body=[],status=200,raw=false;
    if(path==="/api/user")body=user();
    else if(path===`/api/users/${creator.id}`)body=profile();
    else if(path===`/api/creators/${creator.id}/follow`){
      if(failFollow){status=503;body={error:"Fixture follow failure"};failFollow=false;}
      else {following=request.method==="PUT";body={following,followerCount:following?1:0};}
    }
    else if(path==="/api/account/following")body={items:following?[profile()]:[],hasMore:false};
    else if(path==="/api/account/profile"){
      const data=JSON.parse(request.postData);writes.push(data);
      if(profileFailure) { status=profileFailure.status;body=profileFailure.body;raw=!!profileFailure.raw;profileFailure=undefined; }
      else { Object.assign(owner?creator:viewer,data);body=user(); }
    }
    else if(path==="/api/account/downloads" || path==="/api/account/favorites")body={items:[],hasMore:false};
    else if(path==="/api/media/policy")body={community:true,imageBytes:5000000,videoBytes:0,maxPixels:40000000};
    browser.command("Fetch.fulfillRequest",{requestId,responseCode:status,responseHeaders:[{name:"Content-Type",value:raw?"text/html":"application/json"}],
      body:Buffer.from(raw?body:JSON.stringify(body)).toString("base64")}).catch(error=>{
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
  const setField=async(id,value)=>browser.evaluate(`(()=>{
    const e=document.getElementById(${JSON.stringify(id)});
    Object.getOwnPropertyDescriptor(e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});
    e.dispatchEvent(new Event('input',{bubbles:true}));
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
      const success = await browser.evaluate(`document.querySelector('[role="status"]').textContent`);
      assert.match(success, /automatic safety check passed/);
      assert.match(success, /public changes are visible now/);
      assert.match(success, /No administrator approval is required/);
      assert.doesNotMatch(success, /moderation review|pending/i);
      assert.ok(await browser.evaluate(`document.body.innerText.includes('changes are saved immediately')`));
      await visit(`/creator/${creator.id}`,`document.querySelector('h1')?.textContent.includes('Edited Photographer')`);
      assert.ok(await browser.evaluate(`document.body.innerText.includes('public@example.invalid')`));
      assert.equal(await browser.evaluate(`document.body.innerText.includes('private-owner@example.invalid')`),false);
      await visit("/account?tab=settings",`document.querySelector('#profile-display-name')?.value==='Edited Photographer'`);
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
      // Several local errors appear at once, with accessible links and first-error focus.
      const start=writes.length;
      await setField("profile-username","x");
      await setField("profile-public-email","invalid");
      await setField("profile-website","ftp://example.invalid");
      await setField("profile-instagram","https://wrong.invalid/person");
      await click("Save profile");
      await browser.wait(`document.querySelectorAll('[aria-invalid="true"]').length===4 && document.activeElement.id==='profile-username'`);
      assert.equal(writes.length,start);
      assert.ok(await browser.evaluate(`[...document.querySelectorAll('[aria-invalid="true"]')].every(e=>!!document.getElementById(e.getAttribute('aria-describedby')))`));
      await setField("profile-public-email","still-invalid");
      assert.equal(await browser.evaluate(`document.querySelectorAll('[aria-invalid="true"]').length`),4);
      await setField("profile-username","CorrectedUsername");
      await browser.wait(`document.querySelectorAll('[aria-invalid="true"]').length===3`);
      await setField("profile-public-email","public@example.invalid");
      await setField("profile-website","http://example.invalid");
      await setField("profile-instagram","http://www.instagram.com/fixture");
      // A server-confirmed conflict leaves all text and both selected previews unchanged.
      const beforeImages=await browser.evaluate(`[...document.querySelectorAll('img[alt$="preview"]')].map(e=>e.getAttribute('src'))`);
      profileFailure={status:409,body:{code:"username_taken",error:"private SQL",fieldErrors:{username:"This username is already taken. Choose another username."}}};
      await click("Save profile");
      await browser.wait(`document.querySelector('#profile-username').getAttribute('aria-invalid')==='true' && document.activeElement.id==='profile-username' && ${readyButton("Save profile")}`);
      assert.equal(await browser.evaluate(`document.querySelector('#profile-username').value`),"CorrectedUsername");
      assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('img[alt$="preview"]')].map(e=>e.getAttribute('src'))`),beforeImages);
      assert.equal(await browser.evaluate(`document.body.innerText.includes('private SQL')`),false);
      await setField("profile-username","AnotherUsername");
      await browser.wait(`document.querySelector('[role="alert"]')?.textContent.includes('Your corrections are ready')`);
      assert.equal(await browser.evaluate(`document.querySelector('[role="alert"]').textContent.includes('already taken')`),false);
      await click("Save profile");
      await browser.wait(`document.body.innerText.includes('Your profile was updated') && ${readyButton("Save profile")}`);
      // Every global cause supplies its own action, without losing entered text.
      for(const [status,code,part] of [
        [409,"storage_full","Remove unused files"],
        [503,"storage_unknown","administrator check"],
        [503,"storage_cleanup","Wait a little"],
        [503,"safety_unavailable","Try saving again later"],
        [400,"safety_uncertain","No policy violation"],
        [400,"safety_blocked","Review them against"],
        [401,"authentication","Sign in again"],
        [403,"permission","Contact an administrator"],
        [429,"rate_limit","Wait up to an hour"],
        [500,"server","Try again later"],
      ]) {
        await setField("profile-bio",`Retained ${code}`);
        profileFailure={status,body:{code,error:"private provider payload"}};
        await click("Save profile");
        await browser.wait(`document.querySelector('[role="alert"]')?.textContent.includes(${JSON.stringify(part)}) && ${readyButton("Save profile")}`);
        assert.equal(await browser.evaluate(`document.querySelector('#profile-bio').value`),`Retained ${code}`);
        assert.equal(await browser.evaluate(`document.querySelectorAll('[aria-invalid="true"]').length`),0);
        assert.equal(await browser.evaluate(`document.body.innerText.includes('private provider payload')`),false);
        if (code.startsWith("safety_")) {
          const message = await browser.evaluate(`document.querySelector('[role="alert"]').textContent`);
          assert.match(message, /saved profile is unchanged/);
          assert.doesNotMatch(message, /contact an administrator|pending|moderation review/i);
          assert.deepEqual(await browser.evaluate(`[...document.querySelectorAll('img[alt$="preview"]')].map(e=>e.getAttribute('src'))`),beforeImages);
          if (code === "safety_uncertain") {
            assert.match(message, /Adjust your text or choose different images/);
            await setField("profile-bio","Adjusted biography after uncertain check");
            await click("Save profile");
            await browser.wait(`document.querySelector('[role="status"]')?.textContent.includes('public changes are visible now') && ${readyButton("Save profile")}`);
            assert.equal(creator.bio,"Adjusted biography after uncertain check");
          }
        }
      }
      // An unsupported server response is a technical failure, never raw text.
      profileFailure={status:502,body:"<html>private upstream failure</html>",raw:true};
      await click("Save profile");
      await browser.wait(`document.querySelector('[role="alert"]')?.textContent.includes('server could not complete') && ${readyButton("Save profile")}`);
      // Simulate a lost save response; do not promise the profile was unchanged.
      await browser.evaluate(`(()=>{
        const original=window.fetch;
        window.fetch=(url,init)=>{if(url==='/api/account/profile'){window.fetch=original;return Promise.reject(new TypeError('private connection error'));}return original(url,init);};
      })()`);
      await click("Save profile");
      await browser.wait(`document.querySelector('[role="alert"]')?.textContent.includes('changes may already have been saved') && ${readyButton("Save profile")}`);
      await click("Save profile");
      await browser.wait(`document.body.innerText.includes('Your profile was updated') && ${readyButton("Save profile")}`);
      // Cover errors focus the cover action, never the profile-photo action.
      await pick("profile-cover",source);
      await browser.wait(`document.querySelector('img[alt="Creator cover preview"]').getAttribute('src')?.length===2000023`);
      profileFailure={status:400,body:{code:"validation",fieldErrors:{coverImage:"Creator cover image is damaged or could not be read. Export it again or choose another file."}}};
      await click("Save profile");
      await browser.wait(`document.activeElement.id==='profile-cover-action' && ${readyButton("Save profile")}`);
      assert.equal(await browser.evaluate(`document.querySelector('#profile-image-action').getAttribute('aria-invalid')`),"false");
      assert.equal(await browser.evaluate(`document.querySelector('img[alt="Creator cover preview"]').getAttribute('src').length`),2000023);
      await pick("profile-cover",source);
      await browser.wait(`document.querySelector('#profile-cover-action').getAttribute('aria-invalid')==='false'`);
      await click("Save profile");
      await browser.wait(`document.body.innerText.includes('Your profile was updated') && ${readyButton("Save profile")}`);
      assert.ok(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth+1`));
      creator.username="FixtureCreator";
      creator.displayName="Fixture Photographer";creator.publicContactEmail=null;
      owner=false;
      await visit("/account?tab=settings",`!!document.querySelector('#profile-bio')`);
      assert.equal(await browser.evaluate(`!!document.querySelector('#profile-display-name')`),false);
      await setField("profile-bio",`Immediate user edit ${width}`);
      await click("Save profile");
      await browser.wait(`document.querySelector('[role="status"]')?.textContent.includes('public changes are visible now') && ${readyButton("Save profile")}`);
      assert.equal(viewer.bio,`Immediate user edit ${width}`);
      for (const field of ["displayName","coverImage","publicContactEmail","websiteUrl","instagramUrl"])
        assert.equal(field in writes.at(-1),false);
      assert.equal(viewer.isCreator,false);
      assert.equal(viewer.creatorStatus,"none");
      assert.equal(viewer.email,"private-viewer@example.invalid");
      await visit("/account?tab=settings",`document.querySelector('#profile-bio')?.value===${JSON.stringify(`Immediate user edit ${width}`)}`);
    }
    assert.deepEqual(mockErrors,[]);assert.deepEqual(browser.errors,[]);
  }finally{await browser.close();}
});
