import { User, Event, MediaItem, InsertUser, InsertEvent, InsertMediaItem, Series, InsertSeries, type UpdateSeries, type EntryRow } from "@shared/schema";
import { users, events, eventEntries, referenceDocuments, mediaItems, mediaReservations, mediaCleanup, nextcloudFiles, nextcloudJobs, mediaAnalysisJobs, series as seriesTable } from "@shared/schema";
import { analysisFingerprint, itemAnalysisFingerprint } from "./analysis-jobs";
import { isAITaggingConfigured } from "./utils/ai-tagger";
import { db } from "./db";
import { eq, and, or, sql, desc, lt, ilike, getTableColumns } from "drizzle-orm";
import { mediaPolicy, MediaLimitError } from "./media-policy";
import { deleteMediaObject, writeVideoPreview } from "./media-storage";
import { randomUUID } from "crypto";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { creatorUsage, lockedCreatorBudget, publicEventPredicate, publicMediaPredicate, activeMediaPredicate, SAFETY_POLICY } from "./beta-policy";
import { EventImageError, galleryFilePattern, galleryLegacyPattern, galleryThumbnailReference } from "./gallery-thumbnail-policy";
import { boundedGalleryThumbnailSql } from "@shared/media-query-policy";
import { planMediaSearchTerms } from "./media-search-plan";
import { effectiveEventChanges } from "@shared/event-changes";
import { enqueueTransactionalEmail } from "./transactional-emails";
import { assertNewMediaUploadsEnabled } from "./media-object-routing";
import { assertMediaTagsAllowed, withoutRetiredMediaTags } from "@shared/media-tag-policy";
import { activeMediaTagsSql } from "./media-tag-sql";
import { automaticPhotoMatching } from "./automatic-photo-matching";
import { matchedPhotoCaption } from "./caption-proposal";

type SafeUser = Omit<User, "password">;
type EventUpdateResult = Event & { saveStatus: "saved" | "unchanged" };
function objectKeys(item: { url: string; thumbnail: string }): string[] {
  return [item.url, item.thumbnail]
    .map(url => /^\/api\/media\/files\/((?:media|thumb)-[0-9a-f-]{36}\.(?:jpg|png|gif|webp|mp4|mov|webm))$/.exec(url)?.[1])
    .filter((key): key is string => !!key);
}
const mediaListColumns = {
  ...getTableColumns(mediaItems),
  tags: activeMediaTagsSql(mediaItems.tags),
  manualTags: activeMediaTagsSql(mediaItems.manualTags),
  suppressedAITags: activeMediaTagsSql(mediaItems.suppressedAITags),
  url: sql<string>`case when ${mediaItems.url} like 'data:%'
    then '/api/media/legacy/' || ${mediaItems.id} || '/file' else ${mediaItems.url} end`,
  thumbnail: sql<string>`case when ${mediaItems.type} = 'video' and ${mediaItems.thumbnail} like 'data:%'
    and ${mediaItems.thumbnail} not like 'data:image/%'
    then '/attached_assets/%2389_3.png'
    when ${mediaItems.thumbnail} like 'data:%'
    then '/api/media/legacy/' || ${mediaItems.id} || '/thumbnail' else ${mediaItems.thumbnail} end`,
};
type NewUser = Pick<InsertUser, "username" | "email" | "password"> &
  Partial<Pick<InsertUser, "bio" | "profileImage">> & {
    requestCreator?: boolean;
  };

interface IStorage {
  sessionStore: session.Store;

  // User management
  getUsers(): Promise<SafeUser[]>;
  getUser(id: number): Promise<SafeUser | undefined>;
  getAllUsers(): Promise<SafeUser[]>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: NewUser): Promise<SafeUser>;

  // Event management
  getEvents(): Promise<Event[]>;
   getEvent(id: number, includeImages?: boolean): Promise<Event | undefined>;
  createEvent(event: InsertEvent, entries?: EntryRow[]): Promise<Event>;
  updateEvent(id: number, event: Partial<InsertEvent>): Promise<EventUpdateResult>;
  deleteEvent(id: number): Promise<{ success: boolean; message: string }>;

  // Series management
  getSeries(id?: number): Promise<Series[] | Series | undefined>;
  createSeries(series: InsertSeries): Promise<Series>;
  updateSeries(id: number, series: UpdateSeries): Promise<Series>;
  deleteSeries(id: number): Promise<void>;

  // Media management
  getAllMediaItems(): Promise<MediaItem[]>;
  getMediaItems(eventId: number, page?: number, limit?: number): Promise<MediaItem[]>;
  getPublicEventMediaItems(eventId: number, page?: number, limit?: number): Promise<MediaItem[]>;
   getMediaItem(id: number, includeOriginal?: boolean): Promise<MediaItem | undefined>;
  createMediaItem(mediaItem: InsertMediaItem): Promise<MediaItem>;
  updateMediaItem(id: number, mediaItem: Partial<InsertMediaItem>): Promise<MediaItem>;
  deleteMediaItem(id: number): Promise<void>;

  // Creator management
  updateUserCreatorStatus(userId: number, status: 'pending' | 'approved' | 'rejected'): Promise<SafeUser>;
  getEventsByCreator(creatorId: number): Promise<Event[]>;
  updateUserCredits(userId: number, credits: number): Promise<SafeUser>;

  // Premium content management
  getCreatorEarnings(creatorId: number): Promise<{ totalCredits: number }>;
}

class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    const PostgresSessionStore = connectPgSimple(session);
    this.sessionStore = new PostgresSessionStore({
      conString: process.env.DATABASE_URL,
      // Reuse the existing connect-pg-simple table; create it on a fresh
      // production database. A second custom table would collide with the
      // package's fixed "session_pkey" constraint name.
      tableName: "session",
      createTableIfMissing: true,
      pruneSessionInterval: 15 * 60,
    });
  }

  // User management methods
  async getUsers(): Promise<SafeUser[]> {
    const result = await db.select().from(users);
    return result.map(({ password, ...user }) => user);
  }

  async getUser(id: number): Promise<SafeUser | undefined> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!result[0]) return undefined;
    const { password, ...user } = result[0];
    return user;
  }

  async getAllUsers(): Promise<SafeUser[]> {
    const result = await db.select().from(users).orderBy(desc(users.createdAt), desc(users.id));
    return result.map(({ password, ...user }) => user);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return result[0];
  }

  async createUser(user: NewUser): Promise<SafeUser> {
    // Explicitly select registration fields; role, balance, and status are
    // controlled by the server, never by request-body mass assignment.
    const result = await db.insert(users).values({
      username: user.username,
      email: user.email,
      password: user.password,
      bio: user.bio ?? null,
      profileImage: user.profileImage ?? null,
      isAdmin: false,
      isCreator: false,
      creatorStatus: user.requestCreator ? "pending" : "none",
      credits: "0",
    }).returning();

    const { password, ...safeUser } = result[0];
    return safeUser;
  }

  // Event management methods
  async getEvents(): Promise<Event[]> {
    return await db.select().from(events);
  }

  async getEvent(id: number, includeImages = true): Promise<Event | undefined> {
    const result = await db
      .select(includeImages ? getTableColumns(events) : {
        ...getTableColumns(events), customThumbnail: sql<string | null>`null`, coverImage: sql<string | null>`null`,
      })
      .from(events)
      .where(eq(events.id, id))
      .limit(1);
    return result[0];
  }

  async getEventEntries(eventId: number): Promise<EntryRow[]> {
    const rows = await db.select().from(eventEntries).where(eq(eventEntries.eventId, eventId)).orderBy(eventEntries.id);
    return rows.map(({ number, team, car, drivers, manufacturer, racingClass, discipline }) => ({ number, team, car, drivers, manufacturer, racingClass, discipline }));
  }

  async replaceEventEntries(eventId: number, rows: EntryRow[]): Promise<void> {
    await db.transaction(async tx => {
      const locked = await tx.execute(sql`select id from events where id = ${eventId} for update`);
      if (!locked.rows.length) throw new Error("Event not found");
      await tx.delete(eventEntries).where(eq(eventEntries.eventId, eventId));
      await tx.update(events).set({referenceRevision:sql`${events.referenceRevision}+1`}).where(eq(events.id,eventId));
      if (rows.length) await tx.insert(eventEntries).values(rows.map(row => ({ ...row, eventId })));
    });
  }

  async createEvent(event: InsertEvent, entries?: EntryRow[]): Promise<Event> {
    return db.transaction(async tx => {
      if (event.creatorId) await lockedCreatorBudget(tx,event.creatorId,0,0,1);
      const [created] = await tx.insert(events).values({...event,
        ...(event.creatorId ? {visibility:"draft",safetyStatus:"error",safetyReason:"Safety check pending."} : {})}).returning();
      if (entries?.length) await tx.insert(eventEntries).values(entries.map(row => ({ ...row, eventId: created.id })));
      return created;
    });
  }

  async updateEvent(id: number, event: Partial<InsertEvent>): Promise<EventUpdateResult> {
    return db.transaction(async tx => {
    const [before] = await tx.select().from(events).where(eq(events.id,id)).for("update");
    if (!before) throw new Error("Event not found");
    event = effectiveEventChanges(event, before);
    if (!Object.keys(event).length) return { ...before, saveStatus: "unchanged" };
    // Recheck under row locks at the write boundary, including concurrent moderation.
    for (const field of ["customThumbnail", "coverImage"] as const) {
      const value = event[field];
      if (!value || value === before[field]) continue;
      const file = galleryFilePattern.exec(value);
      const legacy = galleryLegacyPattern.exec(value);
      if (!file && !legacy) continue; // Official uploads were decoded by the route.
      const [photo] = await tx.select().from(mediaItems).where(and(activeMediaPredicate(),file
        ? eq(mediaItems.thumbnail, value) : eq(mediaItems.id, Number(legacy![1])))).for("share");
      if (!photo || galleryThumbnailReference(photo, { ...before, ...event }) !== value)
        throw new EventImageError("The selected photo is no longer eligible. Choose another gallery photo.");
    }
    const contextKeys=["title","date","seriesId","creatorId","referenceSeasonYear","round","track","platform"] as const;
    let changed=false;
    if (contextKeys.some(key=>event[key]!==undefined)) {
      if (before) {
        const after={...before,...event};
        const year=(e:typeof after)=>e.referenceSeasonYear ?? new Date(e.date).getUTCFullYear();
        changed=before.title!==after.title || before.seriesId!==after.seriesId ||
           before.creatorId!==after.creatorId || +new Date(before.date)!==+new Date(after.date) ||
           before.round!==after.round || before.track!==after.track || before.platform!==after.platform || year(before)!==year(after);
      }
    }
    const result = await tx
      .update(events)
      .set({...event,...(changed?{referenceRevision:sql`${events.referenceRevision}+1`}:{}),
         ...(["title","description","round","track","platform"].some(key=>key in event) ? {
          contentVersion:sql`${events.contentVersion}+1`,safetyStatus:sql`case when ${events.creatorId} is not null then 'error' else ${events.safetyStatus} end`,
          safetyReason:sql`case when ${events.creatorId} is not null then 'Safety check pending.' else ${events.safetyReason} end`,
        } : {})})
      .where(eq(events.id, id))
      .returning();

    if (result.length === 0) {
      throw new Error("Event not found");
    }

    return { ...result[0], saveStatus: "saved" };
    });
  }

  async deleteEvent(id: number): Promise<{ success: boolean; message: string }> {
    try {
      if (isNaN(id) || id <= 0) {
        return {
          success: false,
          message: "Invalid event ID provided"
        };
      }

      // Verify the event exists before deletion
      const eventExists = await db
        .select()
        .from(events)
        .where(eq(events.id, id))
        .limit(1);

      if (eventExists.length === 0) {
        return {
          success: false,
          message: "Event not found"
        };
      }

      await db.transaction(async tx => {
        if (eventExists[0].creatorId) await tx.execute(sql`select id from users where id=${eventExists[0].creatorId} for update`);
        await tx.execute(sql`select id from events where id = ${id} for update`);
        const archived = await tx.execute(sql`select id from media_items where event_id=${id} and archived_at is not null limit 1`);
        if (archived.rows.length) throw new Error("Restore archived media before deleting this gallery.");
        const documents = await tx.select({key:referenceDocuments.sourceKey,bytes:referenceDocuments.storedBytes}).from(referenceDocuments)
          .where(eq(referenceDocuments.eventId,id));
        for (const doc of documents) if (doc.key) await tx.insert(mediaCleanup).values({key:doc.key,creatorId:eventExists[0].creatorId,storedBytes:doc.bytes}).onConflictDoNothing();
        const keys = await tx.select({ id:mediaItems.id,type:mediaItems.type,url: mediaItems.url, thumbnail: mediaItems.thumbnail,highBytes:mediaItems.highBytes,lowBytes:mediaItems.lowBytes })
          .from(mediaItems).where(eq(mediaItems.eventId, id));
        for (const row of keys) for (const key of objectKeys(row)) {
          await tx.insert(mediaCleanup).values({ key,creatorId:eventExists[0].creatorId,storedBytes:row.url.endsWith(key)?row.highBytes:row.lowBytes,
            photoToken:row.type==="image"?`item:${row.id}`:null }).onConflictDoNothing();
        }
        await tx.delete(mediaItems).where(eq(mediaItems.eventId, id));
        await tx.delete(events).where(eq(events.id, id));
      });
      void this.cleanupObjects().catch(error => console.error("Media cleanup failed:", error));

      return {
        success: true,
        message: "Event and associated media items deleted successfully"
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Failed to delete event"
      };
    }
  }

  // Series management methods
  async getSeries(id?: number): Promise<Series[] | Series | undefined> {
    if (id) {
      const result = await db
        .select()
        .from(seriesTable)
        .where(eq(seriesTable.id, id))
        .limit(1);
      return result[0];
    } else {
      return await db.select().from(seriesTable);
    }
  }

  async createSeries(series: InsertSeries): Promise<Series> {
    const result = await db.insert(seriesTable).values(series).returning();
    return result[0];
  }

  async updateSeries(id: number, series: UpdateSeries): Promise<Series> {
    const result = await db
      .update(seriesTable)
      .set(series)
      .where(eq(seriesTable.id, id))
      .returning();

    if (result.length === 0) {
      throw new Error("Series not found");
    }

    if (series.name!==undefined) await db.update(events).set({referenceRevision:sql`${events.referenceRevision}+1`}).where(eq(events.seriesId,id));
    return result[0];
  }

  async deleteSeries(id: number): Promise<void> {
    // First update all events that reference this series
    await db
      .update(events)
      .set({ seriesId: null,referenceRevision:sql`${events.referenceRevision}+1` })
      .where(eq(events.seriesId, id));

    // Then delete the series
    await db.delete(seriesTable).where(eq(seriesTable.id, id));
  }

  // Media management methods
  async getAllMediaItems(page = 1, limit = 48): Promise<MediaItem[]> {
    return await db.select(mediaListColumns).from(mediaItems).where(activeMediaPredicate()).orderBy(desc(mediaItems.id)).limit(limit).offset((page - 1) * limit);
  }

  async listPublicMedia(page = 1, limit = 48, search = "", type?: "image" | "video",
    fields: ("caption" | "photographer" | "tags" | "identification")[] = ["caption", "photographer", "tags", "identification"]): Promise<MediaItem[]> {
    const terms = await planMediaSearchTerms(search, fields.includes("identification"));
    return this.publicMediaQuery(search, type, fields, terms)
      .orderBy(desc(mediaItems.id)).limit(limit).offset((page - 1) * limit);
  }

  async countPublicMedia(search = "", type?: "image" | "video",
    fields: ("caption" | "photographer" | "tags" | "identification")[] = ["caption", "photographer", "tags", "identification"]): Promise<number> {
    const terms = await planMediaSearchTerms(search, fields.includes("identification"));
    const [row] = await db.select({ total: sql<number>`count(*)::int` })
      .from(this.publicMediaQuery(search, type, fields, terms).as("matching_media"));
    return row.total;
  }

  private publicMediaQuery(search: string, type: "image" | "video" | undefined,
    fields: ("caption" | "photographer" | "tags" | "identification")[],
    terms: Awaited<ReturnType<typeof planMediaSearchTerms>>) {
    return db.select(mediaListColumns).from(mediaItems)
      .leftJoin(events, eq(mediaItems.eventId, events.id))
      .where(and(
        search && !fields.length ? sql`false` : undefined,
        publicEventPredicate(), publicMediaPredicate(), eq(mediaItems.isPremium, false),
        or(eq(events.isPremium, false), sql`${events.id} is null`),
        ...(type ? [eq(mediaItems.type, type)] : []),
        ...terms.map(({term,jsonPrefilter})=>or(
          ...(fields.includes("caption") ? [ilike(mediaItems.caption, term)] : []),
          ...(fields.includes("photographer") ? [ilike(mediaItems.photographer, term)] : []),
           ...(fields.includes("tags") ? [sql`(${activeMediaTagsSql(mediaItems.tags)})::text ilike ${term}`] : []),
          // A search term has no whitespace, so it cannot cross concat_ws field
          // boundaries. Plain JSON words must also occur in the serialized JSON.
          // Quotes, backslashes and controls can be JSON-escaped: skip the
          // prefilter for those, and ALWAYS retain the exact field whitelist.
          ...(fields.includes("identification") ? [and(
            jsonPrefilter ? sql`${mediaItems.identification}::text ilike ${term}` : undefined,
            sql`exists(select 1 from jsonb_array_elements(${mediaItems.identification}) ident
            where concat_ws(' ',ident->>'number',ident->>'team',ident->>'drivers',ident->>'vehicle',
              ident->>'manufacturer',ident->>'racingClass',ident->>'discipline') ilike ${term})`)] : []),
        )),
      ));
  }

  async getMediaItems(eventId: number, page = 1, limit = 48): Promise<MediaItem[]> {
    return await db
      .select(mediaListColumns)
      .from(mediaItems)
      .where(and(activeMediaPredicate(),eq(mediaItems.eventId, eventId))).orderBy(desc(mediaItems.id)).limit(limit).offset((page - 1) * limit);
  }

  async getEventThumbnailOptions(event: Event, page = 1): Promise<MediaItem[]> {
    if (event.isPremium) return [];
    return this.thumbnailOptionsQuery(event).orderBy(desc(mediaItems.id)).limit(25).offset((page - 1) * 24);
  }

  async countEventThumbnailOptions(event: Event): Promise<number> {
    if (event.isPremium) return 0;
    const [row] = await db.select({ total: sql<number>`count(*)::int` })
      .from(this.thumbnailOptionsQuery(event).as("eligible_photos"));
    return row.total;
  }

  private thumbnailOptionsQuery(event: Event) {
    // Filter before pagination so videos or pending photos cannot hide later choices.
    // Only bounded inline thumbnails are read, never gallery originals.
    return db.select({ ...mediaListColumns, url: sql<string>`''` }).from(mediaItems)
      .where(and(activeMediaPredicate(),eq(mediaItems.eventId, event.id), eq(mediaItems.type, "image"),
        eq(mediaItems.isPremium, false),
        or(...(!event.creatorId ? [eq(mediaItems.safetyStatus, "legacy")] : []),
          and(eq(mediaItems.safetyStatus, "approved"), eq(mediaItems.safetyPolicy, SAFETY_POLICY),
            sql`${mediaItems.contentVersion} = ${mediaItems.safetyVersion}`)),
        boundedGalleryThumbnailSql(mediaItems.thumbnail)));
  }

  async getPublicEventMediaItems(eventId: number, page = 1, limit = 48): Promise<MediaItem[]> {
    return this.publicEventMediaQuery(eventId).orderBy(desc(mediaItems.id)).limit(limit).offset((page-1)*limit);
  }

  async countEventMedia(eventId: number, manager: boolean): Promise<number> {
    const source = manager ? db.select({ id: mediaItems.id }).from(mediaItems).where(and(activeMediaPredicate(),eq(mediaItems.eventId, eventId)))
      : this.publicEventMediaQuery(eventId);
    const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(source.as("event_media"));
    return row.total;
  }

  private publicEventMediaQuery(eventId: number) {
    return db.select(mediaListColumns).from(mediaItems)
      .innerJoin(events,eq(mediaItems.eventId,events.id))
      .where(and(eq(mediaItems.eventId,eventId),eq(events.isPremium,false),
        publicEventPredicate(),publicMediaPredicate()));
  }

  async getMediaItem(id: number, includeOriginal = true): Promise<MediaItem | undefined> {
    const result = await db
      .select(includeOriginal ? getTableColumns(mediaItems) : { ...getTableColumns(mediaItems), url: sql<string>`''` })
      .from(mediaItems)
      .where(and(activeMediaPredicate(),eq(mediaItems.id, id)))
      .limit(1);
    const item = result[0];
    return item ? { ...item, tags: item.tags === null ? null : withoutRetiredMediaTags(item.tags),
      manualTags: withoutRetiredMediaTags(item.manualTags), suppressedAITags: withoutRetiredMediaTags(item.suppressedAITags) } : undefined;
  }

  async createMediaItem(mediaItem: InsertMediaItem): Promise<MediaItem> {
    assertMediaTagsAllowed(mediaItem);
    const event = mediaItem.eventId ? await this.getEvent(mediaItem.eventId) : undefined;
    const result = await db.insert(mediaItems).values({...mediaItem,archivedAt:null,
      ...(event?.creatorId?{safetyStatus:"error",safetyReason:"Safety check pending."}:{})}).returning();
    return result[0];
  }

  async updateMediaItem(id: number, mediaItem: Partial<InsertMediaItem>): Promise<MediaItem> {
    assertMediaTagsAllowed(mediaItem);
    const result = await db
      .update(mediaItems)
      .set({...mediaItem,
        ...("caption" in mediaItem ? {captionSource:"manual"} : {}),
        contentVersion:sql`${mediaItems.contentVersion}+1`,
        safetyStatus:sql`case when exists(select 1 from events e where e.id=${mediaItems.eventId} and e.creator_id is not null) then 'error' else ${mediaItems.safetyStatus} end`,
        safetyReason:sql`case when exists(select 1 from events e where e.id=${mediaItems.eventId} and e.creator_id is not null) then 'Safety check pending.' else ${mediaItems.safetyReason} end`,
      })
      .where(and(activeMediaPredicate(),eq(mediaItems.id, id)))
      .returning();

    if (result.length === 0) {
      throw new Error("Media item not found");
    }

    return result[0];
  }

  async deleteMediaItem(id: number): Promise<void> {
    await db.transaction(async tx => {
      const [item] = await tx.select().from(mediaItems).where(eq(mediaItems.id, id));
      if (!item || item.archivedAt) return;
      const event = item.eventId ? await tx.select().from(events).where(eq(events.id,item.eventId)).then(rows=>rows[0]) : undefined;
      if (event?.creatorId) await tx.execute(sql`select id from users where id=${event.creatorId} for update`);
      if (item.eventId) await tx.execute(sql`select id from events where id = ${item.eventId} for update`);
      for (const key of objectKeys(item)) await tx.insert(mediaCleanup).values({ key,creatorId:event?.creatorId,storedBytes:item.url.endsWith(key)?item.highBytes:item.lowBytes,
        photoToken:item.type==="image"?`item:${item.id}`:null }).onConflictDoNothing();
      await tx.delete(mediaItems).where(eq(mediaItems.id, id));
    });
    void this.cleanupObjects().catch(error => console.error("Media cleanup failed:", error));
  }

  async findMediaByKey(key: string, includeOriginal = true): Promise<MediaItem | undefined> {
    const url = `/api/media/files/${key}`;
    const [item] = await db.select(includeOriginal ? getTableColumns(mediaItems) :
      { ...getTableColumns(mediaItems), url: sql<string>`case when ${mediaItems.url} like 'data:%' then '' else ${mediaItems.url} end` }).from(mediaItems)
      .where(and(activeMediaPredicate(),or(and(eq(mediaItems.url, url), sql`${mediaItems.url} like '/api/media/files/%'`),
        and(eq(mediaItems.thumbnail, url), sql`${mediaItems.thumbnail} like '/api/media/files/%'`)))).limit(1);
    return item;
  }

  /** One compact query for cards, no originals/inline payloads leave PostgreSQL. */
  async getEventCardFallbacks(ids: number[]): Promise<Map<number, string>> {
    if (!ids.length) return new Map();
    const rows = await db.select({ eventId: events.id, thumbnail: this.eventCardFallbackExpression() })
      .from(events).where(sql`${events.id} = any(${`{${ids.join(",")}}`}::int[])`);
    return new Map(rows.filter(row => row.thumbnail !== null).map(row => [row.eventId, row.thumbnail!]));
  }

  async getEventsWithCardFallbacks(): Promise<(Event & { galleryThumbnail: string | null })[]> {
    return db.select({ ...getTableColumns(events), galleryThumbnail: this.eventCardFallbackExpression() }).from(events);
  }

  private eventCardFallbackExpression() {
    // Match the card's former first public gallery page (newest 48), then
    // choose its first eligible photo. Filtering before this window would
    // unexpectedly reveal an older photo formerly outside the first page.
    const eligible = sql<boolean>`(${mediaItems.type} = 'image' and not ${mediaItems.isPremium}
        and (${mediaItems.safetyStatus} = 'legacy' or (${mediaItems.safetyStatus} = 'approved'
          and ${mediaItems.safetyPolicy} = ${SAFETY_POLICY} and ${mediaItems.contentVersion} = ${mediaItems.safetyVersion}))
        and (${mediaItems.thumbnail} ~ '^/api/media/files/thumb-[0-9a-f-]{36}\\.webp$' or
          (${mediaItems.thumbnail} ~ '^data:image/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=\\r\\n]+$'
            and length(${mediaItems.thumbnail}) <= ${Math.ceil(mediaPolicy.imageBytes * 4 / 3) + 100})))`;
    // Correlated LIMIT uses the existing event-page index and never scans/ranks
    // the whole archive to find one photo. Return only the transformed reference.
    return sql<string | null>`case when ${publicEventPredicate()} and not ${events.isPremium} then
      (select card.preview from (
        select ${mediaItems.id} as id, ${mediaListColumns.thumbnail} as preview, ${eligible} as eligible
        from ${mediaItems} where ${mediaItems.eventId} = ${sql.raw('"events"."id"')} and ${publicMediaPredicate()}
        order by ${mediaItems.id} desc limit 48
      ) card where card.eligible order by card.id desc limit 1)
      else null end`;
  }

  async topMedia(limit: number, creator?: number | null): Promise<MediaItem[]> {
    return db.select(mediaListColumns).from(mediaItems)
      .leftJoin(events, eq(mediaItems.eventId, events.id))
      .where(and(publicEventPredicate(), publicMediaPredicate(), eq(mediaItems.isPremium, false), or(eq(events.isPremium, false), sql`${events.id} is null`),
        ...(creator === null ? [sql`${events.creatorId} is null`] : creator === undefined ? [sql`${events.creatorId} is not null`] : [eq(events.creatorId, creator)])))
      .orderBy(desc(mediaItems.downloadCount), desc(mediaItems.id)).limit(limit);
  }

  async reserveMedia(id: string, eventId: number, creatorId: number | null, bytes: number, storageKey: string, thumbnailKey: string, adminUpload = false): Promise<void> {
    assertNewMediaUploadsEnabled();
    await db.transaction(async tx => {
      // Lock the creator first, then the event. Serializes budgets across events
      // and across app instances; the reservation remains until commit/failure.
      if (creatorId) await tx.execute(sql`select id from users where id = ${creatorId} for update`);
       // The target owner's Free quota applies even when an admin uploads.
       if (creatorId) await lockedCreatorBudget(tx,creatorId,bytes,1);
      const event = await tx.execute(sql`select id,creator_id from events where id = ${eventId} for update`);
      if (!event.rows.length) throw new Error("Event no longer exists");
      if ((event.rows[0].creator_id ?? null)!==creatorId) throw new Error("Event owner changed before upload");
      const usage = async (scope: "event" | "creator") => {
        const filter = scope === "event" ? sql`m.event_id = ${eventId}` : sql`e.creator_id = ${creatorId}`;
        const pending = scope === "event" ? sql`event_id = ${eventId}` : sql`creator_id = ${creatorId}`;
        const result = await tx.execute(sql`
          select (select coalesce(sum(coalesce(m.stored_bytes,
              case when m.url like 'data:%' then length(m.url) * 3 / 4 else 0 end +
              case when m.thumbnail like 'data:%' then length(m.thumbnail) * 3 / 4 else 0 end)), 0) from media_items m
            left join events e on e.id = m.event_id where m.archived_at is null and ${filter}) +
            (select coalesce(sum(reserved_bytes), 0) from media_reservations where ${pending}) as bytes,
          (select count(*) from media_items m left join events e on e.id = m.event_id where m.archived_at is null and ${filter}) +
            (select count(*) from media_reservations where ${pending}) as count`);
        return { bytes: Number(result.rows[0].bytes), count: Number(result.rows[0].count) };
      };
      const eventUsage = await usage("event");
      if (eventUsage.bytes + bytes > mediaPolicy.eventBytes || eventUsage.count + 1 > mediaPolicy.eventCount)
        throw new MediaLimitError("Event storage budget exceeded. Remove media or contact an administrator.");
      if (creatorId && adminUpload) {
        const creatorUsage = await usage("creator");
        if (creatorUsage.bytes + bytes > mediaPolicy.creatorBytes || creatorUsage.count + 1 > mediaPolicy.creatorCount)
          throw new MediaLimitError("Creator storage budget exceeded. Remove media or contact an administrator.");
      }
      await tx.insert(mediaReservations).values({ id, eventId, creatorId, reservedBytes: bytes, storageKey, thumbnailKey });
    });
  }

  async finishMedia(id: string, mediaItem: InsertMediaItem, nextcloudFileId?: number, workerToken?: string, requestAnalysis = false, _community = false): Promise<MediaItem> {
    assertMediaTagsAllowed(mediaItem);
    return db.transaction(async tx => {
      if (workerToken) {
        const [owner] = await tx.select().from(nextcloudJobs)
          .where(and(eq(nextcloudJobs.eventId, mediaItem.eventId!), eq(nextcloudJobs.workerToken, workerToken))).for("update");
        if (!owner) throw new Error("Import lease has expired");
      }
      await tx.execute(sql`select id from media_reservations where id = ${id} for update`);
      const [reservation] = await tx.select().from(mediaReservations).where(eq(mediaReservations.id, id));
      if (!reservation) throw new Error("Upload reservation has expired");
      if (mediaItem.eventId!==reservation.eventId) throw new Error("Upload event does not match its reservation");
      const community = !!reservation.creatorId;
      const [event] = await tx.select().from(events).where(eq(events.id,reservation.eventId)).for("update");
      const photoWorkflow = mediaItem.type==="image" && !!event && await automaticPhotoMatching(event.id,tx);
      // Persist a useful caption with the file, before any optional recognition.
      // Nextcloud filenames are placeholders, not user-written captions.
      const automaticCaption = !!nextcloudFileId || !mediaItem.caption?.trim();
      const [eventSeries] = automaticCaption && event?.seriesId
        ? await tx.select({name:seriesTable.name}).from(seriesTable).where(eq(seriesTable.id,event.seriesId)) : [];
      const fallbackCaption = automaticCaption && event
        ? matchedPhotoCaption(event,eventSeries?.name || null,[]).caption : mediaItem.caption;
      const [item] = await tx.insert(mediaItems).values({...mediaItem,archivedAt:null,
        caption:fallbackCaption,
        captionSource:nextcloudFileId ? "nextcloud_placeholder" : automaticCaption ? "auto_pending" : "preserved",
        manualTags:mediaItem.tags || [],
        ...(community ? {safetyStatus:"error",safetyReason:"Safety check pending."} : {})}).returning();
      if (requestAnalysis || photoWorkflow) {
        await tx.execute(sql`select pg_advisory_xact_lock(761020)`);
        const pending = await tx.execute(sql`select count(*)::int as count from media_analysis_jobs where status in ('queued','running')`);
        const ownedPending = reservation.creatorId ? await tx.execute(sql`select count(*)::int as count
          from media_analysis_jobs j join media_items m on m.id=j.media_id join events e on e.id=m.event_id
          where e.creator_id=${reservation.creatorId} and j.status in ('queued','running')`) : undefined;
        const ready = isAITaggingConfigured() && Number(pending.rows[0]?.count) < 1000 &&
          (!ownedPending || Number(ownedPending.rows[0]?.count)<100);
        // Saving media and requesting analysis commit together. A full queue or
        // unavailable provider must not discard a successful transfer.
        await tx.insert(mediaAnalysisJobs).values({ mediaId: item.id,
          fingerprint: itemAnalysisFingerprint(item,photoWorkflow),
          photoWorkflow:ready && photoWorkflow,photoMatchingRevision:event?.photoMatchingRevision || 0,
          referenceRevision:event?.referenceRevision || 0,
          status: ready ? "queued" : photoWorkflow ? "waiting" : "failed",
          error: ready ? null : photoWorkflow
            ? "Waiting for automatic matching admission. A full queue or unavailable AI service will be checked again automatically."
            : "AI analysis not started. Retry when the service is available." });
      }
      if (nextcloudFileId) {
        const [file] = await tx.update(nextcloudFiles).set({ status: "saved", mediaId: item.id, message: null })
          .where(and(eq(nextcloudFiles.id, nextcloudFileId), eq(nextcloudFiles.status, "pending"))).returning();
        if (!file) throw new Error("Import file reservation is no longer pending");
      }
      await tx.delete(mediaReservations).where(eq(mediaReservations.id, id));
      return item;
    });
  }

  async abandonMedia(id: string): Promise<void> {
    await db.transaction(async tx => {
      const [reservation] = await tx.select().from(mediaReservations).where(eq(mediaReservations.id, id));
      if (!reservation) return;
      const photo = /\.(jpg|png|gif|webp)$/.test(reservation.storageKey);
      // Hold the complete reserved total exactly once until failed objects are
      // removed. A partial write must not become unmeasured/free quota usage.
      for (const key of [reservation.storageKey, reservation.thumbnailKey])
        await tx.insert(mediaCleanup).values({ key,creatorId:reservation.creatorId,
          storedBytes:key===reservation.storageKey ? reservation.reservedBytes : 0,
          photoToken:photo?`reservation:${reservation.id}`:null }).onConflictDoNothing();
      await tx.delete(mediaReservations).where(eq(mediaReservations.id, id));
    });
  }

  /** Replace an official video's derivative, fenced to this worker and source.
   * A durable reservation protects the new object across crashes and cleanup.
   * Creator derivatives require a separate safety decision, not this backfill.
   */
  async replaceVideoPreview(item: MediaItem, workerToken: string, bytes: Buffer): Promise<boolean> {
    if (!item.eventId || item.type !== "video" || !bytes.length || bytes.length >= 100 * 1024) return false;
    const reservationId = randomUUID();
    const key = `thumb-${randomUUID()}.webp`;
    const before = await db.transaction(async tx => {
      const [event] = await tx.select().from(events).where(eq(events.id, item.eventId!)).for("update");
      if (!event || event.creatorId) return undefined;
      const [job] = await tx.select().from(mediaAnalysisJobs).where(and(
        eq(mediaAnalysisJobs.mediaId, item.id), eq(mediaAnalysisJobs.workerToken, workerToken),
        eq(mediaAnalysisJobs.status, "running"))).for("update");
      const [current] = await tx.select().from(mediaItems).where(eq(mediaItems.id, item.id)).for("update");
      if (!job || !current || current.url !== item.url || current.eventId !== item.eventId || current.type !== "video")
        return undefined;
      const [usage] = await tx.execute(sql`select
        (select coalesce(sum(stored_bytes),0) from media_items where event_id=${item.eventId}) +
        (select coalesce(sum(reserved_bytes),0) from media_reservations where event_id=${item.eventId}) as bytes`).then(r=>r.rows);
      if (Number(usage.bytes) + Math.max(0, bytes.length - (current.lowBytes || 0)) > mediaPolicy.eventBytes)
        throw new MediaLimitError("Event storage budget exceeded");
      await tx.insert(mediaReservations).values({id:reservationId, eventId:item.eventId!,
        creatorId:null, reservedBytes:bytes.length, storageKey:key, thumbnailKey:key});
      return current;
    });
    if (!before) return false;
    let committed = false;
    try {
      await writeVideoPreview(key, bytes);
      committed = await db.transaction(async tx => {
        const [event] = await tx.select().from(events).where(eq(events.id, item.eventId!)).for("update");
        const [job] = await tx.select().from(mediaAnalysisJobs).where(and(
          eq(mediaAnalysisJobs.mediaId, item.id), eq(mediaAnalysisJobs.workerToken, workerToken),
          eq(mediaAnalysisJobs.status, "running"))).for("update");
        const [reservation] = await tx.select().from(mediaReservations)
          .where(eq(mediaReservations.id, reservationId)).for("update");
        const [current] = await tx.select().from(mediaItems).where(eq(mediaItems.id,item.id)).for("update");
        if (!event || event.creatorId || !job || !reservation || !current || current.type !== "video" ||
          current.url !== item.url || current.eventId !== item.eventId || current.thumbnail !== before.thumbnail) return false;
        await tx.update(mediaItems).set({thumbnail:`/api/media/files/${key}`, lowBytes:bytes.length,
          storedBytes:(current.storedBytes ?? (current.highBytes || 0) + (current.lowBytes || 0)) -
            (current.lowBytes || 0) + bytes.length,
        }).where(eq(mediaItems.id,item.id));
        const oldKey = /^\/api\/media\/files\/(thumb-[0-9a-f-]{36}\.webp)$/.exec(current.thumbnail)?.[1];
        if (oldKey) await tx.insert(mediaCleanup).values({key:oldKey,creatorId:null,
          storedBytes:current.lowBytes || 0}).onConflictDoNothing();
        await tx.delete(mediaReservations).where(eq(mediaReservations.id,reservationId));
        return true;
      });
      return committed;
    } finally {
      if (!committed) await this.abandonMedia(reservationId);
    }
  }

  async incrementDownloadCount(id: number): Promise<void> {
    await db.update(mediaItems).set({ downloadCount: sql`case when coalesce(${mediaItems.downloadCount}, 0) < 2147483647
      then coalesce(${mediaItems.downloadCount}, 0) + 1 else 2147483647 end` })
      .where(eq(mediaItems.id, id));
  }

  async cleanupObjects(creatorIds?: readonly number[]): Promise<void> {
    if (creatorIds?.length===0) return;
    // Cleanup must respect retained migration sources even in an older process
    // still running with Replit defaults. Missing additive schema is not an error.
    const routingTable = await db.execute(sql`select to_regclass('media_object_routes') as name`);
    const registeredRoutes = !!routingTable.rows[0]?.name;
    const scope = creatorIds ? sql`creator_id in (${sql.join(creatorIds.map(id=>sql`${id}`),sql`,`)})` : undefined;
    // Expired uploads are marked for cleanup after an hour. No successful
    // upload may still use the reservation by then (see route timeout policy).
    const expired = await db.select().from(mediaReservations)
      .where(and(lt(mediaReservations.createdAt, new Date(Date.now() - 60 * 60 * 1000)),scope)).limit(100);
    for (const reservation of expired) await this.abandonMedia(reservation.id);
    const pending = await db.select().from(mediaCleanup).where(scope).orderBy(mediaCleanup.createdAt).limit(100);
    for (const item of pending) {
      try {
        await db.transaction(async tx => {
          const locked = await tx.execute(sql`select key from media_cleanup where key = ${item.key} for update`);
          if (!locked.rows.length) return;
          // A finishing upload also locks its reservation row. Keeping that
          // lock through the reference check prevents deleting a just-saved object.
          const reserved = await tx.execute(sql`select id from media_reservations
            where storage_key = ${item.key} or thumbnail_key = ${item.key} for update`);
          if (reserved.rows.length) return;
          const url = `/api/media/files/${item.key}`;
          const [referenced] = await tx.select({ id: mediaItems.id }).from(mediaItems)
            .where(or(eq(mediaItems.url, url), eq(mediaItems.thumbnail, url))).limit(1);
          const [document] = await tx.select({id:referenceDocuments.id}).from(referenceDocuments)
            .where(eq(referenceDocuments.sourceKey,item.key)).limit(1);
          if (!referenced && !document) await deleteMediaObject(item.key,registeredRoutes,statement=>tx.execute(statement));
          await tx.delete(mediaCleanup).where(eq(mediaCleanup.key, item.key));
        });
      } catch (error) {
        await db.update(mediaCleanup).set({ lastError: String(error) }).where(eq(mediaCleanup.key, item.key));
      }
    }
  }

  async mediaUsage() {
    const [total] = await db.select({
      bytes: sql<number>`coalesce(sum(${mediaItems.storedBytes}), 0)`,
      count: sql<number>`count(*)`,
      legacy: sql<number>`count(*) filter (where ${mediaItems.storedBytes} is null)`,
      legacyTextBytes: sql<number>`coalesce(sum(length(${mediaItems.url}) + length(${mediaItems.thumbnail})) filter (where ${mediaItems.storedBytes} is null), 0)`,
    }).from(mediaItems);
    const byEvent = await db.select({ eventId: events.id, title: events.title, creatorId: events.creatorId,
      bytes: sql<number>`coalesce(sum(${mediaItems.storedBytes}), 0)`, count: sql<number>`count(${mediaItems.id})`,
      legacy: sql<number>`count(${mediaItems.id}) filter (where ${mediaItems.storedBytes} is null)` })
      .from(events).leftJoin(mediaItems, eq(mediaItems.eventId, events.id)).groupBy(events.id);
    const byCreator = await db.select({ creatorId: events.creatorId,
      bytes: sql<number>`coalesce(sum(${mediaItems.storedBytes}), 0)`, count: sql<number>`count(${mediaItems.id})` })
      .from(events).leftJoin(mediaItems, eq(mediaItems.eventId, events.id))
      .where(sql`${events.creatorId} is not null`).groupBy(events.creatorId);
    const [{ count: cleanupCount }] = await db.select({ count: sql<number>`count(*)` }).from(mediaCleanup);
    return { total, byEvent, byCreator, cleanupCount, policy: mediaPolicy, warningFraction: 0.8 };
  }

  async updateUserCreatorStatus(userId: number, status: 'pending' | 'approved' | 'rejected'): Promise<SafeUser> {
    const result = await db.transaction(async tx => {
      const [before] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      const updated = await tx.update(users).set({
        creatorStatus: status, isCreator: status === 'approved',
      }).where(eq(users.id, userId)).returning();
      if (status === "approved" && updated[0]?.emailVerifiedAt && !updated[0].suspended &&
        !(before?.isCreator && before.creatorStatus === "approved"))
        await enqueueTransactionalEmail(tx, "creator-welcome", userId);
      return updated;
    });

    if (result.length === 0) {
      throw new Error("User not found");
    }

    const { password, ...safeUser } = result[0];
    return safeUser;
  }

  async getEventsByCreator(creatorId: number): Promise<Event[]> {
    return await db
      .select()
      .from(events)
      .where(eq(events.creatorId, creatorId));
  }

  async updateUserCredits(userId: number, credits: number): Promise<SafeUser> {
    const result = await db
      .update(users)
      .set({ credits: credits.toString() })
      .where(eq(users.id, userId))
      .returning();

    if (result.length === 0) {
      throw new Error("User not found");
    }

    const { password, ...safeUser } = result[0];
    return safeUser;
  }

  async getCreatorEarnings(creatorId: number): Promise<{ totalCredits: number }> {
    // For now, just return placeholder data
    // TODO: Implement actual earnings calculation based on downloaded content
    return { totalCredits: 0 };
  }
}

export const storage = new DatabaseStorage();
