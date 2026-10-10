import type { Express } from "express";
import { and, eq, sql, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "./db";
import { communityLikes as likes, communityFavorites as favorites, downloadOperations, downloadHistory, mediaItems, events } from "@shared/schema";
import { storage } from "./storage";
import { eventPublic, mediaPublic } from "./beta-access";
import { publicEventPredicate, publicMediaPredicate } from "./beta-policy";
import { requireAuth } from "./middleware/auth";
import { registerCommunityProfile } from "./community-profile";

const preview = (id:number, thumbnail:string) => thumbnail.startsWith("data:") ? `/api/media/legacy/${id}/thumbnail` : thumbnail;
export async function communityTarget(kind:string,id:number) {
  if (!Number.isSafeInteger(id) || id<1) return false;
  if (kind==="event") {
    const event=await storage.getEvent(id);
    return !!event && !event.isPremium && await eventPublic(event);
  }
  if (kind!=="media") return false;
  const item=await storage.getMediaItem(id);
  const event=item?.eventId ? await storage.getEvent(item.eventId) : undefined;
  return !!item && item.type==="image" && !item.isPremium && !!event && !event.isPremium && await mediaPublic(item,event);
}
async function state(kind:string,id:number,userId?:number) {
  const column=kind==="media"?"mediaId":"eventId";
  const [count]=await db.select({count:sql<number>`count(*)::int`}).from(likes).where(eq(likes[column],id));
  const [liked,saved]=userId ? await Promise.all([
    db.select({id:likes.id}).from(likes).where(and(eq(likes[column],id),eq(likes.userId,userId))).limit(1),
    db.select({id:favorites.id}).from(favorites).where(and(eq(favorites[column],id),eq(favorites.userId,userId))).limit(1),
  ]) : [[],[]];
  return {count:count.count,liked:!!liked.length,saved:!!saved.length};
}
export async function issueDownloadOperation(userId:number,mediaId:number,quality:string) {
  // Expiring authorizations are not history; history has a separate retention review.
  await db.delete(downloadOperations).where(sql`${downloadOperations.createdAt}<now()-interval '1 hour'`);
  const id=randomUUID();
  await db.insert(downloadOperations).values({id,userId,mediaId,quality});
  return id;
}
export async function validDownloadOperation(id:unknown,userId:number,mediaId:number,quality:string) {
  if (typeof id!=="string" || !/^[0-9a-f-]{36}$/.test(id)) return false;
  const [row]=await db.select({id:downloadOperations.id}).from(downloadOperations).where(and(
    eq(downloadOperations.id,id),eq(downloadOperations.userId,userId),eq(downloadOperations.mediaId,mediaId),
    eq(downloadOperations.quality,quality),sql`${downloadOperations.createdAt}>now()-interval '1 hour'`));
  return !!row;
}
export async function recordDownload(userId:number,mediaId:number,quality:string,operationId:string) {
  return db.transaction(async tx=>{
    const inserted=await tx.insert(downloadHistory).values({userId,mediaId,quality,operationId}).onConflictDoNothing().returning({id:downloadHistory.id});
    if (inserted.length) await tx.update(mediaItems).set({downloadCount:sql`least(${mediaItems.downloadCount}+1,2147483647)`}).where(eq(mediaItems.id,mediaId));
    return !!inserted.length;
  });
}
export function registerCommunityRoutes(app:Express) {
  registerCommunityProfile(app);
  app.get("/api/community/:kind/:id",async(req,res)=>{
    try {
      const {kind,id}=req.params;
      if (!await communityTarget(kind,Number(id))) return res.status(404).json({error:"Content is unavailable."});
      res.json(await state(kind,Number(id),req.user?.suspended?undefined:req.user?.id));
    } catch {res.status(503).json({error:"Community actions could not be loaded."});}
  });
  for (const action of ["like","favorite"] as const) for (const method of ["put","delete"] as const) {
    app[method](`/api/community/:kind/:id/${action}`,requireAuth,async(req,res)=>{
      try {
        const {kind,id:raw}=req.params; const id=Number(raw);
        if (!await communityTarget(kind,id)) return res.status(404).json({error:"Content is unavailable."});
        const table=action==="like"?likes:favorites;
        const column=kind==="media"?"mediaId":"eventId";
        if (method==="put") await db.insert(table).values({userId:req.user!.id,[column]:id}).onConflictDoNothing();
        else await db.delete(table).where(and(eq(table.userId,req.user!.id),eq(table[column],id)));
        res.json(await state(kind,id,req.user!.id));
      } catch {res.status(503).json({error:"Your change could not be saved."});}
    });
  }
  for (const section of ["favorites","downloads"] as const) app.get(`/api/account/${section}`,requireAuth,async(req,res)=>{
    try {
      const page=Number(req.query.page ?? 1);
      if (!Number.isSafeInteger(page)||page<1||page>100000) return res.status(400).json({error:"Invalid page."});
      const table=section==="favorites"?favorites:downloadHistory;
      const rows=await db.select({
        rowId:table.id,mediaId:mediaItems.id,eventId:events.id,title:events.title,caption:mediaItems.caption,
        thumbnail:mediaItems.thumbnail,date:table.createdAt,
        quality:section==="downloads"?downloadHistory.quality:sql<string>`null`,
      }).from(table)
        .leftJoin(mediaItems,eq(table.mediaId,mediaItems.id))
        .innerJoin(events,section==="favorites"
          ? sql`${events.id}=coalesce(${mediaItems.eventId},${favorites.eventId})`
          : eq(events.id,mediaItems.eventId))
        .where(and(eq(table.userId,req.user!.id),publicEventPredicate(),sql`(${mediaItems.id} is null or ${publicMediaPredicate()})`,
          eq(events.isPremium,false),sql`(${mediaItems.id} is null or not ${mediaItems.isPremium})`))
        .orderBy(desc(table.createdAt),desc(table.id)).limit(25).offset((page-1)*24);
      const items=await Promise.all(rows.slice(0,24).map(async row=>{
        // Never trust a saved external/gallery cover: resolve a currently public photo.
        const cover=row.mediaId ? undefined : (await storage.getPublicEventMediaItems(row.eventId,1,1))[0];
        return {kind:row.mediaId?"media":"event",id:row.mediaId || row.eventId,historyId:section==="downloads"?row.rowId:undefined,
          title:row.caption || row.title,eventTitle:row.title,
          thumbnail:row.mediaId && row.thumbnail ? preview(row.mediaId,row.thumbnail) : cover?preview(cover.id,cover.thumbnail):null,
          date:row.date,quality:row.quality,href:row.mediaId?`/media/${row.mediaId}`:`/events/${row.eventId}`};
      }));
      res.json({items,hasMore:rows.length>24});
    } catch {res.status(503).json({error:"Your collection could not be loaded."});}
  });
}
