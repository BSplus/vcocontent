import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  coverImage: text("cover_image"),
  date: timestamp("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const mediaItems = pgTable("media_items", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id),
  type: text("type").notNull(), // 'image' or 'video'
  url: text("url").notNull(),
  thumbnail: text("thumbnail").notNull(),
  caption: text("caption"),
  photographer: text("photographer"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertEventSchema = createInsertSchema(events).extend({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  coverImage: z.string().optional(),
  date: z.coerce.date()
});

export const insertMediaItemSchema = createInsertSchema(mediaItems).pick({
  eventId: true,
  type: true,
  url: true,
  thumbnail: true,
  caption: true,
  photographer: true,
  tags: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Event = typeof events.$inferSelect;
export type MediaItem = typeof mediaItems.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertMediaItem = z.infer<typeof insertMediaItemSchema>;