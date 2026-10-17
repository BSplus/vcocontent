import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

test("additive asset-object foundation uses only disposable PostgreSQL", {
  skip:!process.env.VCO_TEST_PG_PROXY || !process.env.VCO_TEST_OBJECTS,
}, async t => {
  const {db,pool}=await import("../server/db.ts");
  const schema=await import("../shared/schema.ts");
  const {users,events,mediaItems,mediaObjectRoutes:routes,mediaAssetRecords:records,
    mediaAssetObjects:objects,mediaAssetVariants:variants}=schema;
  const {eq,inArray,sql}=await import("drizzle-orm");
  const {resolveGalleryOwnership}=await import("../shared/gallery-ownership.ts");
  const {linkAssetObject,setAssetTitle,readMediaAsset,previewAssetReconciliation}=
    await import("../server/media-asset-store.ts");
  const {deleteRoutedMediaObject}=await import("../server/media-object-routing.ts");
  const {mockMediaStorage}=await import("./helpers/memory-media-storage.mjs");
  const store=mockMediaStorage();
  const [owner]=await db.insert(users).values({username:`asset-${randomUUID()}`,
    email:`${randomUUID()}@example.invalid`,password:"fixture"}).returning();
  const galleries=await db.insert(events).values([null,owner.id,owner.id].map(creatorId=>({
    title:"Temporary asset fixture",description:"Synthetic",date:new Date(),creatorId,
  }))).returning();
  const items=await db.insert(mediaItems).values(galleries.flatMap(event=>["image","video"].map(type=>({
    eventId:event.id,type,url:`/api/media/files/media-${randomUUID()}.${type==="image"?"jpg":"mp4"}`,
    thumbnail:`/api/media/files/thumb-${randomUUID()}.webp`,caption:"Preserved authored caption",
    highBytes:100,lowBytes:20,storedBytes:120,
    manualTags:["Kept"],identificationManual:true,
  })))).returning();
  const keys=[];
  async function route(mime="image/jpeg",provider="r2",size=100) {
    const extension = {"image/jpeg":"jpg","image/webp":"webp","image/x-adobe-dng":"dng","video/mp4":"mp4"}[mime];
    const key=`media-${randomUUID()}.${extension}`;keys.push(key);
    const [result]=await db.insert(routes).values({key,mime,provider,size,state:"verified",
      sha256:"a".repeat(64),objectVersion:`version-${randomUUID()}`}).returning();
    return result;
  }
  function link(item,object,purpose="original",extra={}) {
    const gallery=galleries.find(g=>g.id===item.eventId);
    return linkAssetObject({mediaId:item.id,ownership:resolveGalleryOwnership(gallery),key:object.key,
      purpose,sourceVersion:1,sha256:object.sha256,objectVersion:object.objectVersion,...extra});
  }
  const ownership=resolveGalleryOwnership(galleries[1]);
  try {
    await t.test("old image/video identities, captions and URLs read with no automatic writes",async()=>{
      for(const item of items) {
        const view=await readMediaAsset(item.id);
        assert.equal(view.item.id,item.id);assert.equal(view.item.url,item.url);
        assert.equal(view.item.caption,item.caption);assert.equal(view.title,null);
        assert.equal(view.kind,item.type==="image"?"PHOTO":"VIDEO");
        assert.equal(view.legacy[0].purpose,"legacy_source");
        assert.deepEqual(view.variants,[]);
      }
      assert.equal((await db.select().from(records)).length,0);
      assert.equal((await db.select().from(objects)).length,0);
    });
    const original=await route();
    const photo=items[2];
    await t.test("round trip metadata and two logical purposes charge one physical key",async()=>{
      const first=await link(photo,original);
      assert.equal((await link(photo,original)).id,first.id,"Retry is idempotent");
      await link(photo,original,"preview",{sourceKey:original.key});
      await setAssetTitle(photo.id,ownership," Optional title ");
      const view=await readMediaAsset(photo.id);
      assert.equal(view.title,"Optional title");assert.equal(view.item.caption,photo.caption);
      assert.deepEqual(view.item.manualTags,["Kept"]);
      assert.equal(view.variants.length,2);
      for(const variant of view.variants) {
        assert.equal(variant.object.ownerId,owner.id);
        assert.equal(variant.object.category,"CREATOR");
        assert.equal(variant.object.state,"retained");
        for(const field of ["key","provider","size","mime","sha256","objectVersion","state"])
          assert.equal(variant.route[field],original[field]);
      }
      const preview=await previewAssetReconciliation(ownership);
      assert.deepEqual(preview,{schema:"foundation",physicalObjects:1,retainedBytes:100,
        unknownObjects:0,ownershipConflicts:0,unmappedMedia:1});
      await setAssetTitle(photo.id,ownership,null);
      assert.equal((await readMediaAsset(photo.id)).title,null);
    });
    await t.test("official objects retain null owner and provider authority",async()=>{
      const object=await route("video/mp4","replit",250);
      await link(items[1],object);
      const view=await readMediaAsset(items[1].id);
      assert.equal(view.variants[0].object.category,"OFFICIAL_VCO");
      assert.equal(view.variants[0].object.ownerId,null);
      assert.equal(view.variants[0].route.provider,"replit");
    });
    await t.test("reject cross-owner, cross-gallery, stale snapshots, source drift and replaced revisions",async()=>{
      await assert.rejects(link(items[0],original),/ownership/);
      await assert.rejects(link(items[4],original),/ownership/);
      await assert.rejects(link(photo,original,"original",{ownership:resolveGalleryOwnership(galleries[0])}),/gallery mismatch/);
      await assert.rejects(link(photo,original,"original",{sha256:"b".repeat(64)}),/source changed/);
      await assert.rejects(link(photo,original,"original",{objectVersion:"stale"}),/source changed/);
      const different=await route();
      await assert.rejects(link(photo,different),/source conflict/);
      assert.equal((await db.select().from(objects).where(eq(objects.key,different.key))).length,0,"Conflict rolls back physical record");
      await assert.rejects(link(photo,original,"original",{sourceVersion:0}),/source version/);
      await assert.rejects(link(photo,original,"poster"),/purpose/);
      await db.update(events).set({creatorId:null}).where(eq(events.id,ownership.galleryId));
      try {await assert.rejects(link(photo,original),/owner changed/);}
      finally {await db.update(events).set({creatorId:owner.id}).where(eq(events.id,ownership.galleryId));}
    });
    await t.test("derivatives, RAW and video poster require the same asset revision source",async()=>{
      const raw=await route("image/x-adobe-dng");
      await assert.rejects(link(items[4],raw,"raw",{sourceKey:original.key}),/same asset revision/);
      await assert.rejects(link(photo,raw,"raw",{sourceKey:original.key,sourceVersion:2}),/same asset revision/);
      await assert.rejects(link(photo,raw,"raw"),/source relationship/);
      await assert.rejects(link(photo,original,"raw",{sourceKey:original.key}),/format/);
      const selection={intent:"explicit",mediaId:photo.id,sourceVersion:1,
        jpegKey:original.key,jpegSha256:original.sha256,rawKey:raw.key,rawSha256:raw.sha256};
      await assert.rejects(link(photo,raw,"raw",{sourceKey:original.key}),/selection/);
      for(const change of [{mediaId:items[4].id},{sourceVersion:2},
        {jpegSha256:"b".repeat(64)},{rawSha256:"b".repeat(64)},{intent:"automatic"}]){
        await assert.rejects(link(photo,raw,"raw",{sourceKey:original.key,
          rawSelection:{...selection,...change}}),/selection/);
      }
      assert.equal((await db.select().from(objects).where(eq(objects.key,raw.key))).length,0,
        "Invalid selections do not partially register physical objects");
      const jobs=await db.select().from(schema.mediaAnalysisJobs);
      const first=await link(photo,raw,"raw",{sourceKey:original.key,rawSelection:selection});
      assert.equal((await link(photo,raw,"raw",{sourceKey:original.key,rawSelection:selection})).id,first.id);
      assert.deepEqual(await db.select().from(schema.mediaAnalysisJobs),jobs,"RAW creates no vision job");
      assert.equal((await previewAssetReconciliation(ownership)).retainedBytes,200);
      const video=await readMediaAsset(items[1].id);
      const poster=await route("image/webp","replit");
      await link(items[1],poster,"poster",{sourceKey:video.variants[0].object.key});
      await assert.rejects(link(items[1],poster,"raw",{sourceKey:video.variants[0].object.key}),/purpose/);
      assert.equal((await readMediaAsset(photo.id)).variants.length,3,"RAW adds a variant, not a media row");
      assert.equal((await db.select().from(mediaItems).where(eq(mediaItems.eventId,ownership.galleryId))).length,2);
    });
    await t.test("a RAW cannot be attached to a second photo identity even within the same gallery",async()=>{
      const [raw]=await db.select().from(variants).where(sql`${variants.purpose}='raw'`);
      const [rawRoute]=await db.select().from(routes).where(eq(routes.key,raw.objectKey));
      const [second]=await db.insert(mediaItems).values({eventId:ownership.galleryId,type:"image",
        url:photo.url,thumbnail:photo.thumbnail,caption:"Independent photo fixture"}).returning();
      try{
        await link(second,original);
        await assert.rejects(link(second,rawRoute,"raw",{sourceKey:original.key,rawSelection:{
          intent:"explicit",mediaId:second.id,sourceVersion:1,jpegKey:original.key,
          jpegSha256:original.sha256,rawKey:rawRoute.key,rawSha256:rawRoute.sha256,
        }}),/already paired/);
        assert.equal((await db.select().from(variants).where(eq(variants.objectKey,raw.objectKey))).length,1);
      }finally{
        await db.delete(variants).where(eq(variants.mediaId,second.id));
        await db.delete(records).where(eq(records.mediaId,second.id));
        await db.delete(mediaItems).where(eq(mediaItems.id,second.id));
      }
    });
    await t.test("unknown/provider-pending facts are not treated as free capacity",async()=>{
      await db.update(routes).set({size:null,state:"pending"}).where(eq(routes.key,original.key));
      const usage=await previewAssetReconciliation(ownership);
      assert.equal(usage.unknownObjects,1);assert.equal(usage.retainedBytes,100);
      await assert.rejects(link(photo,original),/integrity/);
      await db.update(routes).set({size:100,state:"verified"}).where(eq(routes.key,original.key));
    });
    await t.test("concurrent key registration cannot acquire a second accounting owner",async()=>{
      const object=await route();
      const results=await Promise.allSettled([link(items[0],object),link(items[4],object)]);
      assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
      assert.equal(results.filter(r=>r.status==="rejected").length,1);
      assert.equal((await db.select().from(objects).where(eq(objects.key,object.key))).length,1);
    });
    await t.test("retained and deletion-pending inventory blocks physical legacy cleanup and destructive cascades",async()=>{
      store.objects.set(original.key,Buffer.from("must remain"));
      for(const state of ["retained","deletion_pending","deleted"]) {
        await db.update(objects).set({state}).where(eq(objects.key,original.key));
        await assert.rejects(deleteRoutedMediaObject(original.key),e=>e.code==="retained");
        assert.ok(store.objects.has(original.key));
        if (state === "retained") await link(photo,original); // Idempotent unchanged retry.
        else await assert.rejects(link(photo,original),/lifecycle conflict/);
      }
      await db.update(objects).set({state:"retained"}).where(eq(objects.key,original.key));
      await assert.rejects(db.delete(mediaItems).where(eq(mediaItems.id,photo.id)));
      await assert.rejects(db.delete(routes).where(eq(routes.key,original.key)));
      await assert.rejects(db.delete(events).where(eq(events.id,ownership.galleryId)));
    });
    await t.test("read-only reconciliation writes nothing, reports conflicts, and preserves legacy rows",async()=>{
      const before=await db.select().from(objects).orderBy(objects.key);
      await db.update(objects).set({category:"OFFICIAL_VCO",ownerId:null}).where(eq(objects.key,original.key));
      const report=await previewAssetReconciliation(ownership);
      assert.equal(report.ownershipConflicts,1);
      assert.ok(!JSON.stringify(report).includes(original.key));
      await db.update(objects).set({category:"CREATOR",ownerId:owner.id}).where(eq(objects.key,original.key));
      assert.deepEqual(await db.select().from(objects).orderBy(objects.key),before);
    });
    await t.test("reader falls back without foundation tables and rejects partially applied schema",async()=>{
      const names=["media_asset_variants","media_asset_objects","media_asset_records"];
      for(const name of names) await db.execute(sql.raw(`alter table ${name} rename to fixture_${name}`));
      try {
        const view=await readMediaAsset(photo.id);
        assert.equal(view.item.url,photo.url);assert.deepEqual(view.variants,[]);
        assert.equal((await previewAssetReconciliation(ownership)).schema,"legacy");
        await db.execute(sql`alter table fixture_media_asset_records rename to media_asset_records`);
        await assert.rejects(readMediaAsset(photo.id),/incomplete/);
        await db.execute(sql`alter table media_asset_records rename to fixture_media_asset_records`);
      } finally {
        for(const name of [...names].reverse()) await db.execute(sql.raw(`alter table fixture_${name} rename to ${name}`));
      }
    });
  } finally {
    store.restore();
    await db.delete(variants).where(inArray(variants.mediaId,items.map(i=>i.id)));
    await db.delete(records).where(inArray(records.mediaId,items.map(i=>i.id)));
    await db.delete(objects).where(inArray(objects.key,keys));
    await db.delete(routes).where(inArray(routes.key,keys));
    await db.delete(mediaItems).where(inArray(mediaItems.id,items.map(i=>i.id)));
    await db.delete(events).where(inArray(events.id,galleries.map(g=>g.id)));
    await db.delete(users).where(eq(users.id,owner.id));
    await pool.end();
  }
});
