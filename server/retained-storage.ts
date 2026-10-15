import { sql } from "drizzle-orm";

type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<{rows: Record<string, any>[]}> };

/** Physical persistent storage, including archived files and pending deletion.
 * A temporary download cache is deliberately not a persistent asset source.
 * Legacy readers remain usable before the additive asset tables are published.
 */
export async function retainedStorageUsage(executor: Executor, ownerId: number | null) {
  const schema = await executor.execute(sql`select to_regclass('media_asset_objects') as objects,
    to_regclass('media_asset_variants') as variants, to_regclass('media_asset_records') as records`);
  const present = Object.values(schema.rows[0]).filter(Boolean).length;
  if (present && present !== 3) throw new Error("Asset foundation schema is incomplete");
  const owner = sql`e.creator_id is not distinct from ${ownerId}`;
  const pendingOwner = sql`r.creator_id is not distinct from ${ownerId}`;
  const result = await executor.execute(sql`
    with reservations as (
      select r.* from media_reservations r where ${pendingOwner}
    ), sources as (
      select regexp_replace(m.url,'^/api/media/files/','') as key,
        m.high_bytes::bigint as bytes, e.id as event_id, m.type as kind, false as strict
        from media_items m join events e on e.id=m.event_id where ${owner}
      union all
      select regexp_replace(m.thumbnail,'^/api/media/files/',''),m.low_bytes::bigint,e.id,'derivative',false
        from media_items m join events e on e.id=m.event_id where ${owner}
      union all
      select source_key,stored_bytes,event_id,'reference',false from reference_documents
        where owner_id is not distinct from ${ownerId} and source_key is not null
      ${ownerId === null ? sql`` : sql`
      union all select profile_image,null::bigint,null::integer,'profile',false from users
        where id=${ownerId} and profile_image like 'data:%;base64,%'
      union all select profile_cover_image,null::bigint,null::integer,'profile',false from users
        where id=${ownerId} and profile_cover_image like 'data:%;base64,%'`}
      union all
      select c.key,c.stored_bytes,null::integer,'cleanup',false from media_cleanup c
        where c.creator_id is not distinct from ${ownerId}
      ${present ? sql`
      union all select o.key,null::bigint,o.event_id,
        case when exists(select 1 from media_asset_variants v where v.object_key=o.key and v.purpose='raw') then 'raw'
          when exists(select 1 from media_asset_variants v where v.object_key=o.key and v.purpose in ('original','legacy_source'))
            then case when r.mime like 'video/%' then 'video' else 'image' end else 'derivative' end,true
        from media_asset_objects o left join media_object_routes r on r.key=o.key
        where o.owner_id is not distinct from ${ownerId} and o.state<>'deleted'
        ` : sql``}
    ), measured as (
      select s.key,s.event_id,s.kind,s.strict,
        case when r.state='verified' and r.size>0 then r.size
          when s.strict then null
          when s.key like 'data:%;base64,%' then octet_length(decode(split_part(s.key,',',2),'base64'))
          when s.bytes>=0 then s.bytes else null end as bytes
      from sources s left join media_object_routes r on r.key=s.key
      where s.key is not null and s.key<>''
    ), physical as (
      select key,case when bool_or(strict and bytes is null) then null else max(bytes) end as bytes,min(event_id) as event_id,
        (array_agg(kind order by case kind when 'raw' then 0 when 'video' then 1 when 'image' then 2
          when 'derivative' then 3 when 'reference' then 4 when 'profile' then 5 else 6 end))[1] as kind
        from measured group by key
    ), objects as (
      select * from physical p where not exists(select 1 from reservations r
        where r.storage_key=p.key or r.thumbnail_key=p.key)
    ), reserved_usage as (
      select r.id,greatest(r.reserved_bytes,coalesce(sum(p.bytes),0)) as bytes,
        count(*) filter(where p.key is not null and p.bytes is null)::int as unknown
        from reservations r left join physical p on p.key=r.storage_key or p.key=r.thumbnail_key group by r.id,r.reserved_bytes
    ), types as (
      select kind,coalesce(sum(bytes),0)::text as bytes,count(*)::int as objects,
        count(*) filter(where bytes is null)::int as unknown from objects group by kind
    ), galleries as (
      select event_id,coalesce(sum(bytes),0)::text as bytes,count(*) filter(where bytes is null)::int as unknown
        from objects where event_id is not null group by event_id
    )
    select coalesce(sum(bytes),0)::text as retained_bytes,
      (count(*) filter(where bytes is null)+(select coalesce(sum(unknown),0) from reserved_usage))::int as unknown,
      (select coalesce(sum(bytes),0)::text from reserved_usage) as reserved_bytes,
      (select count(*)::int from reservations) as reservations,
      (select count(*)::int from media_cleanup c where c.creator_id is not distinct from ${ownerId}) as pending_cleanup,
      (select coalesce(sum(bytes),0)::text from objects where kind='cleanup') as cleanup_bytes,
      (select coalesce(jsonb_agg(types order by kind),'[]'::jsonb) from types) as by_type,
      (select coalesce(jsonb_agg(galleries order by event_id),'[]'::jsonb) from galleries) as by_gallery
      from objects`);
  const row = result.rows[0];
  const number = (value: unknown) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Storage usage exceeds safe byte range");
    return parsed;
  };
  const retainedBytes = number(row.retained_bytes), reservedBytes = number(row.reserved_bytes);
  return {
    bytes: number(retainedBytes + reservedBytes), retainedBytes, reservedBytes,
    reservations: number(row.reservations), unknown: number(row.unknown),
    pendingCleanup: number(row.pending_cleanup), cleanupBytes: number(row.cleanup_bytes),
    byType: row.by_type.map((r: any) => ({type: String(r.kind), bytes:number(r.bytes), objects:number(r.objects), unknown:number(r.unknown)})),
    byGallery: row.by_gallery.map((r: any) => ({eventId:number(r.event_id), bytes:number(r.bytes), unknown:number(r.unknown)})),
  };
}
