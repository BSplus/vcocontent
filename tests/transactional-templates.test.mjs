import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { transactionalEmail } from "../server/email-templates/transactional.ts";
import { uiBrowser } from "./helpers/ui-browser.mjs";

const origin = "https://email-preview.example.test";
const data = {galleryId:42,galleryTitle:'Racing "<script>unsafe</script>" & highlights',
  maxGalleries:5,maxPhotos:1000,storageMb:500,
  resetUrl:`${origin}/auth#reset=${"a".repeat(64)}`,expiryMinutes:37};
const kinds = ["welcome","creator-welcome","gallery-published","password-reset","password-changed","processing-failure"];
const subjects = ["Welcome to VCO Content Database","Welcome to VCO Creator Studio",
  "Your gallery is live | VCO","Reset your password | VCO","Your password has changed | VCO",
  "Action needed for your VCO upload"];
const paths = ["/","/creator/dashboard","/events/42","/auth#reset=","/account","/creator/dashboard"];

test("all six templates preserve branding, exact subjects, real paths and plaintext", () => {
  kinds.forEach((kind,i) => {
    const email = transactionalEmail(origin,kind,data);
    assert.equal(email.subject,subjects[i]);
    assert.ok(email.html.includes(origin+paths[i]));
    assert.ok(email.text.includes(origin+paths[i]));
    assert.match(email.html,/cid:vco-logo/);
    for (const content of [email.html,email.text]) {
      assert.equal((content.match(/Virtual Competition Organisation/g)||[]).length,1);
      assert.match(content,/© Virtual Competition Organisation \(VCO\) GmbH/);
    }
    assert.doesNotMatch(email.html,/<script|onerror=|<iframe|fonts\.google|utm_|tracking/);
    assert.doesNotMatch(email.text,/\[Actual|\[Gallery|\[Password|undefined/);
  });
  const gallery = transactionalEmail(origin,"gallery-published",data);
  assert.ok(gallery.html.includes("&lt;script&gt;unsafe&lt;/script&gt;"));
  assert.ok(gallery.text.includes(data.galleryTitle));
  assert.match(transactionalEmail(origin,"password-reset",data).text,/37 minutes/);
  assert.match(transactionalEmail(origin,"creator-welcome",data).text,/1,000 photos/);
  assert.match(transactionalEmail(origin,"creator-welcome",{...data,maxGalleries:10,maxPhotos:2000,storageMb:1000}).text,
    /10 galleries[\s\S]*2,000 photos[\s\S]*1000 MB/);
  assert.doesNotMatch(transactionalEmail(origin,"creator-welcome").text,/5 galleries|500 MB/);
  assert.doesNotMatch(transactionalEmail(origin,"processing-failure").text,/remain available/);
});

test("prepared account actions reject unsafe origins, redirects and invented expiry", () => {
  for (const site of ["http://example.test","https://user:pass@example.test/","https://example.test/path","https://example.test/?next=x"])
    assert.throws(()=>transactionalEmail(site,"welcome"));
  for (const resetUrl of ["javascript:alert(1)","https://foreign.test/auth","https://u:p@email-preview.example.test/auth"])
    assert.throws(()=>transactionalEmail(origin,"password-reset",{...data,resetUrl}));
  for (const expiryMinutes of [undefined,0,-1,1.5,NaN])
    assert.throws(()=>transactionalEmail(origin,"password-reset",{...data,expiryMinutes}));
  assert.throws(()=>transactionalEmail(origin,"gallery-published",{...data,galleryId:-1}));
});

for (const width of [320,390,1280]) {
  for (const scheme of ["light","dark"]) {
    test(`transactional templates render ${width}px / ${scheme}`,async()=>{
      const browser = await uiBrowser();
      try {
        await browser.command("Page.enable");
        await browser.command("Emulation.setDeviceMetricsOverride",{width,height:1050,deviceScaleFactor:1,mobile:width<500});
        await browser.command("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:scheme}]});
        const logo=(await readFile("attached_assets/VCO_2021_reg_White_Trans.png")).toString("base64");
        await browser.command("Page.navigate",{url:"about:blank"});
        const {frameTree}=await browser.command("Page.getFrameTree");
        for (const kind of kinds) {
          const html=transactionalEmail(origin,kind,{...data,galleryTitle:"x".repeat(200)}).html
            .replaceAll("cid:vco-logo",`data:image/png;base64,${logo}`);
          await browser.command("Page.setDocumentContent",{frameId:frameTree.frame.id,html});
          await browser.wait("document.images.length && [...document.images].every(i=>i.complete && i.naturalWidth>0)");
          const state=await browser.evaluate(`(()=>{
            const button=document.querySelector('a');
            const box=button.getBoundingClientRect();
            return {fits:document.documentElement.scrollWidth<=innerWidth,
              buttonVisible:box.left>=0 && box.right<=innerWidth && box.height>=40,
              headlineSize:parseFloat(getComputedStyle(document.querySelector('h1')).fontSize)};
          })()`);
          assert.equal(state.fits,true,kind);
          assert.equal(state.buttonVisible,true,kind);
          if(width<500)assert.equal(state.headlineSize,29,kind);
          if(width===390 && scheme==="dark" && kind!=="gallery-published") {
            const image=await browser.command("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
            await writeFile(`/tmp/vco-${kind}-mobile.png`,Buffer.from(image.data,"base64"));
          }
        }
      } finally {await browser.close();}
    });
  }
}
