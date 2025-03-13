import { User, Event, MediaItem, InsertUser, InsertEvent, InsertMediaItem, Series, InsertSeries } from "@shared/schema";
import { users, events, mediaItems, series as seriesTable } from "@shared/schema";
import { db } from "./db";
import session from "express-session";
import { createStore } from "memorystore";

// Interface for storage functionality
interface IStorage {
  sessionStore: session.Store;

  // User methods
  getUsers(): Promise<User[]>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Event methods
  getEvents(): Promise<Event[]>;
  getEvent(id: number): Promise<Event | undefined>;
  createEvent(event: InsertEvent): Promise<Event>;
  updateEvent(id: number, event: Partial<InsertEvent>): Promise<Event>;
  deleteEvent(id: number): Promise<void>;

  // Series methods
  getSeries(id?: number): Promise<Series[] | Series | undefined>;
  createSeries(series: InsertSeries): Promise<Series>;
  updateSeries(id: number, series: Partial<InsertSeries>): Promise<Series>;
  deleteSeries(id: number): Promise<void>;

  // Media methods
  getAllMediaItems(): Promise<MediaItem[]>;
  getMediaItems(eventId: number): Promise<MediaItem[]>;
  createMediaItem(mediaItem: InsertMediaItem): Promise<MediaItem>;
  updateMediaItem(id: number, mediaItem: Partial<InsertMediaItem>): Promise<MediaItem>;
  deleteMediaItem(id: number): Promise<void>;
}

class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    const MemoryStore = createStore(session);
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000 // prune expired entries every 24h
    });
  }

  // User methods
  async getUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(users)
      .where(db.eq(users.username, username))
      .limit(1);
    return result[0];
  }

  async createUser(user: InsertUser): Promise<User> {
    const result = await db.insert(users).values(user).returning();
    return result[0];
  }

  // Event methods
  async getEvents(): Promise<Event[]> {
    return await db.select().from(events).orderBy(events.date);
  }

  async getEvent(id: number): Promise<Event | undefined> {
    const result = await db
      .select()
      .from(events)
      .where(db.eq(events.id, id))
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
      .where(db.eq(events.id, id))
      .returning();

    if (result.length === 0) {
      throw new Error("Event not found");
    }

    return result[0];
  }

  async deleteEvent(id: number): Promise<void> {
    await db.delete(events).where(db.eq(events.id, id));
  }

  // Series methods
  async getSeries(id?: number): Promise<Series[] | Series | undefined> {
    if (id) {
      const result = await db
        .select()
        .from(seriesTable)
        .where(db.eq(seriesTable.id, id))
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
      .where(db.eq(seriesTable.id, id))
      .returning();

    if (result.length === 0) {
      throw new Error("Series not found");
    }

    return result[0];
  }

  async deleteSeries(id: number): Promise<void> {
    await db.delete(seriesTable).where(db.eq(seriesTable.id, id));
  }

  // Media methods
  async getAllMediaItems(): Promise<MediaItem[]> {
    return await db.select().from(mediaItems);
  }

  async getMediaItems(eventId: number): Promise<MediaItem[]> {
    return await db
      .select()
      .from(mediaItems)
      .where(db.eq(mediaItems.eventId, eventId));
  }

  async createMediaItem(mediaItem: InsertMediaItem): Promise<MediaItem> {
    const result = await db.insert(mediaItems).values(mediaItem).returning();
    return result[0];
  }

  async updateMediaItem(id: number, mediaItem: Partial<InsertMediaItem>): Promise<MediaItem> {
    const result = await db
      .update(mediaItems)
      .set(mediaItem)
      .where(db.eq(mediaItems.id, id))
      .returning();

    if (result.length === 0) {
      throw new Error("Media item not found");
    }

    return result[0];
  }

  async deleteMediaItem(id: number): Promise<void> {
    await db.delete(mediaItems).where(db.eq(mediaItems.id, id));
  }
}

// Singleton instance
export const storage = new DatabaseStorage();