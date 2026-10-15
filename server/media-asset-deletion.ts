import {sql} from "drizzle-orm";
import type {Event} from "@shared/schema";

type Executor={execute:(query:ReturnType<typeof sql>)=>Promise<{rows:Record<string,any>[]} >};

/**
 * Called inside the ordinary deletion transaction, after owner/gallery locks.
 * Transfer unreferenced inventory to the existing durable cleanup queue. The
 * queue, route and owner keep bytes charged until physical absence is proven.
 * No provider calls or new schema are needed for this handoff.
 */
export async function prepareAssetDeletion(tx:Executor,event:Event,ids:number[],wholeGallery=false){
  const schema=(await tx.execute(sql`select to_regclass('media_asset_objects') as objects,
    to_regclass('media_asset_variants') as variants,to_regclass('media_asset_records') as records,
    to_regclass('media_upload_sessions') as sessions,to_regclass('media_r2_multipart_journals') as journal`)).rows[0];
  const list=sql`select value::integer from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)`;
  if(schema.sessions){
    const unfinished=await tx.execute(sql`select s.id from media_upload_sessions s where s.event_id=${event.id}
      and (${wholeGallery} or s.media_id in (${list}))
      and (s.metadata ? 'nativeTransport' or s.metadata ? 'nativeReceipt'
        ${schema.journal?sql`or exists(select 1 from media_r2_multipart_journals j where j.session_id=s.id)`:sql``})
      and (s.state in ('receiving','finalizing') or s.cleaned_at is null) limit 1`);
    if(unfinished.rows.length)throw new Error("Finish or safely cancel the pending native upload before deleting this content.");
  }
  const count=[schema.objects,schema.variants,schema.records].filter(Boolean).length;
  if(!count)return new Set<string>();
  if(count!==3)throw new Error("Asset foundation schema is incomplete.");
  const linked=await tx.execute(sql`select object_key as key from media_asset_variants where media_id in (${list})
    union select source_key from media_asset_variants where media_id in (${list}) and source_key is not null
    ${wholeGallery?sql`union select key from media_asset_objects where event_id=${event.id}`:sql``}`);
  const keys=linked.rows.map(r=>String(r.key)).sort(),covered=new Set(keys);
  // Existing queue entries must precede route locks, matching the cleanup
  // worker. New queue rows cannot be visible to a worker before this commits.
  const keyList=sql`select value from jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)`;
  if(keys.length)await tx.execute(sql`select key from media_cleanup
    where key in (${keyList}) order by key for update`);
  // Same route-before-object order as registration and routed cleanup.
  const routes=await tx.execute(sql`select * from media_object_routes where key in (${keyList}) order by key for update`);
  const physical=await tx.execute(sql`select * from media_asset_objects where key in (${keyList}) order by key for update`);
  const routeMap=new Map(routes.rows.map(row=>[row.key,row])),objectMap=new Map(physical.rows.map(row=>[row.key,row]));
  const objects:Record<string,any>[]=[];
  for(const key of keys){
    const route=routeMap.get(key),object=objectMap.get(key);
    if(!route||!object||object.event_id!==event.id||object.owner_id!==event.creatorId||
      object.category!==(event.creatorId===null?"OFFICIAL_VCO":"CREATOR"))
      throw new Error("Asset ownership could not be confirmed for deletion.");
    if(route.state!=="verified"||!Number.isSafeInteger(Number(route.size))||Number(route.size)<=0||
      !/^[a-f0-9]{64}$/.test(route.sha256??"")||!route.object_version||!route.mime)
      throw new Error("Asset integrity could not be confirmed for deletion.");
    objects.push({...object,bytes:Number(route.size)});
  }
  const photos=await tx.execute(sql`select v.object_key as key,m.id from media_asset_variants v
    join media_items m on m.id=v.media_id where m.id in (${list}) and m.type='image' order by m.id`);
  const photoTokens=new Map<string,string>();
  for(const photo of photos.rows)if(!photoTokens.has(photo.key))photoTokens.set(photo.key,`item:${photo.id}`);
  await tx.execute(sql`delete from media_asset_variants where media_id in (${list})`);
  await tx.execute(sql`delete from media_asset_records where media_id in (${list})`);
  const retained=await tx.execute(sql`with candidates as (
    select value as key,'/api/media/files/'||value as url from jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)
    ) select c.key from candidates c where
      exists(select 1 from media_asset_variants where object_key=c.key or source_key=c.key)
      or exists(select 1 from media_items where ${ids.length?sql`id not in (${list})`:sql`true`}
        and (url=c.url or thumbnail=c.url))
      or exists(select 1 from reference_documents where source_key=c.key
        and not (${wholeGallery} and event_id is not distinct from ${event.id}))
      or exists(select 1 from media_reservations where storage_key=c.key or thumbnail_key=c.key)`);
  if(wholeGallery&&retained.rows.length)
    throw new Error("This gallery still has assets referenced by other content or pending uploads.");
  const keep=new Set(retained.rows.map(row=>row.key)),release=objects.filter(object=>!keep.has(object.key));
  // Bounded SQL batches, not one round-trip per asset or an unbounded parameter list.
  for(let i=0;i<release.length;i+=512){
    const batch=release.slice(i,i+512);
    const queued=await tx.execute(sql`insert into media_cleanup(key,creator_id,stored_bytes,photo_token)
      values ${sql.join(batch.map(object=>sql`(${object.key},${event.creatorId},${object.bytes},${photoTokens.get(object.key)??null})`),sql`, `)}
      on conflict(key) do update set stored_bytes=excluded.stored_bytes
      where media_cleanup.creator_id is not distinct from excluded.creator_id returning key`);
    if(queued.rows.length!==batch.length)throw new Error("Cleanup accounting ownership could not be confirmed.");
    await tx.execute(sql`delete from media_asset_objects where key in
      (select value from jsonb_array_elements_text(${JSON.stringify(batch.map(object=>object.key))}::jsonb))`);
  }
  return covered;
}
