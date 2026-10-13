import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createEventRequest, EventCreateError } from "../client/src/lib/event-create.ts";
import { eventCreationError } from "../server/event-creation-error.ts";
import { insertEventSchema } from "../shared/schema.ts";
import { MediaLimitError } from "../server/media-policy.ts";
import express from "express";
import { once } from "node:events";

test.after(async () => {
  const { storage } = await import("../server/storage.ts");
  const { pool } = await import("../server/db.ts");
  storage.sessionStore.close();
  await pool.end();
});

test("creation validation identifies required fields and date, without raw storage errors", () => {
  const validation = insertEventSchema.safeParse({ title: "", description: "", date: "not-a-date" });
  assert.equal(validation.success, false);
  const result = eventCreationError(validation.error);
  assert.equal(result.status, 400);
  assert.match(result.message, /Title: Title is required/);
  assert.match(result.message, /Description: Description is required/);
  assert.match(result.message, /Date: Choose a valid date/);
  assert.equal(eventCreationError(new MediaLimitError("Gallery limit reached.")).message, "Gallery limit reached.");
  const internal = eventCreationError(new Error("SENSITIVE DATABASE QUERY"));
  assert.equal(internal.status, 503);
  assert.ok(!internal.message.includes("SENSITIVE"));
  assert.match(internal.message, /Check your event list/);
  assert.equal(eventCreationError(new z.ZodError([])).status, 400);
});

test("creation uses one attempt and distinguishes rejected and uncertain responses", async () => {
  const original = globalThis.fetch;
  try {
    for (const [reply, outcome, message] of [
      [() => Response.json({error:"Gallery limit reached."},{status:400}),"rejected",/Gallery limit/],
      [() => new Response("Unauthorized",{status:401}),"rejected",/Sign in again/],
      [() => new Response("Forbidden",{status:403}),"rejected",/account cannot create/],
      [() => Response.json({error:"Internal error"},{status:503}),"unknown",/did not confirm/],
      [() => new Response("{broken"),"unknown",/did not confirm/],
      [() => Response.json({id:null}),"unknown",/did not confirm/],
      [() => { throw new TypeError("Network unavailable"); },"unknown",/may already exist/],
    ]) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return reply(); };
      await assert.rejects(createEventRequest("/api/events", {title:"Fixture"}), error =>
        error instanceof EventCreateError && error.status === outcome && message.test(error.message));
      assert.equal(calls, 1);
    }
    globalThis.fetch = async () => Response.json({id:95831,title:"Fixture"},{status:201});
    assert.equal((await createEventRequest("/api/events", {})).id, 95831);
  } finally { globalThis.fetch = original; }
});

test("creation routes explain validation and acknowledge committed Creator events after read/review outages", async () => {
  const { storage } = await import("../server/storage.ts");
  const { db } = await import("../server/db.ts");
  const { registerRoutes } = await import("../server/routes.ts");
  const original = {create:storage.createEvent,get:storage.getEvent,execute:db.execute};
  let creates = 0;
  storage.createEvent = async details => {
    creates++;
    return {...details,id:95831,safetyStatus:"error",visibility:"draft"};
  };
  storage.getEvent = async () => {throw new Error("Synthetic post-commit read outage");};
  db.execute = async () => {throw new Error("Synthetic review outage");};
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{
    req.user={id:99999,isAdmin:true,emailVerifiedAt:new Date()};
    req.isAuthenticated=()=>true;next();
  });
  const server = await registerRoutes(app,{workers:false});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = (endpoint,body) => fetch(url+endpoint,{method:"POST",
    headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  try {
    for (const endpoint of ["/api/events","/api/creator/events"]) {
      const rejected = await call(endpoint,{title:"",description:"",date:"invalid"});
      assert.equal(rejected.status,400);
      assert.match((await rejected.json()).error,/Title:.*Description:.*Date:/);
    }
    assert.equal(creates,0);
    const created = await call("/api/creator/events",{title:"Fixture",description:"Fixture",date:"2026-10-13"});
    assert.equal(created.status,201);
    const record = await created.json();
    assert.equal(record.id,95831);assert.equal(record.safetyCheckStatus,"unavailable");
    assert.equal(record.visibility,"draft");assert.equal(creates,1);
  } finally {
    storage.createEvent=original.create;storage.getEvent=original.get;db.execute=original.execute;
    await new Promise(resolve=>server.close(resolve));
  }
});
