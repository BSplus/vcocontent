import { sql } from "drizzle-orm";
import { db } from "./db";
import { mediaPolicy, MediaLimitError } from "./media-policy";
import { events, users, mediaItems } from "@shared/schema";
import { verificationConfigured } from "./beta-config";

// Invalidates results from before incomplete visual inspections became non-approvable.
export const SAFETY_POLICY = "vco-community-safety-2";
export const communityLimits = Object.freeze({
  bytes: 500_000_000, galleries: 5, photos: 1_000, imageBytes: 5_000_000,
});
/** The sole beta exception doubles capacity, never file size or video rights. */
export const communityLimitsFor = (exception: boolean) => exception ?
  {...communityLimits,bytes:1_000_000_000,galleries:10,photos:2_000} : communityLimits;
export function creatorAllowed(user: {isAdmin?: boolean; isCreator?: boolean; creatorStatus?: string | null; suspended?: boolean} | undefined) {
  return !!user && !user.suspended && (user.isAdmin ||
    (user.creatorStatus !== "rejected" && (user.isCreator || user.creatorStatus === "approved")));
}
export function safeState(item: {safetyStatus: string; safetyPolicy: string | null; contentVersion: number; safetyVersion: number}) {
  return item.safetyStatus === "legacy" || (item.safetyStatus === "approved" &&
    item.safetyPolicy === SAFETY_POLICY && item.contentVersion === item.safetyVersion);
}
export function safetyRetryAllowed(item: Parameters<typeof safeState>[0]) {
  return item.safetyStatus==="error" || (
    (item.safetyStatus==="approved" || item.safetyStatus==="review") &&
    (item.safetyPolicy!==SAFETY_POLICY || item.contentVersion!==item.safetyVersion));
}
export const publicEventPredicate = () => sql`(not ${events.adminHidden} and (${events.creatorId} is null or (
  ${events.visibility} = 'published' and not ${events.adminHidden}
  and (${events.safetyStatus}='legacy' or (${events.safetyStatus}='approved'
    and ${events.safetyPolicy}=${SAFETY_POLICY} and ${events.contentVersion}=${events.safetyVersion}
    and ${verificationConfigured()} and exists(select 1 from users vu where vu.id=${events.creatorId} and vu.email_verified_at is not null)))
  and exists(select 1 from users bu where bu.id=${events.creatorId}
    and not bu.suspended and coalesce(bu.creator_status,'none') <> 'rejected'))))`;
export const publicMediaPredicate = () => sql`(${events.creatorId} is null or (
  ${mediaItems.safetyStatus}='legacy' or (${mediaItems.safetyStatus}='approved'
    and ${mediaItems.safetyPolicy}=${SAFETY_POLICY} and ${mediaItems.contentVersion}=${mediaItems.safetyVersion}
    and ${verificationConfigured()} and exists(select 1 from users vu where vu.id=${events.creatorId} and vu.email_verified_at is not null))))`;

/** Persistent cross-process sliding buckets; reserve before provider/file work. */
export async function takeBetaRate(key: string, limit: number, windowMs: number) {
  const result = await db.execute(sql`insert into beta_rate_limits(key,count,reset_at)
    values (${key},1,now()+${windowMs} * interval '1 millisecond')
    on conflict(key) do update set
      count=case when beta_rate_limits.reset_at<=now() then 1 else beta_rate_limits.count+1 end,
      reset_at=case when beta_rate_limits.reset_at<=now() then excluded.reset_at else beta_rate_limits.reset_at end
    where beta_rate_limits.reset_at<=now() or beta_rate_limits.count<${limit} returning key`);
  return result.rows.length > 0;
}

/** One ledger derived from unique persistent keys, never from client claims.
 * Unknown old sizes fail closed until measured by an admin, not counted as 0.
 * Inlined historical sources use decoded Base64 length (padding removed).
 */
export async function creatorUsage(executor: any, creatorId: number) {
  const result = await executor.execute(sql`
    with objects as (
      select regexp_replace(m.url,'^/api/media/files/','') as key, max(coalesce(m.high_bytes,
        case when m.url like 'data:%' then
          octet_length(decode(split_part(m.url,',',2),'base64')) else null end))::bigint as bytes
        from media_items m join events e on e.id=m.event_id where e.creator_id=${creatorId} group by m.url
      union all
      select regexp_replace(m.thumbnail,'^/api/media/files/',''), max(coalesce(m.low_bytes,
        case when m.thumbnail like 'data:%' then
          octet_length(decode(split_part(m.thumbnail,',',2),'base64')) else null end))::bigint
        from media_items m join events e on e.id=m.event_id where e.creator_id=${creatorId} group by m.thumbnail
      union all
      select source_key,max(stored_bytes) from reference_documents
        where owner_id=${creatorId} and source_key is not null group by source_key
      union all
      select profile_image,octet_length(decode(split_part(profile_image,',',2),'base64'))::bigint
        from users where id=${creatorId} and profile_image like 'data:%;base64,%'
      union all
      select profile_cover_image,octet_length(decode(split_part(profile_cover_image,',',2),'base64'))::bigint
        from users where id=${creatorId} and profile_cover_image like 'data:%;base64,%'
      union all
      select c.key,max(c.stored_bytes) from media_cleanup c where c.creator_id=${creatorId}
        and not exists(select 1 from media_reservations r where r.storage_key=c.key or r.thumbnail_key=c.key)
        group by c.key
    ), unique_objects as (select key,max(bytes) as bytes from objects group by key)
    select (select coalesce(sum(bytes),0) from unique_objects) +
      (select coalesce(sum(reserved_bytes),0) from media_reservations where creator_id=${creatorId}) as bytes,
      (select count(*) from unique_objects where bytes is null) as unknown,
      (select count(*) from media_cleanup c where c.creator_id=${creatorId}
        and not exists(select 1 from media_reservations r where r.storage_key=c.key or r.thumbnail_key=c.key)) as pending_cleanup,
      (select count(*) from events where creator_id=${creatorId}) as galleries,
      (select count(*) from media_items m join events e on e.id=m.event_id
        where e.creator_id=${creatorId} and m.type='image') +
      (select count(distinct c.photo_token) from media_cleanup c where c.creator_id=${creatorId}
        and c.photo_token is not null
        and not exists(select 1 from media_items m where 'item:'||m.id=c.photo_token)
        and not exists(select 1 from media_reservations r where r.storage_key=c.key or r.thumbnail_key=c.key))+
      (select count(*) from media_reservations where creator_id=${creatorId}
        and storage_key like 'media-%') as photos`);
  const row = result.rows[0];
  return {bytes:Number(row.bytes), unknown:Number(row.unknown), pendingCleanup:Number(row.pending_cleanup),galleries:Number(row.galleries),photos:Number(row.photos)};
}
export async function lockedCreatorBudget(tx: any, creatorId: number, bytes = 0, photos = 0, galleries = 0, replacementCredit = 0) {
  const result = await tx.execute(sql`select is_admin,quota_exception,suspended,creator_status from users where id=${creatorId} for update`);
  const user = result.rows[0];
  if (!user || user.suspended || user.creator_status === "rejected") throw new MediaLimitError("Creator access is blocked.");
  if (user.is_admin) return;
  const limits = communityLimitsFor(user.quota_exception);
  const used = await creatorUsage(tx,creatorId);
  // A replacement cannot keep accumulating undeleted previous objects.
  if (used.pendingCleanup && replacementCredit) bytes += replacementCredit;
  if (galleries && used.galleries+galleries>limits.galleries) throw new MediaLimitError(`You have reached the maximum of ${limits.galleries} galleries.`);
  if (photos && used.photos+photos>limits.photos) throw new MediaLimitError(`You have reached the maximum of ${limits.photos.toLocaleString("en-US")} photos.`);
  if (bytes && (used.unknown || used.bytes+bytes>limits.bytes)) throw new MediaLimitError(used.unknown
    ? used.pendingCleanup ? "Storage cleanup is pending. Try again shortly or ask an administrator." : "Storage usage needs an administrator check before more files can be uploaded."
    : `Your storage is full (${limits.bytes/1_000_000} MB).`);
}
