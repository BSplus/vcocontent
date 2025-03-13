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

export class DatabaseStorage implements IStorage {
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

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getSeries(id?: number): Promise<Series | Series[] | undefined> {
    if (id) {
      const [seriesItem] = await db.select().from(seriesTable).where(eq(seriesTable.id, id));
      return seriesItem;
    }
    return await db.select().from(seriesTable);
  }

  async createSeries(insertSeries: InsertSeries): Promise<Series> {
    const [newSeries] = await db.insert(seriesTable).values(insertSeries).returning();
    return newSeries;
  }

  async updateSeries(id: number, updateData: Partial<InsertSeries>): Promise<Series> {
    const [updatedSeries] = await db
      .update(seriesTable)
      .set(updateData)
      .where(eq(seriesTable.id, id))
      .returning();

    if (!updatedSeries) throw new Error("Series not found");
    return updatedSeries;
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

  async createEvent(event: InsertEvent): Promise<Event> {
    const [newEvent] = await db.insert(events).values(event).returning();
    return newEvent;
  }

  async updateEvent(id: number, event: Partial<InsertEvent>): Promise<Event> {
    const [updatedEvent] = await db
      .update(events)
      .set(event)
      .where(eq(events.id, id))
      .returning();

    if (!updatedEvent) throw new Error("Event not found");
    return updatedEvent;
  }

  async deleteEvent(id: number): Promise<void> {
    await db.delete(events).where(eq(events.id, id));
  }

  async getMediaItems(eventId: number): Promise<MediaItem[]> {
    return await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.eventId, eventId));
  }

  async createMediaItem(item: InsertMediaItem): Promise<MediaItem> {
    const [newItem] = await db.insert(mediaItems).values(item).returning();
    return newItem;
  }

  async updateMediaItem(id: number, item: Partial<InsertMediaItem>): Promise<MediaItem> {
    const [updatedItem] = await db
      .update(mediaItems)
      .set(item)
      .where(eq(mediaItems.id, id))
      .returning();

    if (!updatedItem) throw new Error("Media item not found");
    return updatedItem;
  }

  async deleteMediaItem(id: number): Promise<void> {
    await db.delete(mediaItems).where(eq(mediaItems.id, id));
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }
}

export const storage = new DatabaseStorage();
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { db } from "./db";
import session from "express-session";
import PgSimpleStore from "connect-pg-simple";
import { pool } from "./db";

// Create PostgreSQL session store
const PgStore = PgSimpleStore(session);
export const sessionStore = new PgStore({
  pool,
  tableName: 'session', // Uses standard table name
});

// User operations
export const storage = {
  sessionStore,

  // User methods
  async getUser(id: number) {
    const users = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return users[0];
  },

  async getUserByUsername(username: string) {
    const users = await db.select().from(schema.users).where(eq(schema.users.username, username));
    return users[0];
  },

  async getAllUsers() {
    return await db.select().from(schema.users);
  },

  async createUser(data: { username: string; password: string; isAdmin: boolean }) {
    const created = await db.insert(schema.users).values(data).returning();
    return created[0];
  },

  // Series methods
  async getSeries(id?: number) {
    if (id) {
      const series = await db.select().from(schema.series).where(eq(schema.series.id, id));
      return series[0];
    }
    return await db.select().from(schema.series);
  },

  async createSeries(data: schema.InsertSeries) {
    const created = await db.insert(schema.series).values(data).returning();
    return created[0];
  },

  async updateSeries(id: number, data: Partial<schema.InsertSeries>) {
    const updated = await db.update(schema.series)
      .set(data)
      .where(eq(schema.series.id, id))
      .returning();
    
    if (!updated.length) {
      throw new Error("Series not found");
    }
    
    return updated[0];
  },

  async deleteSeries(id: number) {
    return await db.delete(schema.series).where(eq(schema.series.id, id));
  },

  // Event methods
  async getEvents() {
    return await db.select().from(schema.events);
  },

  async getEvent(id: number) {
    const events = await db.select().from(schema.events).where(eq(schema.events.id, id));
    return events[0];
  },

  async createEvent(data: schema.InsertEvent) {
    const created = await db.insert(schema.events).values(data).returning();
    return created[0];
  },

  async updateEvent(id: number, data: Partial<schema.InsertEvent>) {
    const updated = await db.update(schema.events)
      .set(data)
      .where(eq(schema.events.id, id))
      .returning();
    
    if (!updated.length) {
      throw new Error("Event not found");
    }
    
    return updated[0];
  },

  async deleteEvent(id: number) {
    return await db.delete(schema.events).where(eq(schema.events.id, id));
  },

  // Media methods
  async getMediaItems(eventId: number) {
    return await db.select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.eventId, eventId));
  },

  async createMediaItem(data: schema.InsertMediaItem) {
    const created = await db.insert(schema.mediaItems).values(data).returning();
    return created[0];
  },

  async updateMediaItem(id: number, data: Partial<schema.InsertMediaItem>) {
    const updated = await db.update(schema.mediaItems)
      .set(data)
      .where(eq(schema.mediaItems.id, id))
      .returning();
    
    if (!updated.length) {
      throw new Error("Media item not found");
    }
    
    return updated[0];
  },

  async deleteMediaItem(id: number) {
    return await db.delete(schema.mediaItems).where(eq(schema.mediaItems.id, id));
  }
};
