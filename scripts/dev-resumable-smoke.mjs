// Explicitly approved Development-only smoke. Never runs during startup/build.
// State/cookies stay in a private /tmp directory, never in logs or Git.
import assert from "node:assert/strict";
import {randomUUID,randomBytes,createHash,scryptSync} from "node:crypto";
import {mkdir,readFile,writeFile,rm} from "node:fs/promises";
import {Readable} from "node:stream";
import {setTimeout as delay} from "node:timers/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import path from "node:path";
import sharp from "sharp";
import {and,eq,inArray,sql} from "drizzle-orm";
import {assertDevelopmentMediaTarget} from "../server/development-media-target.ts";
import {db,pool} from "../server/db.ts";
import {storage} from "../server/storage.ts";
import {getObjectStore} from "../server/object-store.ts";
import {deleteRoutedMediaObject as deleteMediaObject} from "../server/media-object-routing.ts";
import {users,events,mediaItems,mediaReservations,mediaCleanup,mediaObjectRoutes,
  mediaUploadSessions,betaRateLimits,mediaAnalysisJobs} from "../shared/schema.ts";

assertDevelopmentMediaTarget(); // Includes runtime database fingerprint + exact Development bucket.
const [phase,root,requestedKind="photo"]=process.argv.slice(2);
assert.ok(["photo","video"].includes(requestedKind));
assert.match(root||"",/^\/tmp\/vco-resumable-smoke-[a-f0-9-]{36}$/);
const base=new URL(`https://${process.env.REPLIT_DEV_DOMAIN}`);
assert.ok(base.hostname.endsWith(".replit.dev"),"Development preview required");
const filename=path.join(root,"state.json");
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const caption="Development resumable upload fixture.";
let state;
try{state=JSON.parse(await readFile(filename,"utf8"));}catch(error){if(error.code!=="ENOENT")throw error;}
async function save(){await mkdir(root,{recursive:true,mode:0o700});await writeFile(filename,JSON.stringify(state),{mode:0o600});}
function report(values){console.log(JSON.stringify({phase,...values}));}
async function bytes(){
  if(state?.kind==="video")return readFile(path.join(root,"fixture.mp4"));
  const jpeg=await sharp({create:{width:64,height:32,channels:3,background:"#2676ab"}}).jpeg().toBuffer();
  return Buffer.concat([jpeg,Buffer.alloc(1048576+256-jpeg.length,42)]);
}
async function request(route,{actor=0,method="GET",body,headers={},signal}={}){
  const response=await fetch(new URL(route,base),{method,headers:{
    ...(state?.actors?.[actor]?.cookie?{Cookie:state.actors[actor].cookie}:{}),...headers},
    ...(body===undefined?{}:{body}),signal:signal||AbortSignal.timeout(60000),redirect:"error"});
  return response;
}
async function json(route,options={}){
  const res=await request(route,{...options,headers:{"Content-Type":"application/json",...options.headers},
    ...(options.body===undefined?{}:{body:JSON.stringify(options.body)})});
  const value=await res.json();
  assert.ok(res.ok,`Expected successful ${options.method||"GET"} ${route}; received ${res.status}`);
  return value;
}
const initBody=async()=>({requestKey:state.requestKey,size:(await bytes()).length,mime:state.kind==="video"?"video/mp4":"image/jpeg",
  sha256:digest(await bytes()),metadata:{type:state.kind==="video"?"video":"image",caption,
    photographer:"Development smoke fixture",tags:["Development fixture"],autoTag:false}});
const sessionPath=()=>`/api/upload-sessions/${state.sessionId}`;
async function put(index,partBytes){
  const res=await request(`${sessionPath()}/parts/${index}`,{method:"PUT",body:partBytes,
    headers:{"Content-Type":"application/octet-stream","X-Part-SHA256":digest(partBytes)}});
  assert.equal(res.status,200,"Binary part accepted");return res.json();
}
async function confirmGateClosed(){
  const rejected=await request(`/api/events/${state.eventId}/upload-sessions`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...await initBody(),requestKey:randomUUID()})});
  assert.ok([502,503].includes(rejected.status),"Normal authenticated upload must be blocked");
  if(state.sessionId){
    const stopped=await request(`${sessionPath()}/parts/0`,{method:"PUT",body:Buffer.from([1]),
      headers:{"Content-Type":"application/octet-stream","X-Part-SHA256":digest(Buffer.from([1]))}});
    assert.ok([502,503].includes(stopped.status),"Parts must also respect the closed write gate");
  }
}
function rememberUrl(url){
  if(!url)return;
  const parsed=new URL(url,base);
  assert.equal(parsed.origin,base.origin,"Only this Development app's test objects may be tracked");
  const key=decodeURIComponent(parsed.pathname.split("/").at(-1));
  if(!state.keys.includes(key))state.keys.push(key);
}
async function trackVideoKeys(){
  // Every admitted key belongs to the exact isolated gallery or media record.
  // Never infer ownership from bucket-wide listings, timestamps or UUID patterns.
  const reserved=await db.select().from(mediaReservations).where(eq(mediaReservations.eventId,state.eventId));
  for(const r of reserved)for(const key of [r.storageKey,r.thumbnailKey])
    if(key&&!state.keys.includes(key))state.keys.push(key);
  if(state.mediaId){
    const item=await storage.getMediaItem(state.mediaId);
    if(item){assert.equal(item.eventId,state.eventId);rememberUrl(item.url);rememberUrl(item.thumbnail);state.thumbnail=item.thumbnail;}
  }
  await save();
}

try{
  if(phase==="prepare"){
    assert.ok(!state,"New smoke directory required");
    state={nonce:randomUUID(),kind:requestedKind,requestKey:randomUUID(),actors:[],keys:[],additionalEventIds:[]};
    state.before= (await db.execute(sql`select (select count(*) from users)::int as users,
      (select count(*) from events)::int as events,(select count(*) from media_items)::int as media`)).rows[0];
    await save();
    if(state.kind==="video"){
      await promisify(execFile)("ffmpeg",["-y","-f","lavfi","-i","testsrc2=size=256x144:rate=10",
        "-t","3","-c:v","libx264","-preset","ultrafast","-pix_fmt","yuv420p",
        "-b:v","5M","-minrate","5M","-maxrate","5M","-bufsize","5M",
        "-x264-params","nal-hrd=cbr:force-cfr=1","-movflags","+faststart",path.join(root,"fixture.mp4")],
        {timeout:30000,maxBuffer:65536});
      assert.ok((await bytes()).length>1048576 && (await bytes()).length<=2097152,"Two-part small-video fixture required");
    }
    for(let i=0;i<2;i++){
      const username=`resume-smoke-${state.nonce}-${i}`,password=randomBytes(32).toString("hex");
      const salt=randomBytes(16).toString("hex");
      const hash=`${scryptSync(password,salt,64).toString("hex")}.${salt}`;
      const [actor]=await db.insert(users).values({username,email:`${username}@example.invalid`,password:hash,
        isCreator:true,isAdmin:state.kind==="video" && i===0,creatorStatus:"approved",emailVerifiedAt:new Date()}).returning({id:users.id});
      state.actors.push({id:actor.id,username});await save();
      const login=await request("/api/login",{actor:99,method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({username,password})});
      assert.equal(login.status,200,"Real test-account login succeeds");
      const cookies=login.headers.getSetCookie();
      const cookie=cookies.map(value=>value.split(";")[0]).find(value=>value.startsWith("vco.sid="));
      assert.ok(cookie,"Session cookie required");state.actors[i].cookie=cookie;await save();
      const current=await json("/api/user",{actor:i});
      assert.equal(current.id,actor.id,"Real authenticated session must persist before testing uploads");
    }
    const gallery=await json(state.kind==="video"?"/api/events":"/api/creator/events",{method:"POST",body:{title:`Resumable smoke ${state.nonce}`,
      description:"Temporary private Development verification. Delete after the smoke test.",
      date:new Date().toISOString(),visibility:"draft",...(state.kind==="video"?{adminHidden:true}:{})}});
    state.eventId=gallery.id;await save();
    assert.equal(gallery.creatorId,state.kind==="video"?null:state.actors[0].id);
    if(state.kind!=="video")assert.equal(gallery.visibility,"draft");
    if(state.kind==="video"){
      // Public creation intentionally strips internal visibility fields.
      // Hide only the newly created fixture before admitting any media.
      const [hidden]=await db.update(events).set({adminHidden:true}).where(eq(events.id,state.eventId))
        .returning({adminHidden:events.adminHidden});
      assert.equal(hidden?.adminHidden,true);
      const ownGallery=await json("/api/creator/events",{actor:1,method:"POST",body:{
        title:`Resumable restriction ${state.nonce}`,description:"Temporary Creator restriction fixture.",
        date:new Date().toISOString(),visibility:"draft"}});
      state.additionalEventIds.push(ownGallery.id);await save();
    }
    await confirmGateClosed();
    report({developmentTargetVerified:true,isolatedAccounts:2,privateGallery:true,gateBlockedBefore:true});
  }else if(phase==="stage"){
    if(state.kind==="video"){
      for(const actor of [0,1]){
        const denied=await request(`/api/events/${state.additionalEventIds[0]}/upload-sessions`,{
          actor,method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(await initBody())});
        assert.equal(denied.status,413,"Creator-owned galleries must reject video, including admin actions");
      }
    }
    const session=await json(`/api/events/${state.eventId}/upload-sessions`,{method:"POST",body:await initBody()});
    state.sessionId=session.id;await save();
    assert.equal(session.partBytes,1048576);
    const first=await put(0,(await bytes()).subarray(0,1048576));
    assert.equal(first.received,1);assert.equal(first.uploadedBytes,1048576);
    const last=(await bytes()).subarray(1048576),controller=new AbortController();
    const stream=new Readable({read(){if(!this.started){this.started=true;this.push(last.subarray(0,32));}}});
    const interrupted=fetch(new URL(`${sessionPath()}/parts/1`,base),{method:"PUT",duplex:"half",body:stream,
      headers:{Cookie:state.actors[0].cookie,"Content-Type":"application/octet-stream","X-Part-SHA256":digest(last)},
      signal:controller.signal}).then(()=>false,()=>true);
    await delay(500);controller.abort();stream.destroy();
    assert.equal(await interrupted,true,"Real interrupted request must not be acknowledged");
    const status=await json(sessionPath());assert.equal(status.received,1);
    const rows=await db.select().from(mediaItems).where(eq(mediaItems.eventId,state.eventId));assert.equal(rows.length,0);
    const [reservation]=await db.select().from(mediaReservations).where(eq(mediaReservations.id,state.sessionId));
    assert.ok(reservation);
    state.keys=[reservation.storageKey,reservation.thumbnailKey].filter(Boolean);await save();
    report({acknowledgedParts:1,interruptedPartUnacknowledged:true,reservationRetained:true,mediaCommitted:0,
      ...(state.kind==="video"?{creatorVideoStillBlocked:true}:{})});
  }else if(phase==="resume"){
    const status=await json(sessionPath());
    assert.equal(status.received,1);assert.equal(status.uploadedBytes,1048576);
    assert.equal((await request(sessionPath(),{actor:1})).status,404);
    await put(1,(await bytes()).subarray(1048576));
    const repeated=await put(0,(await bytes()).subarray(0,1048576));assert.equal(repeated.received,2);
    // Track background video-poster reservations while finalization runs.
    let trackingFailure,trackingStopped=false;
    const tracker=state.kind==="video"?(async()=>{
      while(!trackingStopped){try{await trackVideoKeys();}catch(error){trackingFailure=error;}await delay(150);}
    })():Promise.resolve();
    let completed;
    try{completed=await json(`${sessionPath()}/complete`,{method:"POST"});}
    finally{trackingStopped=true;await tracker;}
    if(trackingFailure)throw trackingFailure;
    assert.equal(completed.state,"completed");state.mediaId=completed.mediaId;await save();
    const recovered=await json(`/api/events/${state.eventId}/upload-sessions/by-request/${state.requestKey}`);
    const replay=await json(`${sessionPath()}/complete`,{method:"POST"});
    assert.equal(recovered.mediaId,state.mediaId);assert.equal(replay.mediaId,state.mediaId);
    assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.eventId,state.eventId))).length,1);
    assert.equal(completed.item.caption,caption);
    state.mediaUrl=completed.item.url;state.thumbnail=completed.item.thumbnail;await save();
    if(state.kind==="video"){
      const deadline=Date.now()+90000;
      let settled=false;
      while(Date.now()<deadline){
        await trackVideoKeys();
        const [job]=await db.select().from(mediaAnalysisJobs).where(eq(mediaAnalysisJobs.mediaId,state.mediaId));
        const reservations=await db.select().from(mediaReservations).where(eq(mediaReservations.eventId,state.eventId));
        if(job && job.attempts>=1 && (job.videoEvidence?.posterSourceHash || job.status==="failed") &&
          ["completed","failed","queued"].includes(job.status) && !job.workerToken && !reservations.length){
          state.analysisStatus=job.status;state.analysisAttempts=job.attempts;settled=true;break;
        }
        await delay(300);
      }
      assert.ok(settled,"Wait for an idle analysis attempt before restarting or deleting test video");
      await trackVideoKeys();await save();
    }
    report({resumedAfterApplicationRestart:true,acceptedPartReplaySafe:true,singleCommittedMedia:true,
      completionReplaySafe:true,creatorCaptionPreserved:true});
  }else if(phase==="verify-closed"){
    await confirmGateClosed();
    const status=await json(sessionPath());assert.equal(status.state,"completed");
    const source=await request(state.mediaUrl);assert.equal(source.status,200);
    assert.equal(digest(Buffer.from(await source.arrayBuffer())),digest(await bytes()));
    assert.equal((await request(state.thumbnail)).status,200);
    for(const actor of [1,99]){
      const denied=await request(state.mediaUrl,{actor});
      assert.ok([401,403,404].includes(denied.status),"Private source denied to outsider/anonymous");
    }
    const r2=getObjectStore("r2");
    const key=decodeURIComponent(new URL(state.mediaUrl,base).pathname.split("/").at(-1));
    const meta=await r2.metadata(key);assert.equal(meta.size,(await bytes()).length);
    const hash=createHash("sha256");for await(const chunk of r2.open(key))hash.update(chunk);
    assert.equal(hash.digest("hex"),digest(await bytes()));
    const routes=await db.select().from(mediaObjectRoutes).where(inArray(mediaObjectRoutes.key,state.keys));
    const currentKeys=[key,decodeURIComponent(new URL(state.thumbnail,base).pathname.split("/").at(-1))];
    assert.equal(routes.filter(r=>currentKeys.includes(r.key)).length,2);
    assert.ok(routes.filter(r=>currentKeys.includes(r.key)).every(r=>r.provider==="r2"&&r.state==="verified"));
    assert.ok(routes.every(r=>r.provider==="r2"&&["verified","deleted"].includes(r.state)));
    assert.equal(routes.find(r=>r.key===key).sha256,digest(await bytes()));
    if(state.kind!=="video"){
      const usage=await json("/api/creator/usage");assert.equal(usage.photos,1);assert.ok(usage.bytes>=(await bytes()).length);
    }else{
      const range=await request(state.mediaUrl,{headers:{Range:"bytes=0-63"}});
      assert.equal(range.status,206);assert.equal(range.headers.get("content-range"),`bytes 0-63/${(await bytes()).length}`);
      assert.deepEqual(Buffer.from(await range.arrayBuffer()),(await bytes()).subarray(0,64));
      const invalid=await request(state.mediaUrl,{headers:{Range:`bytes=${(await bytes()).length+10}-`}});
      assert.equal(invalid.status,416);
      const [item]=await db.select().from(mediaItems).where(eq(mediaItems.id,state.mediaId));
      assert.ok(item.storedBytes>=(await bytes()).length);
      const usage=await json("/api/creator/usage",{actor:1});assert.equal(usage.photos,0);assert.equal(usage.bytes,0);
      const {uiBrowser}=await import("../tests/helpers/ui-browser.mjs");
      const browser=await uiBrowser();
      try{
        await browser.command("Network.enable");
        const cookie=state.actors[0].cookie.slice("vco.sid=".length);
        await browser.command("Network.setCookie",{name:"vco.sid",value:cookie,url:base.origin,secure:true,httpOnly:true});
        await browser.command("Page.navigate",{url:base.origin+"/"});
        await browser.wait("document.readyState==='complete'");
        await browser.evaluate(`(()=>{const v=document.createElement('video');v.id='smoke-video';v.controls=true;
          v.muted=true;v.src=${JSON.stringify(state.mediaUrl)};v.poster=${JSON.stringify(state.thumbnail)};
          v.style.cssText='position:fixed;inset:80px;width:640px;max-width:85vw;z-index:99999';
          document.body.append(v);})()`);
        await browser.evaluate(`Promise.race([document.getElementById('smoke-video').play(),
          new Promise((_,reject)=>setTimeout(()=>reject(new Error('Native video play deadline')),10000))])`);
        await browser.wait("document.getElementById('smoke-video').currentTime>0.3");
        const decoded=await browser.evaluate("document.getElementById('smoke-video').getVideoPlaybackQuality().totalVideoFrames");
        assert.ok(decoded>0);
        await browser.evaluate("(()=>{const v=document.getElementById('smoke-video');v.pause();v.currentTime=1.5;})()");
        await browser.wait("!document.getElementById('smoke-video').seeking && document.getElementById('smoke-video').currentTime>=1.5");
        await browser.evaluate("document.getElementById('smoke-video').play()");
        await browser.wait("document.getElementById('smoke-video').currentTime>1.8");
        assert.equal(await browser.evaluate("document.getElementById('smoke-video').error===null"),true);
        state.nativePlayback=true;await save();
      }finally{await browser.close();}
    }
    state.verified=true;await save();
    report({gateBlockedAfter:true,privateR2Read:true,sha256Integrity:true,protectedDelivery:true,
      ownerPreview:true,outsiderDenied:true,anonymousDenied:true,r2RoutesVerified:2,quotaAccounted:true,
      ...(state.kind==="video"?{nativePlayback:true,seeking:true,httpRange206:true,invalidRange416:true,
        creatorVideoStillBlocked:true,analysisStatus:state.analysisStatus,trackedTestKeys:state.keys.length}:{})});
  }else if(phase==="cleanup"){
    if(!state){report({noState:true});}
    else{
      // Recover narrowly scoped fixtures even when a setup response was lost.
      const own=await db.select().from(users).where(inArray(users.username,[0,1].map(i=>`resume-smoke-${state.nonce}-${i}`)));
      const ids=own.map(a=>a.id);
      if(ids.length){
        const galleries=await db.select().from(events).where(sql`(${events.title}=${`Resumable smoke ${state.nonce}`}
          and (${events.creatorId} in (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}) or
            (${state.kind==="video"} and ${events.creatorId} is null and ${events.id}=${state.eventId||0})))
          or (${events.title}=${`Resumable restriction ${state.nonce}`} and ${events.creatorId} in (${sql.join(ids.map(id=>sql`${id}`),sql`,`)}))`);
        if(state.kind==="video" && state.eventId)await trackVideoKeys();
        const pending=await db.select().from(mediaUploadSessions).where(inArray(mediaUploadSessions.actorId,ids));
        for(const session of pending){
          const reservation=await db.select().from(mediaReservations).where(eq(mediaReservations.id,session.id));
          for(const r of reservation)state.keys.push(r.storageKey,r.thumbnailKey);
          if(session.state!=="completed" && session.state!=="finalizing"){
            const actor=state.actors.findIndex(a=>a.id===session.actorId);
            await json(`/api/upload-sessions/${session.id}`,{method:"DELETE",actor});
          }
          assert.notEqual(session.state,"finalizing","Do not delete data while finalization outcome remains uncertain");
        }
        for(const gallery of galleries){
          assert.ok(gallery.creatorId===state.actors[0].id || state.kind==="video" &&
            (gallery.id===state.eventId && gallery.creatorId===null || gallery.creatorId===state.actors[1].id));
          for(const item of await db.select().from(mediaItems).where(eq(mediaItems.eventId,gallery.id))){
            rememberUrl(item.url);rememberUrl(item.thumbnail);
          }
          await save();
          await json(`/api/events/${gallery.id}`,{method:"DELETE"});
        }
        await storage.cleanupObjects(ids);
        // Official video replacement posters have a null creator. Delete only
        // keys admitted from this exact gallery/media's persisted provenance.
        if(state.kind==="video")for(const key of new Set(state.keys.filter(Boolean))){
          const [route]=await db.select().from(mediaObjectRoutes).where(eq(mediaObjectRoutes.key,key));
          if(route){
            assert.equal(route.provider,"r2","Never switch providers during test cleanup");
            await deleteMediaObject(key);
          }else assert.equal(await getObjectStore("r2").exists(key),false,"A removed route must not hide a remaining object");
          await db.delete(mediaCleanup).where(eq(mediaCleanup.key,key));
        }
        const queued=await db.select().from(mediaCleanup).where(inArray(mediaCleanup.creatorId,ids));
        assert.equal(queued.length,0,"Keep fixture account until object deletion is confirmed");
        const r2=getObjectStore("r2");
        for(const key of new Set(state.keys.filter(Boolean)))assert.equal(await r2.exists(key),false);
        await db.delete(mediaUploadSessions).where(inArray(mediaUploadSessions.actorId,ids));
        for(const id of ids)await db.delete(betaRateLimits).where(inArray(betaRateLimits.key,[`resumable:${id}`,`gallery:${id}`]));
        for(let actor=0;actor<state.actors.length;actor++)await request("/api/logout",{method:"POST",actor});
        await db.delete(users).where(inArray(users.id,ids));
      }
      if(state.sessionId)await rm(path.join("/tmp/vco-upload-sessions",state.sessionId),{recursive:true,force:true});
      const after=(await db.execute(sql`select (select count(*) from users)::int as users,
        (select count(*) from events)::int as events,(select count(*) from media_items)::int as media`)).rows[0];
      assert.deepEqual(after,state.before,"Existing user/gallery/media counts must be preserved");
      report({cleanupConfirmed:true,existingCountsPreserved:true,remainingTestObjects:0,
        uploadsVerified:!!state.verified,originalUserCount:after.users});
      await rm(root,{recursive:true,force:true});
    }
  }else throw new Error("Unknown approved test phase");
}catch(error){
  console.error(JSON.stringify({phase,failed:true,error:error.message}));
  process.exitCode=1;
}finally{await pool.end();}
