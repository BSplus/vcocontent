import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { uiBrowser } from "./helpers/ui-browser.mjs";

test("admin replaces PNG, sends only editable fields, retains errors and reloads saved logo", {timeout:90000}, async () => {
  const browser = await uiBrowser();
  const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const user = {id:64980,username:"Synthetic series admin",isAdmin:true,isCreator:false};
  const oldLogo = "data:image/png;base64," + (await sharp({create:{width:16,height:16,channels:4,background:"#ee3300"}}).png().toBuffer()).toString("base64");
  let record = {id:64981,name:"Synthetic official fixture",logo:oldLogo,description:null,creatorId:null,createdAt:"2026-10-11T00:00:00.000Z"};
  const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const writes = [], failures = [];
  let rejectUpdate = true;
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const {requestId,request} = message.params;
    const path = new URL(request.url).pathname;
    let body = [], status = 200;
    if (path === "/api/user") body = user;
    else if (path === "/api/series") body = [record];
    else if (path === `/api/series/${record.id}` && request.method === "PUT") {
      const changes = JSON.parse(request.postData);
      writes.push(changes);
      if (rejectUpdate) {
        status = 400; body = {error:"Please enter a valid, non-empty series name."};
      } else {record={...record,...changes};body=record;}
    } else if (path === "/api/admin/safety") body = {events:[],media:[]};
    else if (path === "/api/admin/media-usage") body = {total:{bytes:"0",count:"0",legacy:"0"},byEvent:[],byCreator:[],cleanupCount:"0",policy:{},warningFraction:0.8};
    browser.command("Fetch.fulfillRequest",{requestId,responseCode:status,
      responseHeaders:[{name:"Content-Type",value:"application/json"}],
      body:Buffer.from(JSON.stringify(body)).toString("base64"),
    }).catch(error => failures.push(String(error)));
  });
  const openSeries = async () => {
    await browser.wait(`[...document.querySelectorAll('[role="tab"]')].some(el=>el.textContent==='Race Series')`);
    await browser.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(el=>el.textContent==='Race Series').focus()`);
    await browser.command("Input.dispatchKeyEvent",{type:"keyDown",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
    await browser.command("Input.dispatchKeyEvent",{type:"keyUp",key:"Enter",code:"Enter",windowsVirtualKeyCode:13});
    await browser.wait(`!!document.querySelector('button[aria-label="Edit series Synthetic official fixture"]')`);
  };
  const setValue = async (selector,value) => {
    await browser.evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  };
  try {
    await browser.command("Fetch.enable",{patterns:[{urlPattern:"*/api/*",requestStage:"Request"}]});
    await browser.command("Page.navigate",{url:new URL("/admin/dashboard",base).href});
    await openSeries();
    await browser.evaluate(`document.querySelector('button[aria-label="Edit series Synthetic official fixture"]').click()`);
    await browser.wait(`!!document.querySelector('input[aria-label="Series logo"]')`);
    await browser.evaluate(`(() => {
      const raw=atob(${JSON.stringify(logo.split(",")[1])});
      const file=new File([Uint8Array.from(raw,c=>c.charCodeAt(0))],'fixture.png',{type:'image/png'});
      const transfer=new DataTransfer();transfer.items.add(file);
      const el=document.querySelector('input[aria-label="Series logo"]');el.files=transfer.files;
      el.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await browser.wait(`document.querySelector('img[alt="Logo preview"]')?.src === ${JSON.stringify(logo)}`);
    // Shared client validation catches excessive descriptions before a request.
    await setValue("textarea","x".repeat(1001));
    await browser.evaluate(`document.querySelector('form button[type="submit"]').click()`);
    await browser.wait(`document.querySelector('form [role="alert"]')?.textContent.includes('1000')`);
    assert.equal(writes.length,0);
    await setValue("textarea","");
    await browser.evaluate(`document.querySelector('form button[type="submit"]').click()`);
    await browser.wait(`document.querySelector('form [role="alert"]')?.textContent.includes('non-empty series name')`);
    assert.equal(writes.length,1,"Validation responses are not retried");
    assert.equal(await browser.evaluate(`!!document.querySelector('input[aria-label="Series name"]')`),true);
    assert.deepEqual(writes[0],{name:record.name,logo,description:""});
    rejectUpdate=false;
    await browser.wait(`!document.querySelector('form button[type="submit"]').disabled`);
    await browser.evaluate(`document.querySelector('form button[type="submit"]').click()`);
    await browser.wait(`!document.querySelector('input[aria-label="Series name"]')`);
    await browser.wait(`document.querySelector('img[alt="Synthetic official fixture"]')?.src === ${JSON.stringify(logo)}`);
    assert.equal(record.creatorId,null);assert.equal(record.createdAt,"2026-10-11T00:00:00.000Z");
    await browser.command("Page.reload");
    await openSeries();
    await browser.wait(`document.querySelector('img[alt="Synthetic official fixture"]')?.src === ${JSON.stringify(logo)}`);
    assert.equal(await browser.evaluate(`document.querySelector('img[alt="Synthetic official fixture"]').naturalWidth > 0`),true);
    assert.deepEqual(failures,[]);assert.deepEqual(browser.errors,[]);
  } finally {await browser.close();}
});
