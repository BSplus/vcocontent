import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { events, mediaItems, mediaObjectRoutes, mediaAssetRecords, mediaAssetObjects,
  mediaAssetVariants } from "@shared/schema";
import { assertGalleryOwnership, type GalleryOwnership } from "@shared/gallery-ownership";
import { assetKind, assertAssetPurpose, assertAssetObjectFormat, assetTitle, legacyAssetVariants, type AssetPurpose } from "@shared/media-asset";
import { ObjectStoreError } from "./object-store";
import { lockedCreatorBudget } from "./beta-policy";
import { assertRawPairSelection, type RawPairSelection } from "./raw-pairing";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Connection = typeof db | Transaction;

async function foundationAvailable(connection: Connection) {
  const result = await connection.execute(sql`select to_regclass('media_asset_records') as records,
    to_regclass('media_asset_objects') as objects, to_regclass('media_asset_variants') as variants`);
  const {records, objects, variants} = result.rows[0];
  if (!records && !objects && !variants) return false;
  if (!records || !objects || !variants) throw new Error("Asset foundation schema is incomplete");
  return true;
}

async function lockedAsset(tx: Transaction, mediaId: number, expected: GalleryOwnership) {
  if (!Number.isSafeInteger(mediaId) || mediaId <= 0) throw new Error("Invalid asset identity");
  // Existing reservation convention: gallery before media; no uploader-derived owner.
  const [gallery] = await tx.select().from(events).where(eq(events.id, expected.galleryId)).for("update");
  assertGalleryOwnership(gallery, expected);
  const [item] = await tx.select().from(mediaItems).where(eq(mediaItems.id, mediaId)).for("update");
  if (!item || item.eventId !== expected.galleryId) throw new Error("Asset gallery mismatch");
  return item;
}

function assertVerified(route: typeof mediaObjectRoutes.$inferSelect | undefined) {
  if (!route || route.state !== "verified" || !["replit", "r2"].includes(route.provider) ||
      !route.sha256 || !/^[a-f0-9]{64}$/.test(route.sha256) || !route.objectVersion ||
      !Number.isSafeInteger(route.size) || Number(route.size) <= 0 || !route.mime)
    throw new ObjectStoreError("integrity");
  return route;
}

/**
 * Internal repository, NOT a new upload or authorization endpoint. Callers must
 * authorize management and pass a server-derived ownership snapshot. Native
 * JPEG intake uses this repository; RAW intake/delivery remain disabled.
 */
export async function linkAssetObject(input: {
  mediaId:number; ownership:GalleryOwnership; key:string; purpose:AssetPurpose;
  sourceVersion:number; sourceKey?:string; sha256:string; objectVersion:string;
  rawSelection?:RawPairSelection;
}, transaction?: Transaction) {
  if (!Number.isSafeInteger(input.sourceVersion) || input.sourceVersion <= 0 ||
      input.sourceVersion > 2_147_483_647) throw new Error("Invalid source version");
  const register = async (tx:Transaction) => {
    // Same owner-before-gallery order as upload reservations.
    if (input.ownership.ownerId !== null) await lockedCreatorBudget(tx,input.ownership.ownerId);
    const item = await lockedAsset(tx, input.mediaId, input.ownership);
    assertAssetPurpose(assetKind(item.type), input.purpose);
    const primary = ["original", "legacy_source"].includes(input.purpose);
    if (primary ? input.sourceKey !== undefined : !input.sourceKey) throw new Error("Invalid source relationship");
    // Global key lock serializes conflicting registrations across galleries.
    const lockedRoutes = await tx.select().from(mediaObjectRoutes)
      .where(inArray(mediaObjectRoutes.key, Array.from(new Set([input.key, ...(input.sourceKey ? [input.sourceKey] : [])]))))
      .orderBy(mediaObjectRoutes.key).for("update");
    const rawRoute = lockedRoutes.find(route => route.key === input.key);
    const route = assertVerified(rawRoute);
    assertAssetObjectFormat(assetKind(item.type), input.purpose, input.key, route.mime!);
    if (route.sha256 !== input.sha256 || route.objectVersion !== input.objectVersion)
      throw new Error("Object source changed");
    if (input.sourceKey) {
      const [source] = await tx.select().from(mediaAssetVariants).where(and(
        eq(mediaAssetVariants.mediaId, item.id), eq(mediaAssetVariants.sourceVersion, input.sourceVersion),
        eq(mediaAssetVariants.objectKey, input.sourceKey),
        sql`${mediaAssetVariants.purpose} in ('original','legacy_source')`));
      const [physical] = await tx.select().from(mediaAssetObjects).where(eq(mediaAssetObjects.key, input.sourceKey));
      if (!source || !physical || physical.state !== "retained" ||
          physical.eventId !== input.ownership.galleryId || physical.ownerId !== input.ownership.ownerId)
        throw new Error("Source must belong to the same asset revision and owner");
      const sourceRoute = assertVerified(lockedRoutes.find(route => route.key === input.sourceKey));
      if (input.purpose === "raw" && sourceRoute.mime !== "image/jpeg")
        throw new Error("RAW requires a JPEG source");
      if (input.purpose === "raw") {
        assertRawPairSelection(input.rawSelection,{mediaId:item.id,sourceVersion:input.sourceVersion,
          jpegKey:input.sourceKey,jpegSha256:sourceRoute.sha256!,
          rawKey:input.key,rawSha256:route.sha256!});
        // The already locked object route serializes concurrent pair attempts.
        // RAW is one photo's variant, not a shared attachment across identities.
        const [other] = await tx.select({id:mediaAssetVariants.id}).from(mediaAssetVariants)
          .where(and(eq(mediaAssetVariants.objectKey,input.key),sql`${mediaAssetVariants.mediaId}<>${item.id}`)).limit(1);
        if (other) throw new Error("RAW object is already paired to another photo");
      }
    } else {
      const [root] = await tx.select().from(mediaAssetVariants).where(and(
        eq(mediaAssetVariants.mediaId,item.id), eq(mediaAssetVariants.sourceVersion,input.sourceVersion),
        sql`${mediaAssetVariants.purpose} in ('original','legacy_source')`));
      if (root && (root.purpose !== input.purpose || root.objectKey !== input.key))
        throw new Error("Immutable asset source conflict");
    }
    const [existing] = await tx.select().from(mediaAssetObjects).where(eq(mediaAssetObjects.key, input.key));
    if (existing && (existing.eventId !== input.ownership.galleryId ||
        existing.category !== input.ownership.category || existing.ownerId !== input.ownership.ownerId ||
        existing.state !== "retained")) throw new Error("Physical object ownership or lifecycle conflict");
    if (!existing) await tx.insert(mediaAssetObjects).values({key:input.key,
      eventId:input.ownership.galleryId, category:input.ownership.category, ownerId:input.ownership.ownerId});
    await tx.insert(mediaAssetRecords).values({mediaId:item.id}).onConflictDoNothing();
    const [previous] = await tx.select().from(mediaAssetVariants).where(and(
      eq(mediaAssetVariants.mediaId,item.id), eq(mediaAssetVariants.purpose,input.purpose),
      eq(mediaAssetVariants.sourceVersion,input.sourceVersion)));
    if (previous) {
      if (previous.objectKey !== input.key || previous.sourceKey !== (input.sourceKey ?? null))
        throw new Error("Immutable asset revision conflict");
      return previous;
    }
    const [variant] = await tx.insert(mediaAssetVariants).values({mediaId:item.id, objectKey:input.key,
      purpose:input.purpose, sourceVersion:input.sourceVersion, sourceKey:input.sourceKey ?? null}).returning();
    if (input.ownership.ownerId !== null)
      await lockedCreatorBudget(tx,input.ownership.ownerId,0,0,0,0,true);
    return variant;
  };
  return transaction ? register(transaction) : db.transaction(register);
}

export async function setAssetTitle(mediaId:number, ownership:GalleryOwnership, title:string|null) {
  const value = assetTitle(title);
  await db.transaction(async tx => {
    await lockedAsset(tx,mediaId,ownership);
    await tx.insert(mediaAssetRecords).values({mediaId,title:value})
      .onConflictDoUpdate({target:mediaAssetRecords.mediaId,set:{title:value}});
  });
}

/** Private compatibility reader; does not grant delivery, publication or safety. */
export async function readMediaAsset(mediaId:number) {
  return db.transaction(async tx => {
    const [item] = await tx.select().from(mediaItems).where(eq(mediaItems.id,mediaId));
    if (!item) return undefined;
    const legacy = legacyAssetVariants(item);
    if (!await foundationAvailable(tx)) return {item, kind:assetKind(item.type), title:null, variants:[], legacy};
    const [record] = await tx.select().from(mediaAssetRecords).where(eq(mediaAssetRecords.mediaId,mediaId));
    const variants = await tx.select({link:mediaAssetVariants, object:mediaAssetObjects, route:mediaObjectRoutes})
      .from(mediaAssetVariants).innerJoin(mediaAssetObjects,eq(mediaAssetVariants.objectKey,mediaAssetObjects.key))
      .innerJoin(mediaObjectRoutes,eq(mediaAssetObjects.key,mediaObjectRoutes.key))
      .where(eq(mediaAssetVariants.mediaId,mediaId)).orderBy(mediaAssetVariants.sourceVersion,mediaAssetVariants.id);
    return {item, kind:assetKind(item.type), title:record?.title ?? null, variants, legacy};
  }, {isolationLevel:"repeatable read", accessMode:"read only"});
}

/** Aggregate-only preview. No writes, provider requests, media download or backfill. */
export async function previewAssetReconciliation(ownership:GalleryOwnership) {
  return db.transaction(async tx => {
    const [gallery] = await tx.select().from(events).where(eq(events.id,ownership.galleryId));
    assertGalleryOwnership(gallery,ownership);
    const available = await foundationAvailable(tx);
    const legacy = await tx.execute(sql`select count(*)::int as count from media_items m
      where m.event_id=${ownership.galleryId} ${available ? sql`and not exists (
        select 1 from media_asset_variants v where v.media_id=m.id)` : sql``}`);
    if (!available) return {schema:"legacy" as const, physicalObjects:0, retainedBytes:0,
      unknownObjects:0, ownershipConflicts:0, unmappedMedia:Number(legacy.rows[0].count)};
    const result = await tx.execute(sql`select count(*)::int as objects,
      coalesce(sum(r.size) filter (where r.size > 0 and r.state='verified'),0)::text as bytes,
      count(*) filter (where r.size is null or r.size <= 0 or r.state <> 'verified'
        or coalesce(r.sha256,'') !~ '^[a-f0-9]{64}$' or coalesce(r.object_version,'')=''
        or coalesce(r.mime,'')='' or r.provider not in ('replit','r2'))::int as unknown,
      count(*) filter (where o.category <> ${ownership.category}
        or o.owner_id is distinct from ${ownership.ownerId})::int as conflicts
      from media_asset_objects o join media_object_routes r on r.key=o.key
      where o.event_id=${ownership.galleryId} and o.state <> 'deleted'`);
    const row = result.rows[0];
    const retainedBytes = Number(row.bytes);
    if (!Number.isSafeInteger(retainedBytes)) throw new Error("Usage exceeds safe byte range");
    return {schema:"foundation" as const, physicalObjects:Number(row.objects), retainedBytes,
      unknownObjects:Number(row.unknown), ownershipConflicts:Number(row.conflicts),
      unmappedMedia:Number(legacy.rows[0].count)};
  }, {isolationLevel:"repeatable read", accessMode:"read only"});
}

/** Optional-schema guard for every routed physical deletion, including cleanup. */
export async function assertAssetObjectDeletable(key:string, execute:(statement:ReturnType<typeof sql>) => Promise<{rows:Record<string,unknown>[]}>) {
  const result = await execute(sql`select to_regclass('media_asset_objects') as name`);
  if (!result.rows[0]?.name) return;
  const objects = await execute(sql`select key from media_asset_objects where key=${key} for update`);
  if (objects.rows.length) throw new ObjectStoreError("retained");
}
