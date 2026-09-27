import { User, Event, MediaItem, InsertUser, InsertEvent, InsertMediaItem, Series, InsertSeries } from "@shared/schema";
import { users, events, mediaItems, series as seriesTable } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

type SafeUser = Omit<User, "password">;
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
  createEvent(event: InsertEvent): Promise<Event>;
  updateEvent(id: number, event: Partial<InsertEvent>): Promise<Event>;
  deleteEvent(id: number): Promise<{ success: boolean; message: string }>;

  // Series management
  getSeries(id?: number): Promise<Series[] | Series | undefined>;
  createSeries(series: InsertSeries): Promise<Series>;
  updateSeries(id: number, series: Partial<InsertSeries>): Promise<Series>;
  deleteSeries(id: number): Promise<void>;

  // Media management
  getAllMediaItems(): Promise<MediaItem[]>;
  getMediaItems(eventId: number): Promise<MediaItem[]>;
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

  async createEvent(event: InsertEvent): Promise<Event> {
    const result = await db.insert(events).values(event).returning();
    return result[0];
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

      // Begin transaction for atomicity
      // First delete all media items associated with this event
      await db.delete(mediaItems).where(eq(mediaItems.eventId, id));

      // Then delete the event itself
      await db.delete(events).where(eq(events.id, id)).returning();

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
  async getAllMediaItems(): Promise<MediaItem[]> {
    return await db.select().from(mediaItems);
  }

  async getMediaItems(eventId: number): Promise<MediaItem[]> {
    return await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.eventId, eventId));
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
    await db.delete(mediaItems).where(eq(mediaItems.id, id));
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