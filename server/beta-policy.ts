import { sql } from "drizzle-orm";
import { db } from "./db";
import { mediaPolicy, MediaLimitError } from "./media-policy";
import { events, users, mediaItems } from "@shared/schema";
import { verificationConfigured } from "./beta-config";
import { SAFETY_POLICY } from "@shared/safety-policy";
import { retainedStorageUsage } from "./retained-storage";

// Invalidates results from before incomplete visual inspections became non-approvable.
export { SAFETY_POLICY };
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
export function safeState(item: {archivedAt?: unknown; safetyStatus: string; safetyPolicy: string | null; contentVersion: number; safetyVersion: number}) {
  return !item.archivedAt && (item.safetyStatus === "legacy" || (item.safetyStatus === "approved" &&
    item.safetyPolicy === SAFETY_POLICY && item.contentVersion === item.safetyVersion));
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
export const activeMediaPredicate = () => sql`${mediaItems.archivedAt} is null`;
export const publicMediaPredicate = () => sql`(${activeMediaPredicate()} and (${events.creatorId} is null or (
  ${mediaItems.safetyStatus}='legacy' or (${mediaItems.safetyStatus}='approved'
    and ${mediaItems.safetyPolicy}=${SAFETY_POLICY} and ${mediaItems.contentVersion}=${mediaItems.safetyVersion}
    and ${verificationConfigured()} and exists(select 1 from users vu where vu.id=${events.creatorId} and vu.email_verified_at is not null)))))`;

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
  const usage = await retainedStorageUsage(executor, creatorId);
  const result = await executor.execute(sql`
    select
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
  return {...usage,galleries:Number(row.galleries),photos:Number(row.photos)};
}
export async function lockedCreatorBudget(tx: any, creatorId: number, bytes = 0, photos = 0, galleries = 0, replacementCredit = 0, checkCurrent = false) {
  const result = await tx.execute(sql`select is_admin,quota_exception,suspended,creator_status from users where id=${creatorId} for update`);
  const user = result.rows[0];
  if (!user || user.suspended || user.creator_status === "rejected") throw new MediaLimitError("Creator access is blocked.", "permission");
  if (user.is_admin) return;
  if (!bytes && !photos && !galleries && !replacementCredit && !checkCurrent) return;
  const limits = communityLimitsFor(user.quota_exception);
  const used = await creatorUsage(tx,creatorId);
  // A replacement cannot keep accumulating undeleted previous objects.
  if (used.pendingCleanup && replacementCredit) bytes += replacementCredit;
  if (galleries && used.galleries+galleries>limits.galleries) throw new MediaLimitError(`You have reached the maximum of ${limits.galleries} galleries.`);
  if (photos && used.photos+photos>limits.photos) throw new MediaLimitError(`You have reached the maximum of ${limits.photos.toLocaleString("en-US")} photos.`);
  if ((bytes !== 0 || checkCurrent) && (used.unknown || used.bytes+bytes>limits.bytes)) throw new MediaLimitError(used.unknown
    ? used.pendingCleanup ? "Storage cleanup is pending. Try again shortly or ask an administrator." : "Storage usage needs an administrator check before more files can be uploaded."
    : `Your storage is full (${limits.bytes/1_000_000} MB).`, used.unknown ? used.pendingCleanup ? "storage_cleanup" : "storage_unknown" : "storage_full");
}
