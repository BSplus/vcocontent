import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db.ts";
import { storage } from "../server/storage.ts";
import { users, events, mediaItems } from "../shared/schema.ts";
import { SAFETY_POLICY } from "../shared/safety-policy.ts";
test.after(async()=>{storage.sessionStore.close();await pool.end();});
test("batched cards preserve the first-page photo order and exclude unsafe, archived, premium or hidden candidates",async()=>{
  assert.ok(process.env.VCO_TEST_PG_PROXY,"Use the disposable PostgreSQL test runner");
  const suffix=randomUUID(),ids=[],eventIds=[];
  const [owner]=await db.insert(users).values({username:`thumb_${suffix}`,email:`${suffix}@example.invalid`,
    password:"synthetic",creatorStatus:"approved"}).returning();
  const addEvent=async values=>{
    const [event]=await db.insert(events).values({title:"Card fallback fixture",description:"Synthetic",
      date:new Date(),...values}).returning();eventIds.push(event.id);return event;
  };
  const add=async(event,values={})=>{
    const [item]=await db.insert(mediaItems).values({eventId:event.id,type:"image",url:"data:image/jpeg;base64,ORIGINAL",
      thumbnail:"data:image/jpeg;base64,YmFk",...values}).returning();ids.push(item.id);return item;
  };
  try{
    const official=await addEvent({creatorId:null}),creator=await addEvent({creatorId:owner.id}),
      hidden=await addEvent({adminHidden:true}),premium=await addEvent({isPremium:true}),
      firstPage=await addEvent({creatorId:null});
    const photo=await add(official);
    await add(official,{type:"video"});await add(official,{isPremium:true});
    await add(official,{safetyStatus:"approved",safetyPolicy:SAFETY_POLICY,contentVersion:1,safetyVersion:0});
    await add(official,{archivedAt:new Date()});await add(official,{thumbnail:"https://external.invalid/x.jpg"});
    const legacyCreator=await add(creator);
    await add(creator,{safetyStatus:"review"});await add(hidden);await add(premium);
    await add(firstPage);
    for(let n=0;n<48;n++)await add(firstPage,{type:"video"});
    let fallback=await storage.getEventCardFallbacks(eventIds);
    assert.equal(fallback.get(official.id),`/api/media/legacy/${photo.id}/thumbnail`);
    assert.equal(fallback.get(creator.id),`/api/media/legacy/${legacyCreator.id}/thumbnail`);
    assert.ok(!fallback.has(hidden.id));assert.ok(!fallback.has(premium.id));assert.ok(!fallback.has(firstPage.id));
    const cards=await storage.getEventsWithCardFallbacks();
    assert.equal(cards.find(e=>e.id===official.id).galleryThumbnail,fallback.get(official.id));
    assert.equal(cards.find(e=>e.id===hidden.id).galleryThumbnail,null);
    const thin=await storage.getMediaItem(photo.id,false);assert.equal(thin.url,"");
    const eventAccess=await storage.getEvent(official.id,false);
    assert.equal(eventAccess.customThumbnail,null);assert.equal(eventAccess.coverImage,null);
    await db.update(users).set({suspended:true}).where(eq(users.id,owner.id));
    fallback=await storage.getEventCardFallbacks(eventIds);assert.ok(!fallback.has(creator.id));
    await db.update(users).set({suspended:false,creatorStatus:"rejected"}).where(eq(users.id,owner.id));
    assert.ok(!(await storage.getEventCardFallbacks(eventIds)).has(creator.id));
    const modern="/api/media/files/thumb-00000000-0000-0000-0000-000000000079.webp";
    const newPhoto=await add(official,{thumbnail:modern});
    assert.equal((await storage.getEventCardFallbacks([official.id])).get(official.id),modern);
    assert.equal((await storage.findMediaByKey(modern.split("/").at(-1),false)).url,"");
    await db.delete(mediaItems).where(eq(mediaItems.id,newPhoto.id));
    assert.equal((await storage.getEventCardFallbacks([official.id])).get(official.id),`/api/media/legacy/${photo.id}/thumbnail`);
  }finally{
    for(const id of ids)await db.delete(mediaItems).where(eq(mediaItems.id,id));
    for(const id of eventIds)await db.delete(events).where(eq(events.id,id));
    await db.delete(users).where(eq(users.id,owner.id));
  }
});
