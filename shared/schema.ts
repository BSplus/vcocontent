import { pgTable, text, serial, integer, timestamp, boolean, decimal, bigint, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
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
  profileImagePublic: boolean("profile_image_public").notNull().default(false),
  bio: text("bio"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  emailVerifiedAt: timestamp("email_verified_at"),
  suspended: boolean("suspended").notNull().default(false),
  quotaException: boolean("quota_exception").notNull().default(false),
  analysisLastServedAt: timestamp("analysis_last_served_at"),
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
  referenceRevision: integer("reference_revision").notNull().default(0),
  referenceSeasonYear: integer("reference_season_year"),
  visibility: text("visibility").notNull().default("published"),
  adminHidden: boolean("admin_hidden").notNull().default(false),
  contentVersion: integer("content_version").notNull().default(0),
  safetyVersion: integer("safety_version").notNull().default(0),
  safetyStatus: text("safety_status").notNull().default("legacy"),
  safetyPolicy: text("safety_policy"),
  safetyReason: text("safety_reason"),
});

export const eventEntries = pgTable("event_entries", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  team: text("team").notNull(),
  car: text("car").notNull(),
  drivers: text("drivers").notNull(),
  manufacturer: text("manufacturer").notNull().default(""),
  racingClass: text("racing_class").notNull().default(""),
  discipline: text("discipline").notNull().default(""),
}, table => [index("event_entries_event_idx").on(table.eventId)]);

export const entryRowSchema = z.object({
  number: z.string().trim().regex(/^[0-9]{0,4}$/, "Race number must contain up to four digits"),
  team: z.string().trim().max(160),
  car: z.string().trim().max(160),
  drivers: z.string().trim().max(500),
  manufacturer: z.string().trim().max(160).optional(),
  racingClass: z.string().trim().max(160).optional(),
  discipline: z.string().trim().max(160).optional(),
  eventName: z.string().trim().max(160).optional(),
  session: z.string().trim().max(120).optional(),
});
export type EntryRow = z.infer<typeof entryRowSchema>;
export const identificationSchema = z.object({
  number: z.string().trim().regex(/^[0-9]{0,4}$/),
  team: z.string().trim().max(160),
  drivers: z.string().trim().max(500),
  vehicle: z.string().trim().max(160),
  manufacturer: z.string().trim().max(160),
  racingClass: z.string().trim().max(160),
  discipline: z.string().trim().max(160),
  source: z.enum(["reference", "visual", "manual"]).default("manual"),
});
export type Identification = z.infer<typeof identificationSchema>;
export const referenceDocuments = pgTable("reference_documents", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id, { onDelete: "cascade" }),
  seriesId: integer("series_id").references(() => series.id),
  ownerId: integer("owner_id").references(() => users.id),
  seasonYear: integer("season_year").notNull(),
  scope: text("scope").notNull(),
  kind: text("kind").notNull(),
  session: text("session"),
  title: text("title").notNull(),
  sourceKey: text("source_key"),
  fingerprint: text("fingerprint").notNull(),
  identityKey: text("identity_key").notNull().unique(),
  rows: jsonb("rows").$type<EntryRow[]>().notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  storedBytes: bigint("stored_bytes", { mode: "number" }),
}, table => [index("reference_scope_idx").on(table.seriesId, table.seasonYear, table.ownerId),
  index("reference_event_idx").on(table.eventId)]);

export const mediaItems = pgTable("media_items", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id),
  type: text("type").notNull(), // 'image' or 'video'
  url: text("url").notNull(),
  thumbnail: text("thumbnail").notNull(),
  caption: text("caption"),
  captionSource: text("caption_source").notNull().default("preserved"),
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
  identification: jsonb("identification").$type<Identification[]>().notNull().default([]),
  identificationManual: boolean("identification_manual").notNull().default(false),
  recognitionSession: text("recognition_session"),
  suppressedAITags: text("suppressed_ai_tags").array().notNull().default([]),
  manualTags: text("manual_tags").array().notNull().default([]),
  contentVersion: integer("content_version").notNull().default(0),
  safetyVersion: integer("safety_version").notNull().default(0),
  safetyStatus: text("safety_status").notNull().default("legacy"),
  safetyPolicy: text("safety_policy"),
  safetyReason: text("safety_reason"),
}, (table) => [
  index("media_event_page_idx").on(table.eventId, table.id),
  index("media_url_idx").on(table.url).where(sql`${table.url} like '/api/media/files/%'`),
  index("media_thumbnail_idx").on(table.thumbnail).where(sql`${table.thumbnail} like '/api/media/files/%'`),
  index("media_popular_idx").on(table.downloadCount),
]);

export const communityLikes = pgTable("community_likes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, {onDelete:"cascade"}),
  mediaId: integer("media_id").references(() => mediaItems.id, {onDelete:"cascade"}),
  eventId: integer("event_id").references(() => events.id, {onDelete:"cascade"}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => [uniqueIndex("likes_user_media").on(t.userId,t.mediaId),uniqueIndex("likes_user_event").on(t.userId,t.eventId)]);
export const communityFavorites = pgTable("community_favorites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, {onDelete:"cascade"}),
  mediaId: integer("media_id").references(() => mediaItems.id, {onDelete:"cascade"}),
  eventId: integer("event_id").references(() => events.id, {onDelete:"cascade"}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => [uniqueIndex("favorites_user_media").on(t.userId,t.mediaId),uniqueIndex("favorites_user_event").on(t.userId,t.eventId)]);
export const downloadOperations = pgTable("download_operations", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id,{onDelete:"cascade"}),
  mediaId: integer("media_id").notNull().references(() => mediaItems.id,{onDelete:"cascade"}),
  quality: text("quality").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const downloadHistory = pgTable("download_history", {
  id: serial("id").primaryKey(),
  operationId: text("operation_id").notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id,{onDelete:"cascade"}),
  mediaId: integer("media_id").notNull().references(() => mediaItems.id,{onDelete:"cascade"}),
  quality: text("quality").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t=>[index("downloads_user_date").on(t.userId,t.createdAt)]);

export const mediaReservations = pgTable("media_reservations", {
  id: text("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  creatorId: integer("creator_id"),
  reservedBytes: bigint("reserved_bytes", { mode: "number" }).notNull(),
  replacesReferenceId: integer("replaces_reference_id"),
  storageKey: text("storage_key").notNull(),
  thumbnailKey: text("thumbnail_key").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const mediaCleanup = pgTable("media_cleanup", {
  key: text("key").primaryKey(),
  creatorId: integer("creator_id").references(() => users.id, {onDelete:"set null"}),
  storedBytes: bigint("stored_bytes", {mode:"number"}),
  photoToken: text("photo_token"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastError: text("last_error"),
});

export const emailVerifications = pgTable("email_verifications", {
  userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  usedAt: timestamp("used_at"),
});

export const betaRateLimits = pgTable("beta_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at").notNull(),
});

export const safetyResults = pgTable("safety_results", {
  fingerprint: text("fingerprint").primaryKey(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const safetyReviews = pgTable("safety_reviews", {
  id: serial("id").primaryKey(),
  resource: text("resource").notNull(),
  resourceId: integer("resource_id").notNull(),
  version: integer("version").notNull(),
  adminId: integer("admin_id").notNull().references(() => users.id),
  decision: text("decision").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const nextcloudJobs = pgTable("nextcloud_jobs", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("idle"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  error: text("error"),
  skipped: integer("skipped").notNull().default(0),
  // Auth and source URLs are encrypted, never returned in status responses.
  manifest: text("manifest"),
  manifestExpiresAt: timestamp("manifest_expires_at"),
  workerToken: text("worker_token"),
}, table => [uniqueIndex("nextcloud_job_event_idx").on(table.eventId),
  index("nextcloud_job_ready_idx").on(table.status, table.updatedAt)]);

export const mediaAnalysisJobs = pgTable("media_analysis_jobs", {
  mediaId: integer("media_id").primaryKey().references(() => mediaItems.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  workerToken: text("worker_token"),
  generatedTags: text("generated_tags").array(),
  error: text("error"),
  durationMs: integer("duration_ms"),
  recognition: jsonb("recognition").$type<Identification[]>(),
  referenceRevision: integer("reference_revision").notNull().default(0),
  referenceOnly: boolean("reference_only").notNull().default(false),
  generation: integer("generation").notNull().default(1),
  videoEvidence: jsonb("video_evidence").$type<import("../server/video-recognition").VideoEvidence>(),
}, table => [index("media_analysis_ready_idx").on(table.status, table.availableAt)]);

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
  referenceSeasonYear:z.number().int().min(1990).max(2100).nullable().optional(),
}).omit({referenceRevision:true,visibility:true,adminHidden:true,contentVersion:true,safetyVersion:true,safetyStatus:true,safetyPolicy:true,safetyReason:true});

export const insertMediaItemSchema = createInsertSchema(mediaItems).extend({
  eventId: z.number(),
  type: z.enum(["image", "video"]),
  url: z.union([z.string().url(), z.string().regex(/^\/api\/media\/files\/media-[0-9a-f-]{36}\.(jpg|png|gif|webp|mp4|mov|webm)$/)]),
  thumbnail: z.union([z.string().url(), z.string().regex(/^\/api\/media\/files\/thumb-[0-9a-f-]{36}\.webp$/)]),
  caption: z.string().max(1000, "Caption cannot exceed 1000 characters").optional(),
  photographer: z.string().optional(),
  tags: z.array(z.string()),
  category: z.string().optional(),
  identification: z.array(identificationSchema).max(12).optional(),
  isPremium: z.boolean().optional(),
  creditCost: z.number().min(1, "Credit cost must be at least 1").optional(),
}).omit({captionSource:true,contentVersion:true,safetyVersion:true,safetyStatus:true,safetyPolicy:true,safetyReason:true});

// Export types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Series = typeof series.$inferSelect;
export type InsertSeries = z.infer<typeof insertSeriesSchema>;
export type Event = typeof events.$inferSelect;
export type MediaItem = typeof mediaItems.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertMediaItem = z.infer<typeof insertMediaItemSchema>;
