import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { events, mediaItems, referenceDocuments, mediaCleanup } from "@shared/schema";
import { readMediaStream } from "./media-storage";

/** Measures byte counts only; never sends historical contents to an AI service. */
export async function reconcileCreatorStorage(creatorId: number) {
  const measured = new Map<string,number>();
  const deadline=Date.now()+120000;
  let transferredBytes=0;
  const size = async (source: string) => {
    if (measured.has(source)) return measured.get(source)!;
    if (source.startsWith("data:")) {
      const match = /^data:[^,]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(source);
      if (!match || match[1].length>140*1048576) throw new Error("Unsupported historical source");
      const bytes = Buffer.from(match[1],"base64").length;
      measured.set(source,bytes); return bytes;
    }
    const key = source.startsWith("/api/media/files/") ? source.slice("/api/media/files/".length) : source;
    if (Date.now()>=deadline || transferredBytes>=2*1024*1048576) throw new Error("Measurement action budget exhausted");
    const stream = readMediaStream(key);
    const timeout = setTimeout(()=>stream.destroy(new Error("Size measurement timed out")),Math.max(1,deadline-Date.now()));timeout.unref();
    let bytes = 0;
    try {
      for await (const chunk of stream) {
        bytes += Buffer.byteLength(chunk);
        transferredBytes+=Buffer.byteLength(chunk);
        if (transferredBytes>2*1024*1048576) throw new Error("Source exceeds measurement budget");
      }
    } finally {clearTimeout(timeout);stream.destroy();}
    measured.set(source,bytes); return bytes;
  };
  const rows = await db.select({item:mediaItems}).from(mediaItems).innerJoin(events,eq(events.id,mediaItems.eventId))
    .where(eq(events.creatorId,creatorId)).limit(2001);
  const docs = await db.select().from(referenceDocuments).where(eq(referenceDocuments.ownerId,creatorId)).limit(501);
  let updated = 0, unresolved = 0;
  // Bound one admin action; repeat if a large historical account has more rows.
  const pending = rows.filter(r=>r.item.highBytes===null || r.item.lowBytes===null).slice(0,100);
  for (const {item} of pending) {
    try {
      const highBytes = await size(item.url), lowBytes = await size(item.thumbnail);
      await db.update(mediaItems).set({highBytes,lowBytes,storedBytes:highBytes+(item.url===item.thumbnail?0:lowBytes)})
        .where(and(eq(mediaItems.id,item.id),eq(mediaItems.url,item.url),eq(mediaItems.thumbnail,item.thumbnail)));
      updated++;
    } catch {unresolved++;}
  }
  for (const doc of docs.filter(d=>d.sourceKey && d.storedBytes===null).slice(0,100)) {
    try {
      const storedBytes = await size(doc.sourceKey!);
      await db.update(referenceDocuments).set({storedBytes})
        .where(and(eq(referenceDocuments.id,doc.id),eq(referenceDocuments.sourceKey,doc.sourceKey!)));
      updated++;
    } catch {unresolved++;}
  }
  const pendingCleanup = await db.select().from(mediaCleanup).where(eq(mediaCleanup.creatorId,creatorId)).limit(100);
  for (const item of pendingCleanup.filter(item=>item.storedBytes===null)) {
    try {
      const storedBytes=await size(item.key);
      await db.update(mediaCleanup).set({storedBytes}).where(and(eq(mediaCleanup.key,item.key),eq(mediaCleanup.creatorId,creatorId)));
      updated++;
    } catch {unresolved++;}
  }
  return {updated,unresolved};
}
