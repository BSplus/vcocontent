import { pgTable, text, serial, integer, timestamp, boolean, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  isCreator: boolean("is_creator").notNull().default(false),
  creatorStatus: text("creator_status").default('pending'), // pending, approved, rejected
  credits: decimal("credits").notNull().default('0'),
  profileImage: text("profile_image"),
  bio: text("bio"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const series = pgTable("series", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  logo: text("logo"),
  description: text("description"),
  creatorId: integer("creator_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  coverImage: text("cover_image"),
  customThumbnail: text("custom_thumbnail"),
  date: timestamp("date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  seriesId: integer("series_id").references(() => series.id),
  creatorId: integer("creator_id").references(() => users.id),
  isPremium: boolean("is_premium").notNull().default(false),
  creditCost: integer("credit_cost").default(1),
  viewCount: integer("view_count").notNull().default(0),
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
  category: text("category"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  downloadCount: integer("download_count").notNull().default(0),
  isPremium: boolean("is_premium").notNull().default(false),
  creditCost: integer("credit_cost").default(1),
});

// Insert schemas with validation
export const insertUserSchema = createInsertSchema(users).extend({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  profileImage: z.string().url("Invalid profile image URL").optional(),
  bio: z.string().max(500, "Bio cannot exceed 500 characters").optional(),
});

export const insertSeriesSchema = createInsertSchema(series).extend({
  name: z.string().min(1, "Series name is required"),
  logo: z.string().url("Invalid logo URL").optional(),
  description: z.string().max(1000, "Description cannot exceed 1000 characters").optional(),
  creatorId: z.number().optional(),
});

export const insertEventSchema = createInsertSchema(events).extend({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  coverImage: z.string().optional(),
  customThumbnail: z.string().optional(),
  date: z.coerce.date(),
  seriesId: z.number().optional(),
  creatorId: z.number().optional(),
  isPremium: z.boolean().optional(),
  creditCost: z.number().min(1, "Credit cost must be at least 1").optional(),
});

export const insertMediaItemSchema = createInsertSchema(mediaItems).extend({
  eventId: z.number(),
  type: z.enum(["image", "video"]),
  url: z.string().url("Invalid media URL"),
  thumbnail: z.string().url("Invalid thumbnail URL"),
  caption: z.string().max(200, "Caption cannot exceed 200 characters").optional(),
  photographer: z.string().optional(),
  tags: z.array(z.string()),
  category: z.string().optional(),
  isPremium: z.boolean().optional(),
  creditCost: z.number().min(1, "Credit cost must be at least 1").optional(),
});

// Export types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Series = typeof series.$inferSelect;
export type InsertSeries = z.infer<typeof insertSeriesSchema>;
export type Event = typeof events.$inferSelect;
export type MediaItem = typeof mediaItems.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertMediaItem = z.infer<typeof insertMediaItemSchema>;