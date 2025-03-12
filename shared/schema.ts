import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
});

// New Series table
export const series = pgTable("series", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  logo: text("logo").notNull(),
  description: text("description"),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  coverImage: text("cover_image"),
  customThumbnail: text("custom_thumbnail"),
  date: timestamp("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  seriesId: integer("series_id").references(() => series.id), // Added series reference
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

// New Series schema
export const insertSeriesSchema = createInsertSchema(series).extend({
  name: z.string().min(1, "Series name is required"),
  logo: z.string().min(1, "Logo URL is required"),
  description: z.string().optional(),
});

export const insertEventSchema = createInsertSchema(events).extend({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  coverImage: z.string().optional(),
  customThumbnail: z.string().optional(),
  date: z.coerce.date(),
  seriesId: z.number().optional(), // Added to schema
});

export const insertMediaItemSchema = createInsertSchema(mediaItems).extend({
  eventId: z.number(),
  type: z.enum(["image", "video"]),
  url: z.string().min(1, "Media URL is required"),
  thumbnail: z.string().min(1, "Thumbnail is required"),
  caption: z.string().optional(),
  photographer: z.string().optional(),
  tags: z.union([z.string(), z.array(z.string())]).transform(val =>
    typeof val === 'string' ? val.split(',').map(tag => tag.trim()) : val
  ),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Series = typeof series.$inferSelect;
export type InsertSeries = z.infer<typeof insertSeriesSchema>;
export type Event = typeof events.$inferSelect;
export type MediaItem = typeof mediaItems.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertMediaItem = z.infer<typeof insertMediaItemSchema>;