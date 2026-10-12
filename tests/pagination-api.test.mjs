import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { pageMetadata } from "../shared/pagination.ts";

test("pagination metadata clamps empty, full and stale pages", () => {
  for (const size of [24,48,500]) for (const total of [0,1,size,size+1,size*2]) {
    const pages = Math.max(1,Math.ceil(total/size));
    assert.deepEqual(pageMetadata(total,999,size), {page:pages,pageSize:size,total,totalPages:pages,hasMore:false});
    assert.equal(pageMetadata(total,1,size).hasMore, pages>1);
  }
});

test("every paginated API counts accessible matching rows, exact full pages and stale positions", {
  skip: !process.env.VCO_TEST_PG_PROXY, timeout:120000,
}, async () => {
  // Only the disposable database runner is allowed to execute these writes.
  process.env.RESEND_API_KEY = "synthetic-mail-key";
  process.env.RESEND_FROM = "verify@example.test";
  process.env.PUBLIC_SITE_URL = "https://example.test";
  const {default:express} = await import("express");
  const {db,pool} = await import("../server/db.ts");
  const {storage} = await import("../server/storage.ts");
  const {registerRoutes} = await import("../server/routes.ts");
  const {users,events,mediaItems,communityFavorites,downloadHistory,creatorFollows} = await import("../shared/schema.ts");
  const {eq,and,inArray} = await import("drizzle-orm");
  const {SAFETY_POLICY} = await import("../shared/safety-policy.ts");
  const marker = randomUUID();
  let server;
  const ownerIds = [], eventIds = [];
  try {
    const [actor] = await db.insert(users).values({username:`pager-${marker}`,password:"synthetic",
      email:`pager-${marker}@example.invalid`,emailVerifiedAt:new Date(),isAdmin:true,isCreator:true}).returning();
    ownerIds.push(actor.id);
    const createEvent = async extra => {
      const [event] = await db.insert(events).values({title:`Pagination ${marker}`,description:"Synthetic only",date:new Date(),...extra}).returning();
      eventIds.push(event.id);return event;
    };
    const official = await createEvent({});
    const privateEvent = await createEvent({creatorId:actor.id,visibility:"draft"});
    const creator = await createEvent({creatorId:actor.id,visibility:"published",safetyStatus:"legacy"});
    const app = express();
    app.use((req,_res,next)=>{req.user=req.headers["x-fixture-user"] ? actor : undefined;req.isAuthenticated=()=>!!req.user;next();});
    server = await registerRoutes(app,{workers:false});
    server.listen(0,"127.0.0.1");await once(server,"listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = async (path,authenticated=false) => {
      const response = await fetch(base+path,{headers:authenticated?{"x-fixture-user":"yes"}:{}});
      assert.equal(response.status,200,path);return response.json();
    };
    const meta = (body,total,page,size) => {
      const expected = pageMetadata(total,page,size);
      for (const key of Object.keys(expected)) assert.equal(body[key],expected[key],`${key}: ${JSON.stringify(body).slice(0,180)}`);
      return expected;
    };
    const seed = async (event,count,extra={}) => count ? db.insert(mediaItems).values(Array.from({length:count},(_,i)=>({
      eventId:event.id,type:"image",url:"/synthetic-original.webp",
      thumbnail:`/api/media/files/thumb-${randomUUID()}.webp`,caption:`${marker} ${i}`,...extra,
    }))).returning() : [];
    await seed(privateEvent,5);
    await seed(official,2,{isPremium:true,caption:`${marker} excluded`});
    await seed(creator,3,{safetyStatus:"review"});
    for (const total of [0,1,48,49,96]) {
      await db.delete(mediaItems).where(and(eq(mediaItems.eventId,official.id),eq(mediaItems.isPremium,false)));
      await seed(official,total);
      const endpoint = `/api/media?q=${marker}&fields=caption&type=image&pagination=true`;
      for (const page of [1,2,999]) {
        const body = await get(`${endpoint}&page=${page}`);
        const bounds = meta(body,total,page,48);
        assert.equal(body.items.length,Math.min(48,Math.max(0,total-(bounds.page-1)*48)));
      }
      assert.ok(Array.isArray(await get(`/api/media?q=${marker}`)),"legacy search consumers keep arrays");
      const filtered = await get(`/api/media?pagination=true&page=2&q=nonexistent-${marker}`);
      meta(filtered,0,2,48);
      // Public event contract is unchanged; historical official premium media are listed as before.
      const publicGallery = await get(`/api/events/${official.id}/media?pagination=true&page=999`);
      meta(publicGallery,total+2,999,48);
      const managed = await get(`/api/events/${privateEvent.id}/media?pagination=true&page=999`,true);
      meta(managed,5,999,48);
    }
    await db.delete(mediaItems).where(eq(mediaItems.eventId,official.id));
    // Thumbnail counts must exclude video, premium, unbounded and creator-unapproved candidates.
    await seed(official,1,{type:"video"});
    await seed(official,1,{isPremium:true});
    await seed(official,1,{thumbnail:"https://untrusted.invalid/image.png"});
    for (const total of [0,1,24,25,48]) {
      await db.delete(mediaItems).where(and(eq(mediaItems.eventId,creator.id),eq(mediaItems.safetyStatus,"approved")));
      await seed(creator,total,{safetyStatus:"approved",safetyPolicy:SAFETY_POLICY,contentVersion:1,safetyVersion:1});
      for (const page of [1,2,999]) {
        const body = await get(`/api/events/${creator.id}/thumbnail-options?page=${page}`,true);
        const bounds = meta(body,total,page,24);
        assert.equal(body.photos.length,Math.min(24,Math.max(0,total-(bounds.page-1)*24)));
      }
    }
    meta(await get(`/api/events/${official.id}/thumbnail-options`,true),0,1,24);
    // The same account joins and policy filters govern counts and returned rows.
    await db.delete(mediaItems).where(eq(mediaItems.eventId,official.id));
    const photos = await seed(official,48);
    const [unavailable] = await seed(privateEvent,1);
    for (const total of [0,1,24,25,48]) {
      await db.delete(communityFavorites).where(eq(communityFavorites.userId,actor.id));
      await db.delete(downloadHistory).where(eq(downloadHistory.userId,actor.id));
      await db.insert(communityFavorites).values([{userId:actor.id,mediaId:unavailable.id},
        ...photos.slice(0,total).map(photo=>({userId:actor.id,mediaId:photo.id}))]);
      await db.insert(downloadHistory).values([unavailable,...photos.slice(0,total)].map(photo=>({
        operationId:randomUUID(),userId:actor.id,mediaId:photo.id,quality:"high",
      })));
      for (const section of ["favorites","downloads"]) for (const page of [1,2,999]) {
        const body = await get(`/api/account/${section}?page=${page}`,true);
        const bounds = meta(body,total,page,24);
        assert.equal(body.items.length,Math.min(24,Math.max(0,total-(bounds.page-1)*24)));
        assert.ok(!body.items.some(item=>item.id===unavailable.id));
      }
    }
    await db.insert(communityFavorites).values({userId:actor.id,eventId:official.id});
    meta(await get("/api/account/favorites",true),49,1,24);
    const people = await db.insert(users).values(Array.from({length:50},(_,i)=>({
      username:`follow-${i}-${marker}`,email:`follow-${i}-${marker}@example.invalid`,password:"synthetic",isCreator:true,
      suspended:i===48,creatorStatus:i===49?"rejected":"approved",
    }))).returning();
    ownerIds.push(...people.map(person=>person.id));
    for (const total of [0,1,24,25,48]) {
      await db.delete(creatorFollows).where(eq(creatorFollows.userId,actor.id));
      await db.insert(creatorFollows).values([...people.slice(0,total),...people.slice(48)].map(person=>({userId:actor.id,creatorId:person.id})));
      for (const page of [1,2,999]) {
        const body = await get(`/api/account/following?page=${page}`,true);
        const bounds = meta(body,total,page,24);
        assert.equal(body.items.length,Math.min(24,Math.max(0,total-(bounds.page-1)*24)));
      }
    }
    // Preserve cursor navigation, but invalidate shifted or deleted boundaries.
    for (const total of [0,1,500,501,1000]) {
      await db.delete(mediaItems).where(eq(mediaItems.eventId,official.id));
      await seed(official,total);
      const first = await get(`/api/events/${official.id}/photo-matching`,true);
      meta(first,total,1,500);
      assert.equal(first.photos.length,Math.min(500,total));
      assert.equal(!!first.nextCursor,total>500);
      if (first.nextCursor) {
        const second = await get(`/api/events/${official.id}/photo-matching?before=${first.nextCursor}`,true);
        meta(second,total,2,500);
        assert.equal(second.photos.length,total-500);
        assert.equal(second.nextCursor,null);
        assert.ok(second.photos.every(photo=>photo.id<first.nextCursor));
        await seed(official,1);
        const reset = await get(`/api/events/${official.id}/photo-matching?before=${first.nextCursor}`,true);
        meta(reset,total+1,1,500);assert.equal(reset.positionReset,true);
        await seed(official,499);
        const moved = await get(`/api/events/${official.id}/photo-matching?before=${first.nextCursor}&page=2`,true);
        meta(moved,total+500,1,500);assert.equal(moved.positionReset,true,"a whole-page insertion cannot leave the previous-cursor stack out of sync");
        await db.delete(mediaItems).where(eq(mediaItems.id,first.nextCursor));
        assert.equal((await get(`/api/events/${official.id}/photo-matching?before=${first.nextCursor}`,true)).positionReset,true);
      }
    }
  } finally {
    if (server) await new Promise(resolve=>server.close(resolve));
    try {
      if (eventIds.length) {
        await db.delete(mediaItems).where(inArray(mediaItems.eventId,eventIds));
        await db.delete(events).where(inArray(events.id,eventIds));
      }
      if (ownerIds.length) await db.delete(users).where(inArray(users.id,ownerIds));
    } finally {
      storage.sessionStore.close();
      await pool.end();
    }
  }
});
