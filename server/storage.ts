import { User, Event, MediaItem, InsertUser, InsertEvent, InsertMediaItem, Series, InsertSeries } from "@shared/schema";
import { users, events, mediaItems, series as seriesTable } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm"; // Korrekter Import für Datenbankoperationen
import session from "express-session";
import memorystore from "memorystore";

// Interface für alle Speicherfunktionen der Anwendung
interface IStorage {
  sessionStore: session.Store;

  // Benutzerverwaltung
  getUsers(): Promise<User[]>;
  getUser(id: number): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser & { isAdmin?: boolean }): Promise<User>;

  // Eventverwaltung
  getEvents(): Promise<Event[]>;
  getEvent(id: number): Promise<Event | undefined>;
  createEvent(event: InsertEvent): Promise<Event>;
  updateEvent(id: number, event: Partial<InsertEvent>): Promise<Event>;
  deleteEvent(id: number): Promise<void>;

  // Serienverwaltung
  getSeries(id?: number): Promise<Series[] | Series | undefined>;
  createSeries(series: InsertSeries): Promise<Series>;
  updateSeries(id: number, series: Partial<InsertSeries>): Promise<Series>;
  deleteSeries(id: number): Promise<void>;

  // Medienverwaltung
  getAllMediaItems(): Promise<MediaItem[]>;
  getMediaItems(eventId: number): Promise<MediaItem[]>;
  createMediaItem(mediaItem: InsertMediaItem): Promise<MediaItem>;
  updateMediaItem(id: number, mediaItem: Partial<InsertMediaItem>): Promise<MediaItem>;
  deleteMediaItem(id: number): Promise<void>;
}

// Hauptklasse für Datenbankoperationen
class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    // Speicher für Benutzersitzungen
    const MemoryStore = memorystore(session);
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000 // Bereinige abgelaufene Einträge alle 24h
    });
  }

  // Benutzerverwaltungsmethoden
  async getUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async getUser(id: number): Promise<User | undefined> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return result[0];
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return result[0];
  }

  async createUser(user: InsertUser & { isAdmin?: boolean }): Promise<User> {
    const result = await db.insert(users).values(user).returning();
    return result[0];
  }

  // Eventverwaltungsmethoden
  async getEvents(): Promise<Event[]> {
    return await db.select().from(events).orderBy(events.date);
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
      throw new Error("Event nicht gefunden");
    }

    return result[0];
  }

  async deleteEvent(id: number): Promise<void> {
    await db.delete(events).where(eq(events.id, id));
  }

  // Serienverwaltungsmethoden
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
      throw new Error("Serie nicht gefunden");
    }

    return result[0];
  }

  async deleteSeries(id: number): Promise<void> {
    await db.delete(seriesTable).where(eq(seriesTable.id, id));
  }

  // Medienverwaltungsmethoden
  async getAllMediaItems(): Promise<MediaItem[]> {
    return await db.select().from(mediaItems);
  }

  async getMediaItems(eventId: number): Promise<MediaItem[]> {
    return await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.eventId, eventId));
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
      throw new Error("Medienelement nicht gefunden");
    }

    return result[0];
  }

  async deleteMediaItem(id: number): Promise<void> {
    await db.delete(mediaItems).where(eq(mediaItems.id, id));
  }
}

// Einzelne Instanz für die gesamte Anwendung
export const storage = new DatabaseStorage();