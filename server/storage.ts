
import { User, Event, MediaItem, InsertUser, InsertEvent, InsertMediaItem, Series, InsertSeries } from "@shared/schema";
import { users, events, mediaItems, series as seriesTable } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
import session from "express-session";
import connectPg from "connect-pg-simple";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;

  // Series methods
  getSeries(id?: number): Promise<Series | Series[] | undefined>;
  createSeries(series: InsertSeries): Promise<Series>;
  updateSeries(id: number, series: Partial<InsertSeries>): Promise<Series>;
  deleteSeries(id: number): Promise<void>;

  // Event methods
  getEvents(): Promise<Event[]>;
  getEvent(id: number): Promise<Event | undefined>;
  createEvent(event: InsertEvent): Promise<Event>;
  updateEvent(id: number, event: Partial<InsertEvent>): Promise<Event>;
  deleteEvent(id: number): Promise<void>;

  // Media methods
  getMediaItems(eventId: number): Promise<MediaItem[]>;
  createMediaItem(item: InsertMediaItem): Promise<MediaItem>;
  updateMediaItem(id: number, item: Partial<InsertMediaItem>): Promise<MediaItem>;
  deleteMediaItem(id: number): Promise<void>;

  sessionStore: session.Store;
}

class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PostgresSessionStore({
      pool: db.$client,
      createTableIfMissing: true,
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(data: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async getSeries(id?: number): Promise<Series | Series[] | undefined> {
    if (id) {
      const [series] = await db.select().from(seriesTable).where(eq(seriesTable.id, id));
      return series;
    }
    return await db.select().from(seriesTable);
  }

  async createSeries(data: InsertSeries): Promise<Series> {
    const [series] = await db.insert(seriesTable).values(data).returning();
    return series;
  }

  async updateSeries(id: number, data: Partial<InsertSeries>): Promise<Series> {
    const [updated] = await db.update(seriesTable)
      .set(data)
      .where(eq(seriesTable.id, id))
      .returning();

    if (!updated) {
      throw new Error("Series not found");
    }
    return updated;
  }

  async deleteSeries(id: number): Promise<void> {
    await db.delete(seriesTable).where(eq(seriesTable.id, id));
  }

  async getEvents(): Promise<Event[]> {
    return await db.select().from(events);
  }

  async getEvent(id: number): Promise<Event | undefined> {
    const [event] = await db.select().from(events).where(eq(events.id, id));
    return event;
  }

  async createEvent(data: InsertEvent): Promise<Event> {
    const [event] = await db.insert(events).values(data).returning();
    return event;
  }

  async updateEvent(id: number, data: Partial<InsertEvent>): Promise<Event> {
    const [updated] = await db.update(events)
      .set(data)
      .where(eq(events.id, id))
      .returning();

    if (!updated) {
      throw new Error("Event not found");
    }
    return updated;
  }

  async deleteEvent(id: number): Promise<void> {
    // First delete all associated media items
    await db.delete(mediaItems).where(eq(mediaItems.eventId, id));
    // Then delete the event
    await db.delete(events).where(eq(events.id, id));
  }

  async getMediaItems(eventId: number): Promise<MediaItem[]> {
    try {
      console.log(`Fetching media items for event ${eventId}`);
      const items = await db
        .select()
        .from(mediaItems)
        .where(eq(mediaItems.eventId, eventId));
      console.log(`Found ${items.length} media items for event ${eventId}`);
      return items;
    } catch (error) {
      console.error(`Error fetching media items for event ${eventId}:`, error);
      return [];
    }
  }

  async createMediaItem(data: InsertMediaItem): Promise<MediaItem> {
    const [item] = await db.insert(mediaItems).values(data).returning();
    return item;
  }

  async updateMediaItem(id: number, data: Partial<InsertMediaItem>): Promise<MediaItem> {
    const [updated] = await db.update(mediaItems)
      .set(data)
      .where(eq(mediaItems.id, id))
      .returning();

    if (!updated) {
      throw new Error("Media item not found");
    }
    return updated;
  }

  async deleteMediaItem(id: number): Promise<void> {
    await db.delete(mediaItems).where(eq(mediaItems.id, id));
  }
}

// Singleton-Instanz erstellen und exportieren
export const storage = new DatabaseStorage();
