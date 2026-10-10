import test from "node:test";
import assert from "node:assert/strict";
import { uiBrowser, delay } from "./helpers/ui-browser.mjs";

test("image/video editors preserve removed tags and refresh completed identification on desktop/touch", { timeout: 120000 }, async () => {
  const browser = await uiBrowser();
  const base = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const user = { id: 64901, username: "Fixture creator", isCreator: true, isAdmin: false, creatorStatus: "approved" };
  const event = { id: 64902, creatorId: user.id, title: "Fixture tag roundtrip", description: "No real data",
    date: "2026-07-12T00:00:00Z", createdAt: "2026-07-12T00:00:00Z", isPremium: false };
  const thumbnail = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#173142"/></svg>');
  let media, generation, pendingReads, writes;
  const failures = [];
  browser.listeners.add(message => {
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const path = new URL(request.url).pathname;
    let body = [];
    if (path === "/api/user") body = user;
    else if (path === "/api/events" || path === "/api/creator/events") body = [event];
    else if (path === `/api/events/${event.id}`) body = event;
    else if (path === "/api/media" || path === `/api/events/${event.id}/media`) body = [media];
    else if (path === `/api/media/${media.id}` && request.method === "PUT") {
      const changes = JSON.parse(request.postData);
      writes.push(changes);
      media = { ...media, ...changes }; body = media;
    } else if (path.endsWith("/analyze")) {
      assert.equal(JSON.parse(request.postData).reanalyse, true);
      generation++; pendingReads = 1;
      body = { status: "queued", generation };
    } else if (path.endsWith("/analysis")) {
      const pending = pendingReads > 0;
      if (pending) pendingReads--;
      else if (generation > 1) media = { ...media, tags: ["manual", "Race Car"], identification: [{
        number: "89", team: "Matched Team", drivers: "Registered lineup", vehicle: "", manufacturer: "",
        racingClass: "", discipline: "", source: "reference",
      }] };
      body = { status: pending ? "running" : "completed", generation,
        generatedTags: generation === 1 ? ["Day"] : ["Day", "Race Car"],
        tags: media.tags, identification: media.identification, identificationManual: false };
    }
    browser.command("Fetch.fulfillRequest", { requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64"),
    }).catch(error => failures.push(String(error)));
  });
  await browser.command("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
  const click = async (selector, touch) => {
    const point = await browser.evaluate(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'});
      const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};
    })()`);
    if (touch) {
      await browser.command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await browser.command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await browser.command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await browser.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    }
  };
  try {
    for (const [width, type] of [[1280, "image"], [390, "image"], [1280, "video"], [390, "video"]]) {
      const touch = width === 390;
      media = { id: 64903, eventId: event.id, type, thumbnail, url: thumbnail,
        caption: "Fixture tag photo", photographer: "", createdAt: "2026-07-12T00:00:00Z",
        tags: ["manual", "Day"], identification: [], isPremium: false };
      generation = 1; pendingReads = 0; writes = [];
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: touch });
      await browser.command("Emulation.setTouchEmulationEnabled", { enabled: touch });
      await browser.command("Page.navigate", { url: new URL("/creator/dashboard", base).href });
      await browser.wait(`!!document.querySelector('[role="tab"]')`);
      await browser.evaluate(`document.querySelectorAll('[role="tab"]')[1].focus()`);
      await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await browser.wait(`!!document.querySelector('select')`);
      await browser.evaluate(`document.querySelector('select').value='${event.id}'; document.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}))`);
      const edit = 'button[aria-label="Edit media: Fixture tag photo"]';
      await browser.wait(`!!document.querySelector(${JSON.stringify(edit)})`);
      await click(edit, touch);
      await browser.wait(`document.querySelector('#tags')?.value.includes('Day')`);
      await click("#tags", touch);
      await browser.command("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
      await browser.command("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
      await browser.command("Input.insertText", { text: "manual" });
      await click('[role="dialog"] button[type="submit"]', touch);
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      assert.deepEqual(writes[0].tags, ["manual"]);
      await delay(150); // Allow the media-query refresh before reopening.
      await click(edit, touch);
      await browser.wait(`document.querySelector('#tags')?.value === 'manual'`);
      await browser.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent.includes('Reanalyse')).setAttribute('data-test-reanalyse','true')`);
      await click('[data-test-reanalyse="true"]', touch);
      await browser.wait(`document.querySelector('#tags')?.value.includes('Race Car')`);
      await browser.wait(`document.querySelector('[role="dialog"]')?.innerText.includes('Matched Team') ||
        [...document.querySelectorAll('[role="dialog"] input')].some(input=>input.value==='Matched Team')`);
      assert.equal(await browser.evaluate(`document.querySelector('#tags').value.includes('Day')`), false);
      await click('[role="dialog"] button[type="submit"]', touch);
      await browser.wait(`!document.querySelector('[role="dialog"]')`);
      // Unedited tags may be omitted to avoid overwriting concurrent server changes.
      assert.deepEqual(writes[1].tags ?? media.tags, ["manual", "Race Car"]);
      assert.equal(media.tags.includes("Day"), false);
    }
    assert.deepEqual(failures, []); assert.deepEqual(browser.errors, []);
  } finally { await browser.close(); }
});
