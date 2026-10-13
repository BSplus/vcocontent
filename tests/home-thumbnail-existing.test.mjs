// Run existing DB/browser integrations against this process's disposable DB,
// never against an already-running preview or any connected database.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
assert.ok(process.env.VCO_TEST_PG_PROXY,"Use scripts/test-image-downloads.mjs");
process.env.SESSION_SECRET=`synthetic-${randomUUID()}`;
const {storage}=await import("../server/storage.ts");
const {pool}=await import("../server/db.ts");
const {registerRequestParsers}=await import("../server/request-parsers.ts");
const {setupAuth}=await import("../server/auth.ts");
const {registerRoutes}=await import("../server/routes.ts");
const app=express();registerRequestParsers(app);
app.use(session({secret:process.env.SESSION_SECRET,resave:false,saveUninitialized:false,store:storage.sessionStore}));
setupAuth(app);
const server=await registerRoutes(app,{workers:false});
app.use(express.static("dist/public"));
app.get("*",(_req,res)=>res.sendFile(`${process.cwd()}/dist/public/index.html`));
server.listen(0,"127.0.0.1");await once(server,"listening");
process.env.TEST_BASE_URL=`http://127.0.0.1:${server.address().port}`;
await import("./media-legacy.test.mjs");
await import("./top-shots.test.mjs");
await import("./home-thumbnail-ui.test.mjs");
test.after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  storage.sessionStore.close();await pool.end();
});
