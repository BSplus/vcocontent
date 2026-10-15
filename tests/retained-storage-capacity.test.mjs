import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

test("retained storage and atomic capacity use disposable fixtures only", {
  skip:!process.env.VCO_TEST_PG_PROXY || !process.env.VCO_TEST_OBJECTS,
}, async t => {
  const {db,pool}=await import("../server/db.ts");
  const {storage}=await import("../server/storage.ts");
  const {creatorUsage,lockedCreatorBudget}=await import("../server/beta-policy.ts");
  const {retainedStorageUsage}=await import("../server/retained-storage.ts");
  const {linkAssetObject}=await import("../server/media-asset-store.ts");
  const {resolveGalleryOwnership}=await import("../shared/gallery-ownership.ts");
  const {users,events,mediaItems,mediaReservations,mediaCleanup,mediaObjectRoutes:routes,
    mediaAssetObjects:objects,mediaAssetVariants:variants,mediaAssetRecords:records,referenceDocuments}=
    await import("../shared/schema.ts");
  const {eq,inArray,sql}=await import("drizzle-orm");
  const suffix=randomUUID();
  const accounts=await db.insert(users).values([0,1].map(i=>({
    username:`capacity_${i}_${suffix}`,email:`capacity_${i}_${suffix}@example.invalid`,
    password:"fixture-not-a-login",creatorStatus:"approved",isCreator:true,
  }))).returning();
  const galleries=await db.insert(events).values([accounts[0].id,accounts[0].id,accounts[1].id,null].map(creatorId=>({
    title:"Capacity fixture",description:"Isolated",date:new Date(),creatorId,
  }))).returning();
  const keys=[];
  const key=()=>{const k=`media-${randomUUID()}.jpg`;keys.push(k);return k;};
  const item=async(gallery,bytes=100,extra={})=>{
    const k=key();
    return (await db.insert(mediaItems).values({
      eventId:gallery.id,type:"image",url:`/api/media/files/${k}`,
      thumbnail:`/api/media/files/${k}`,highBytes:bytes,lowBytes:bytes,storedBytes:bytes,...extra,
    }).returning())[0];
  };
  const physical=async(gallery,bytes,state="retained")=>{
    const k=key();
    await db.insert(routes).values({key:k,provider:"r2",state:"verified",size:bytes,
      sha256:"a".repeat(64),mime:"image/jpeg",objectVersion:randomUUID()});
    await db.insert(objects).values({key:k,eventId:gallery.id,category:gallery.creatorId===null?"OFFICIAL_VCO":"CREATOR",
      ownerId:gallery.creatorId,state});
    return k;
  };
  const reset=async()=>{
    const ids=galleries.map(g=>g.id);
    await db.delete(variants).where(inArray(variants.objectKey,keys.length?keys:["no-fixture"]));
    const rows=await db.select({id:mediaItems.id}).from(mediaItems).where(inArray(mediaItems.eventId,ids));
    if(rows.length)await db.delete(records).where(inArray(records.mediaId,rows.map(r=>r.id)));
    await db.delete(objects).where(inArray(objects.eventId,ids));
    await db.delete(mediaItems).where(inArray(mediaItems.eventId,ids));
    await db.delete(mediaReservations).where(inArray(mediaReservations.eventId,ids));
    await db.delete(mediaCleanup).where(inArray(mediaCleanup.creatorId,accounts.map(a=>a.id)));
    await db.delete(referenceDocuments).where(inArray(referenceDocuments.ownerId,accounts.map(a=>a.id)));
    if(keys.length)await db.delete(routes).where(inArray(routes.key,keys));
    await db.update(users).set({profileImage:null,profileCoverImage:null}).where(inArray(users.id,accounts.map(a=>a.id)));
  };
  try {
    await t.test("archived, hidden, shared, profile, reference and pending deletion bytes count once",async()=>{
      const a=await item(galleries[0],100,{archivedAt:new Date()});
      const k=a.url.split("/").at(-1);
      await db.update(mediaItems).set({thumbnail:a.url,lowBytes:100}).where(eq(mediaItems.id,a.id));
      await db.insert(mediaCleanup).values({key:k,creatorId:accounts[0].id,storedBytes:100});
      const pending=key();
      await db.insert(mediaCleanup).values({key:pending,creatorId:accounts[0].id,storedBytes:70});
      await db.update(events).set({adminHidden:true}).where(eq(events.id,galleries[0].id));
      await db.update(users).set({profileImage:"data:image/jpeg;base64,YWJj",profileCoverImage:"data:image/jpeg;base64,YWJj"})
        .where(eq(users.id,accounts[0].id));
      await db.insert(referenceDocuments).values({eventId:galleries[0].id,ownerId:accounts[0].id,
        seasonYear:2026,scope:"event",kind:"entry",title:"Fixture",fingerprint:suffix,identityKey:suffix,
        rows:[],sourceKey:key(),storedBytes:20});
      const usage=await creatorUsage(db,accounts[0].id);
      assert.equal(usage.bytes,193);
      assert.equal(usage.retainedBytes,193);
      assert.equal(usage.photos,1);
      assert.equal(usage.pendingCleanup,2);
      assert.equal(usage.cleanupBytes,70);
      assert.equal(usage.unknown,0);
      assert.equal(usage.byGallery[0].bytes,120);
      assert.equal(usage.byType.reduce((n,row)=>n+row.bytes,0),usage.retainedBytes);
      await reset();
    });
    await t.test("registered RAW and derivatives use authoritative routes, not duplicate links",async()=>{
      const a=await item(galleries[0],100);
      const k=a.url.split("/").at(-1);
      await db.insert(routes).values({key:k,provider:"r2",state:"verified",size:120});
      await db.insert(objects).values({key:k,eventId:galleries[0].id,category:"CREATOR",ownerId:accounts[0].id});
      await db.insert(records).values({mediaId:a.id});
      const raw=await physical(galleries[0],900);
      await db.insert(variants).values({mediaId:a.id,objectKey:raw,purpose:"raw",sourceVersion:1,sourceKey:k});
      await physical(galleries[0],30,"deletion_pending");
      const usage=await creatorUsage(db,accounts[0].id);
      assert.equal(usage.bytes,1050);
      assert.equal(usage.byType.find(row=>row.type==="raw").bytes,900);
      await reset();
    });
    await t.test("unknown retained sizes fail closed; other Creators and official storage stay separate",async()=>{
      await item(galleries[0],null);
      await item(galleries[2],80);
      await physical(galleries[3],700_000_000);
      const usage=await creatorUsage(db,accounts[0].id);
      assert.equal(usage.unknown,1);
      await assert.rejects(db.transaction(tx=>lockedCreatorBudget(tx,accounts[0].id,1)),/administrator check/);
      assert.equal((await creatorUsage(db,accounts[1].id)).bytes,80);
      assert.equal((await retainedStorageUsage(db,null)).bytes,700_000_000);
      await reset();
    });
    await t.test("reservations cover partial writes once, then cleanup retains the charge",async()=>{
      const k=await physical(galleries[0],50);
      const id=randomUUID();
      await db.insert(mediaReservations).values({id,eventId:galleries[0].id,creatorId:accounts[0].id,
        reservedBytes:100,storageKey:k,thumbnailKey:key()});
      await db.insert(mediaCleanup).values({key:k,creatorId:accounts[0].id,storedBytes:50});
      let usage=await creatorUsage(db,accounts[0].id);
      assert.equal(usage.bytes,100);assert.equal(usage.reservedBytes,100);assert.equal(usage.retainedBytes,0);
      await db.update(routes).set({size:150}).where(eq(routes.key,k));
      usage=await creatorUsage(db,accounts[0].id);
      assert.equal(usage.bytes,150,"Already retained bytes cannot hide behind a smaller reservation");
      await db.update(routes).set({size:50}).where(eq(routes.key,k));
      await db.delete(mediaReservations).where(eq(mediaReservations.id,id));
      usage=await creatorUsage(db,accounts[0].id);
      assert.equal(usage.bytes,50);
      assert.equal(usage.pendingCleanup,1);
      await reset();
    });
    await t.test("independent concurrent reservations cannot overspend across galleries",async()=>{
      const results=await Promise.allSettled(galleries.slice(0,2).map(g=>
        storage.reserveMedia(randomUUID(),g.id,accounts[0].id,300_000_000,key(),key(),true)));
      assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
      assert.equal(results.filter(r=>r.status==="rejected").length,1);
      assert.equal((await creatorUsage(db,accounts[0].id)).reservedBytes,300_000_000);
      await reset();
    });
    await t.test("derivative overage reacquires capacity and failed commit retains reservation",async()=>{
      await item(galleries[1],499_999_800);
      const id=randomUUID(),k=key();
      await storage.reserveMedia(id,galleries[0].id,accounts[0].id,100,k,key(),true);
      await assert.rejects(storage.finishMedia(id,{eventId:galleries[0].id,type:"image",
        url:`/api/media/files/${k}`,thumbnail:`/api/media/files/${k}`,
        caption:"Fixture",tags:[],storedBytes:300,highBytes:300}),/storage is full/);
      assert.equal((await creatorUsage(db,accounts[0].id)).bytes,499_999_900);
      assert.equal((await db.select().from(mediaReservations).where(eq(mediaReservations.id,id))).length,1);
      await reset();
    });
    await t.test("successful finalization releases only unused capacity and rejects invalid byte claims",async()=>{
      const id=randomUUID(),k=key();
      await storage.reserveMedia(id,galleries[0].id,accounts[0].id,200,k,key(),true);
      const saved=await storage.finishMedia(id,{eventId:galleries[0].id,type:"image",
        url:`/api/media/files/${k}`,thumbnail:`/api/media/files/${k}`,
        caption:"Creator text",tags:["Kept"],storedBytes:100,highBytes:100,lowBytes:100});
      assert.equal(saved.caption,"Creator text");
      const usage=await creatorUsage(db,accounts[0].id);
      assert.equal(usage.reservedBytes,0);
      assert.equal(usage.retainedBytes,100);
      await assert.rejects(storage.reserveMedia(randomUUID(),galleries[0].id,accounts[0].id,-1,key(),key(),true),
        /Invalid upload reservation size/);
      await reset();
    });
    await t.test("new physical registrations cannot bypass capacity, including admin callers",async()=>{
      const a=await item(galleries[0],100);
      const k=key(),version=randomUUID();
      await db.insert(routes).values({key:k,provider:"r2",state:"verified",size:500_000_001,
        sha256:"b".repeat(64),mime:"image/jpeg",objectVersion:version});
      await assert.rejects(linkAssetObject({mediaId:a.id,ownership:resolveGalleryOwnership(galleries[0]),
        key:k,purpose:"original",sourceVersion:1,sha256:"b".repeat(64),objectVersion:version}),/storage is full/);
      assert.equal((await db.select().from(objects).where(eq(objects.key,k))).length,0);
      await reset();
    });
    await t.test("legacy-only schemas work; partial foundations are explicitly rejected",async()=>{
      const legacy={execute:async query=>{
        const compiled=new (await import("drizzle-orm/pg-core")).PgDialect().sqlToQuery(query);
        if(compiled.sql.includes("to_regclass"))return {rows:[{objects:null,variants:null,records:null}]};
        assert.ok(!compiled.sql.includes("from media_asset_objects"));
        return {rows:[{retained_bytes:"0",reserved_bytes:"0",reservations:0,unknown:0,pending_cleanup:0,
          cleanup_bytes:"0",by_type:[],by_gallery:[]}]};
      }};
      assert.equal((await retainedStorageUsage(legacy,accounts[0].id)).bytes,0);
      await assert.rejects(retainedStorageUsage({execute:async()=>({rows:[{objects:"media_asset_objects",
        variants:null,records:null}]})},accounts[0].id),/schema is incomplete/);
    });
  } finally {
    await reset();
    await db.delete(events).where(inArray(events.id,galleries.map(g=>g.id)));
    await db.delete(users).where(inArray(users.id,accounts.map(a=>a.id)));
    await pool.end();
  }
});
