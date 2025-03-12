import { User, Event, MediaItem, InsertUser, InsertEvent, InsertMediaItem } from "@shared/schema";
import session from "express-session";
import createMemoryStore from "memorystore";

const MemoryStore = createMemoryStore(session);

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
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

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private events: Map<number, Event>;
  private mediaItems: Map<number, MediaItem>;
  private currentUserId: number;
  private currentEventId: number;
  private currentMediaId: number;
  sessionStore: session.Store;

  constructor() {
    this.users = new Map();
    this.events = new Map();
    this.mediaItems = new Map();
    this.currentUserId = 1;
    this.currentEventId = 1;
    this.currentMediaId = 1;
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000,
    });
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id, isAdmin: false };
    this.users.set(id, user);
    return user;
  }

  async getEvents(): Promise<Event[]> {
    return Array.from(this.events.values());
  }

  async getEvent(id: number): Promise<Event | undefined> {
    return this.events.get(id);
  }

  async createEvent(event: InsertEvent): Promise<Event> {
    const id = this.currentEventId++;
    const newEvent: Event = { 
      ...event, 
      id, 
      createdAt: new Date() 
    };
    this.events.set(id, newEvent);
    return newEvent;
  }

  async updateEvent(id: number, event: Partial<InsertEvent>): Promise<Event> {
    const existingEvent = await this.getEvent(id);
    if (!existingEvent) throw new Error("Event not found");
    
    const updatedEvent = { ...existingEvent, ...event };
    this.events.set(id, updatedEvent);
    return updatedEvent;
  }

  async deleteEvent(id: number): Promise<void> {
    this.events.delete(id);
  }

  async getMediaItems(eventId: number): Promise<MediaItem[]> {
    return Array.from(this.mediaItems.values()).filter(
      (item) => item.eventId === eventId
    );
  }

  async createMediaItem(item: InsertMediaItem): Promise<MediaItem> {
    const id = this.currentMediaId++;
    const newItem: MediaItem = {
      ...item,
      id,
      createdAt: new Date()
    };
    this.mediaItems.set(id, newItem);
    return newItem;
  }

  async updateMediaItem(id: number, item: Partial<InsertMediaItem>): Promise<MediaItem> {
    const existingItem = this.mediaItems.get(id);
    if (!existingItem) throw new Error("Media item not found");
    
    const updatedItem = { ...existingItem, ...item };
    this.mediaItems.set(id, updatedItem);
    return updatedItem;
  }

  async deleteMediaItem(id: number): Promise<void> {
    this.mediaItems.delete(id);
  }
}

export const storage = new MemStorage();
