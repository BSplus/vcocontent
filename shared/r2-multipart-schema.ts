/**
 * PREPARED ONLY: deliberately not exported from shared/schema.ts (the active
 * drizzle-kit entry point). No startup DDL. Apply only with separate approval.
 */
import {pgTable,text,integer,jsonb,timestamp,uniqueIndex,check} from "drizzle-orm/pg-core";
import {sql} from "drizzle-orm";
import {mediaReservations,mediaUploadSessions} from "./schema";
import type {MultipartCheckpoint} from "../server/r2-multipart-upload";

export const r2MultipartJournals=pgTable("media_r2_multipart_journals",{
  sessionId:text("session_id").primaryKey().references(()=>mediaUploadSessions.id,{onDelete:"restrict"}),
  reservationId:text("reservation_id").notNull().references(()=>mediaReservations.id,{onDelete:"restrict"}),
  scope:text("scope").notNull(),
  objectKey:text("object_key").notNull(),
  binding:text("binding").notNull(),
  revision:integer("revision").notNull().default(0),
  checkpoint:jsonb("checkpoint").$type<MultipartCheckpoint>(),
  updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[
  uniqueIndex("r2_multipart_destination_idx").on(t.scope,t.objectKey),
  uniqueIndex("r2_multipart_reservation_idx").on(t.reservationId),
  check("r2_multipart_reservation_session",sql`${t.sessionId} = ${t.reservationId}`),
  check("r2_multipart_revision",sql`${t.revision} >= 0`),
  check("r2_multipart_binding",sql`${t.binding} ~ '^[a-f0-9]{64}$'`),
  check("r2_multipart_scope",sql`${t.scope} ~ '^[a-f0-9]{64}$'`),
  check("r2_multipart_checkpoint",sql`${t.checkpoint} is null or jsonb_typeof(${t.checkpoint}) = 'object'`),
]);
