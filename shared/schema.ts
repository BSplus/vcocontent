import { pgTable, text, serial, integer, timestamp, boolean, decimal, bigint, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
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
  round: text("round"),
  track: text("track"),
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

export const eventEntries = pgTable("event_entries", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  team: text("team").notNull(),
  car: text("car").notNull(),
  drivers: text("drivers").notNull(),
}, table => [index("event_entries_event_idx").on(table.eventId)]);

export const entryRowSchema = z.object({
  number: z.string().trim().regex(/^[0-9]{1,4}$/, "Startnummer muss 1–4 Ziffern enthalten"),
  team: z.string().trim().min(1).max(160),
  car: z.string().trim().min(1).max(160),
  drivers: z.string().trim().min(1).max(500),
});
export type EntryRow = z.infer<typeof entryRowSchema>;

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
  storedBytes: bigint("stored_bytes", { mode: "number" }),
  highBytes: bigint("high_bytes", { mode: "number" }),
  lowBytes: bigint("low_bytes", { mode: "number" }),
  objectCount: integer("object_count"),
}, (table) => [
  index("media_event_page_idx").on(table.eventId, table.id),
  index("media_url_idx").on(table.url).where(sql`${table.url} like '/api/media/files/%'`),
  index("media_thumbnail_idx").on(table.thumbnail).where(sql`${table.thumbnail} like '/api/media/files/%'`),
  index("media_popular_idx").on(table.downloadCount),
]);

export const mediaReservations = pgTable("media_reservations", {
  id: text("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  creatorId: integer("creator_id"),
  reservedBytes: bigint("reserved_bytes", { mode: "number" }).notNull(),
  storageKey: text("storage_key").notNull(),
  thumbnailKey: text("thumbnail_key").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const mediaCleanup = pgTable("media_cleanup", {
  key: text("key").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastError: text("last_error"),
});

export const nextcloudJobs = pgTable("nextcloud_jobs", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("idle"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  error: text("error"),
  skipped: integer("skipped").notNull().default(0),
}, table => [uniqueIndex("nextcloud_job_event_idx").on(table.eventId)]);

export const nextcloudFiles = pgTable("nextcloud_files", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  sourceKey: text("source_key").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("pending"),
  mediaId: integer("media_id").references(() => mediaItems.id, { onDelete: "set null" }),
  message: text("message"),
  aiWarning: text("ai_warning"),
}, table => [uniqueIndex("nextcloud_file_source_idx").on(table.eventId, table.sourceKey)]);

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
  round: z.string().trim().max(100).nullable().optional(),
  track: z.string().trim().max(160).nullable().optional(),
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
  url: z.union([z.string().url(), z.string().regex(/^\/api\/media\/files\/media-[0-9a-f-]{36}\.(jpg|png|gif|webp|mp4|mov|webm)$/)]),
  thumbnail: z.union([z.string().url(), z.string().regex(/^\/api\/media\/files\/thumb-[0-9a-f-]{36}\.webp$/)]),
  caption: z.string().max(1000, "Caption cannot exceed 1000 characters").optional(),
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