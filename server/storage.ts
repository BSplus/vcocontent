import { User, Event, MediaItem, InsertUser, InsertEvent, InsertMediaItem, Series, InsertSeries, type EntryRow } from "@shared/schema";
import { users, events, eventEntries, mediaItems, mediaReservations, mediaCleanup, nextcloudFiles, nextcloudJobs, mediaAnalysisJobs, series as seriesTable } from "@shared/schema";
import { analysisFingerprint } from "./analysis-jobs";
import { isAITaggingConfigured } from "./utils/ai-tagger";
import { db } from "./db";
import { eq, and, or, sql, desc, lt, ilike, getTableColumns } from "drizzle-orm";
import { mediaPolicy, MediaLimitError } from "./media-policy";
import { deleteMediaObject } from "./media-storage";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

type SafeUser = Omit<User, "password">;
function objectKeys(item: { url: string; thumbnail: string }): string[] {
  return [item.url, item.thumbnail]
    .map(url => /^\/api\/media\/files\/((?:media|thumb)-[0-9a-f-]{36}\.(?:jpg|png|gif|webp|mp4|mov|webm))$/.exec(url)?.[1])
    .filter((key): key is string => !!key);
}
const mediaListColumns = {
  ...getTableColumns(mediaItems),
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
  getEvent(id: number): Promise<Event | undefined>;
  createEvent(event: InsertEvent, entries?: EntryRow[]): Promise<Event>;
  updateEvent(id: number, event: Partial<InsertEvent>): Promise<Event>;
  deleteEvent(id: number): Promise<{ success: boolean; message: string }>;

  // Series management
  getSeries(id?: number): Promise<Series[] | Series | undefined>;
  createSeries(series: InsertSeries): Promise<Series>;
  updateSeries(id: number, series: Partial<InsertSeries>): Promise<Series>;
  deleteSeries(id: number): Promise<void>;

  // Media management
  getAllMediaItems(): Promise<MediaItem[]>;
  getMediaItems(eventId: number, page?: number, limit?: number): Promise<MediaItem[]>;
  getMediaItem(id: number): Promise<MediaItem | undefined>;
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
    const result = await db.select().from(users);
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

  async getEvent(id: number): Promise<Event | undefined> {
    const result = await db
      .select()
      .from(events)
      .where(eq(events.id, id))
      .limit(1);
    return result[0];
  }

  async getEventEntries(eventId: number): Promise<EntryRow[]> {
    const rows = await db.select().from(eventEntries).where(eq(eventEntries.eventId, eventId)).orderBy(eventEntries.id);
    return rows.map(({ number, team, car, drivers }) => ({ number, team, car, drivers }));
  }

  async replaceEventEntries(eventId: number, rows: EntryRow[]): Promise<void> {
    await db.transaction(async tx => {
      const locked = await tx.execute(sql`select id from events where id = ${eventId} for update`);
      if (!locked.rows.length) throw new Error("Event not found");
      await tx.delete(eventEntries).where(eq(eventEntries.eventId, eventId));
      if (rows.length) await tx.insert(eventEntries).values(rows.map(row => ({ ...row, eventId })));
    });
  }

  async createEvent(event: InsertEvent, entries?: EntryRow[]): Promise<Event> {
    if (!entries?.length) {
      const result = await db.insert(events).values(event).returning();
      return result[0];
    }
    return db.transaction(async tx => {
      const [created] = await tx.insert(events).values(event).returning();
      await tx.insert(eventEntries).values(entries.map(row => ({ ...row, eventId: created.id })));
      return created;
    });
  }

  async updateEvent(id: number, event: Partial<InsertEvent>): Promise<Event> {
    const result = await db
      .update(events)
      .set(event)
      .where(eq(events.id, id))
      .returning();

    if (result.length === 0) {
      throw new Error("Event not found");
    }

    return result[0];
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
        await tx.execute(sql`select id from events where id = ${id} for update`);
        const keys = await tx.select({ url: mediaItems.url, thumbnail: mediaItems.thumbnail })
          .from(mediaItems).where(eq(mediaItems.eventId, id));
        for (const row of keys) for (const key of objectKeys(row)) {
          await tx.insert(mediaCleanup).values({ key }).onConflictDoNothing();
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

  async updateSeries(id: number, series: Partial<InsertSeries>): Promise<Series> {
    const result = await db
      .update(seriesTable)
      .set(series)
      .where(eq(seriesTable.id, id))
      .returning();

    if (result.length === 0) {
      throw new Error("Series not found");
    }

    return result[0];
  }

  async deleteSeries(id: number): Promise<void> {
    // First update all events that reference this series
    await db
      .update(events)
      .set({ seriesId: null })
      .where(eq(events.seriesId, id));

    // Then delete the series
    await db.delete(seriesTable).where(eq(seriesTable.id, id));
  }

  // Media management methods
  async getAllMediaItems(page = 1, limit = 48): Promise<MediaItem[]> {
    return await db.select(mediaListColumns).from(mediaItems).orderBy(desc(mediaItems.id)).limit(limit).offset((page - 1) * limit);
  }

  async listPublicMedia(page = 1, limit = 48, search = "", type?: "image" | "video",
    fields: ("caption" | "photographer" | "tags")[] = ["caption", "photographer", "tags"]): Promise<MediaItem[]> {
    if (search && !fields.length) return [];
    const term = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    return db.select(mediaListColumns).from(mediaItems)
      .leftJoin(events, eq(mediaItems.eventId, events.id))
      .where(and(
        or(eq(events.isPremium, false), sql`${events.id} is null`),
        ...(type ? [eq(mediaItems.type, type)] : []),
        ...(search ? [or(
          ...(fields.includes("caption") ? [ilike(mediaItems.caption, term)] : []),
          ...(fields.includes("photographer") ? [ilike(mediaItems.photographer, term)] : []),
          ...(fields.includes("tags") ? [sql`${mediaItems.tags}::text ilike ${term}`] : []),
        )] : []),
      ))
      .orderBy(desc(mediaItems.id)).limit(limit).offset((page - 1) * limit)
      .then(rows => rows);
  }

  async getMediaItems(eventId: number, page = 1, limit = 48): Promise<MediaItem[]> {
    return await db
      .select(mediaListColumns)
      .from(mediaItems)
      .where(eq(mediaItems.eventId, eventId)).orderBy(desc(mediaItems.id)).limit(limit).offset((page - 1) * limit);
  }

  async getMediaItem(id: number): Promise<MediaItem | undefined> {
    const result = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.id, id))
      .limit(1);
    return result[0];
  }

  async createMediaItem(mediaItem: InsertMediaItem): Promise<MediaItem> {
    const result = await db.insert(mediaItems).values(mediaItem).returning();
    return result[0];
  }

  async updateMediaItem(id: number, mediaItem: Partial<InsertMediaItem>): Promise<MediaItem> {
    const result = await db
      .update(mediaItems)
      .set(mediaItem)
      .where(eq(mediaItems.id, id))
      .returning();

    if (result.length === 0) {
      throw new Error("Media item not found");
    }

    return result[0];
  }

  async deleteMediaItem(id: number): Promise<void> {
    await db.transaction(async tx => {
      const [item] = await tx.select().from(mediaItems).where(eq(mediaItems.id, id));
      if (!item) return;
      if (item.eventId) await tx.execute(sql`select id from events where id = ${item.eventId} for update`);
      for (const key of objectKeys(item)) await tx.insert(mediaCleanup).values({ key }).onConflictDoNothing();
      await tx.delete(mediaItems).where(eq(mediaItems.id, id));
    });
    void this.cleanupObjects().catch(error => console.error("Media cleanup failed:", error));
  }

  async findMediaByKey(key: string): Promise<MediaItem | undefined> {
    const url = `/api/media/files/${key}`;
    const [item] = await db.select().from(mediaItems)
      .where(or(and(eq(mediaItems.url, url), sql`${mediaItems.url} like '/api/media/files/%'`),
        and(eq(mediaItems.thumbnail, url), sql`${mediaItems.thumbnail} like '/api/media/files/%'`))).limit(1);
    return item;
  }

  async topMedia(limit: number, creator?: number | null): Promise<MediaItem[]> {
    return db.select(mediaListColumns).from(mediaItems)
      .leftJoin(events, eq(mediaItems.eventId, events.id))
      .where(and(eq(mediaItems.isPremium, false), or(eq(events.isPremium, false), sql`${events.id} is null`),
        ...(creator === null ? [sql`${events.creatorId} is null`] : creator === undefined ? [sql`${events.creatorId} is not null`] : [eq(events.creatorId, creator)])))
      .orderBy(desc(mediaItems.downloadCount), desc(mediaItems.id)).limit(limit);
  }

  async reserveMedia(id: string, eventId: number, creatorId: number | null, bytes: number, storageKey: string, thumbnailKey: string): Promise<void> {
    await db.transaction(async tx => {
      // Lock the creator first, then the event. Serializes budgets across events
      // and across app instances; the reservation remains until commit/failure.
      if (creatorId) await tx.execute(sql`select id from users where id = ${creatorId} for update`);
      const event = await tx.execute(sql`select id from events where id = ${eventId} for update`);
      if (!event.rows.length) throw new Error("Event no longer exists");
      const usage = async (scope: "event" | "creator") => {
        const filter = scope === "event" ? sql`m.event_id = ${eventId}` : sql`e.creator_id = ${creatorId}`;
        const pending = scope === "event" ? sql`event_id = ${eventId}` : sql`creator_id = ${creatorId}`;
        const result = await tx.execute(sql`
          select (select coalesce(sum(coalesce(m.stored_bytes,
              case when m.url like 'data:%' then length(m.url) * 3 / 4 else 0 end +
              case when m.thumbnail like 'data:%' then length(m.thumbnail) * 3 / 4 else 0 end)), 0) from media_items m
            left join events e on e.id = m.event_id where ${filter}) +
            (select coalesce(sum(reserved_bytes), 0) from media_reservations where ${pending}) as bytes,
          (select count(*) from media_items m left join events e on e.id = m.event_id where ${filter}) +
            (select count(*) from media_reservations where ${pending}) as count`);
        return { bytes: Number(result.rows[0].bytes), count: Number(result.rows[0].count) };
      };
      const eventUsage = await usage("event");
      if (eventUsage.bytes + bytes > mediaPolicy.eventBytes || eventUsage.count + 1 > mediaPolicy.eventCount)
        throw new MediaLimitError("Event storage budget exceeded. Remove media or contact an administrator.");
      if (creatorId) {
        const creatorUsage = await usage("creator");
        if (creatorUsage.bytes + bytes > mediaPolicy.creatorBytes || creatorUsage.count + 1 > mediaPolicy.creatorCount)
          throw new MediaLimitError("Creator storage budget exceeded. Remove media or contact an administrator.");
      }
      await tx.insert(mediaReservations).values({ id, eventId, creatorId, reservedBytes: bytes, storageKey, thumbnailKey });
    });
  }

  async finishMedia(id: string, mediaItem: InsertMediaItem, nextcloudFileId?: number, workerToken?: string, requestAnalysis = false): Promise<MediaItem> {
    return db.transaction(async tx => {
      if (workerToken) {
        const [owner] = await tx.select().from(nextcloudJobs)
          .where(and(eq(nextcloudJobs.eventId, mediaItem.eventId!), eq(nextcloudJobs.workerToken, workerToken))).for("update");
        if (!owner) throw new Error("Import lease has expired");
      }
      await tx.execute(sql`select id from media_reservations where id = ${id} for update`);
      const [reservation] = await tx.select().from(mediaReservations).where(eq(mediaReservations.id, id));
      if (!reservation) throw new Error("Upload reservation has expired");
      const [item] = await tx.insert(mediaItems).values(mediaItem).returning();
      if (requestAnalysis && item.type === "image") {
        await tx.execute(sql`select pg_advisory_xact_lock(761020)`);
        const pending = await tx.execute(sql`select count(*)::int as count from media_analysis_jobs where status in ('queued','running')`);
        const ready = isAITaggingConfigured() && Number(pending.rows[0]?.count) < 1000;
        // Saving media and requesting analysis commit together. A full queue or
        // unavailable provider must not discard a successful transfer.
        await tx.insert(mediaAnalysisJobs).values({ mediaId: item.id,
          fingerprint: analysisFingerprint(item.thumbnail), status: ready ? "queued" : "failed",
          error: ready ? null : "AI analysis not started. Retry when the service is available." });
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
      for (const key of [reservation.storageKey, reservation.thumbnailKey])
        await tx.insert(mediaCleanup).values({ key }).onConflictDoNothing();
      await tx.delete(mediaReservations).where(eq(mediaReservations.id, id));
    });
  }

  async incrementDownloadCount(id: number): Promise<void> {
    await db.update(mediaItems).set({ downloadCount: sql`case when coalesce(${mediaItems.downloadCount}, 0) < 2147483647
      then coalesce(${mediaItems.downloadCount}, 0) + 1 else 2147483647 end` })
      .where(eq(mediaItems.id, id));
  }

  async cleanupObjects(): Promise<void> {
    // Expired uploads are marked for cleanup after an hour. No successful
    // upload may still use the reservation by then (see route timeout policy).
    const expired = await db.select().from(mediaReservations)
      .where(lt(mediaReservations.createdAt, new Date(Date.now() - 60 * 60 * 1000))).limit(100);
    for (const reservation of expired) await this.abandonMedia(reservation.id);
    const pending = await db.select().from(mediaCleanup).orderBy(mediaCleanup.createdAt).limit(100);
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
          if (!referenced) await deleteMediaObject(item.key);
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
    const result = await db
      .update(users)
      .set({
        creatorStatus: status,
        isCreator: status === 'approved'
      })
      .where(eq(users.id, userId))
      .returning();

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
