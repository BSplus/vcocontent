import { and, asc, count, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { events, mediaItems, users } from "@shared/schema";
import { publicEventPredicate, publicMediaPredicate } from "./beta-policy";

// Bounded SQL readers: no account emails, original files, AI identification or
// large profile images enter discovery lists. No TTL cache can outlive moderation.
export const SITEMAP_PAGE_SIZE = 500;
const eventFields = {
  id: events.id, title: events.title, description: events.description,
  date: events.date, creatorId: events.creatorId,
};
const imageFields = {
  id: mediaItems.id, eventId: mediaItems.eventId, caption: mediaItems.caption,
  photographer: mediaItems.photographer,
  // Historical Base64 is never transferred in a discovery query.
  thumbnail: sql<string>`case when ${mediaItems.thumbnail} like 'data:%'
    then '/api/media/legacy/' || ${mediaItems.id} || '/thumbnail'
    else ${mediaItems.thumbnail} end`,
};
const publicEvents = () => and(eq(events.isPremium, false), publicEventPredicate());
const publicImages = () => and(publicEvents(), publicMediaPredicate(),
  eq(mediaItems.isPremium, false), eq(mediaItems.type, "image"),
  sql`(${mediaItems.thumbnail} ~ '^/api/media/files/thumb-[0-9a-f-]{36}\\.webp$'
    or ${mediaItems.thumbnail} ~ '^/api/media/legacy/[1-9][0-9]*/thumbnail$'
    or ${mediaItems.thumbnail} like 'data:%')`);
const publicCreators = () => sql`not ${users.suspended} and
  coalesce(${users.creatorStatus},'none') <> 'rejected' and
  (${users.isAdmin} or ${users.isCreator} or ${users.creatorStatus}='approved')`;

export async function searchEvents(scope = "all", page = 1, limit = SITEMAP_PAGE_SIZE, creatorId?: number) {
  const now = new Date(), recent = new Date(now.getTime() - 28 * 86400000);
  const scopeFilter = scope === "current" ? and(gte(events.date, recent), lte(events.date, now))
    : scope === "upcoming" ? gte(events.date, now)
    : scope === "archive" ? lt(events.date, recent)
    : scope === "creator" ? sql`${events.creatorId} is not null` : undefined;
  return db.select(eventFields).from(events)
    .where(and(publicEvents(), scopeFilter, creatorId ? eq(events.creatorId, creatorId) : undefined))
    .orderBy(scope === "upcoming" ? asc(events.date) : desc(events.date), desc(events.id)).limit(limit).offset((page - 1) * limit);
}

export async function searchImages(eventId: number, page = 1, limit = SITEMAP_PAGE_SIZE) {
  return db.select(imageFields).from(mediaItems).innerJoin(events, eq(mediaItems.eventId, events.id))
    .where(and(publicImages(), eq(events.id, eventId)))
    .orderBy(desc(mediaItems.id)).limit(limit).offset((page - 1) * limit);
}

export async function searchCreators(page = 1, limit = SITEMAP_PAGE_SIZE) {
  return db.select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users).where(publicCreators()).orderBy(desc(users.id))
    .limit(limit).offset((page - 1) * limit);
}

export async function searchCounts() {
  const [eventTotal, creatorTotal, imageTotals] = await Promise.all([
    db.select({ total: count() }).from(events).where(publicEvents()),
    db.select({ total: count() }).from(users).where(publicCreators()),
    db.select({ id: events.id, total: count() }).from(mediaItems)
      .innerJoin(events, eq(mediaItems.eventId, events.id)).where(publicImages()).groupBy(events.id),
  ]);
  return { events: eventTotal[0].total, creators: creatorTotal[0].total, images: imageTotals };
}

export const searchData = { events: searchEvents, images: searchImages, creators: searchCreators, counts: searchCounts };
