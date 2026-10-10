import type { Express } from "express";
import { and, eq, isNull, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { events, users, creatorEventAssociations as links } from "@shared/schema";
import { publicEventPredicate, SAFETY_POLICY } from "./beta-policy";
import { requireCreator } from "./middleware/auth";

// Stricter than historical official-event access: a selectable target must be
// explicitly public, free, and safe. Manager privileges never expand this list.
const officialPredicate = () => and(
  isNull(events.creatorId), eq(events.visibility, "published"),
  eq(events.adminHidden, false), eq(events.isPremium, false),
  sql`(${events.safetyStatus}='legacy' or (${events.safetyStatus}='approved'
    and ${events.safetyPolicy}=${SAFETY_POLICY}
    and ${events.contentVersion}=${events.safetyVersion}))`,
);
const summary = { id: events.id, title: events.title, date: events.date };
const idSchema = z.coerce.number().int().positive().max(2147483647);
const associationBody = z.object({
  officialEventId: z.number().int().positive().max(2147483647).nullable(),
}).strict();

class AssociationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Owner/source/target locks serialize against deletion and visibility edits.
 * No gallery update, publication, safety reset, quota or personal-state writes.
 */
export async function setOfficialEvent(galleryId: number, ownerId: number, officialEventId: number | null) {
  return db.transaction(async tx => {
    const [owner] = await tx.select({ suspended: users.suspended, status: users.creatorStatus })
      .from(users).where(eq(users.id, ownerId)).for("update");
    if (!owner || owner.suspended || owner.status === "rejected")
      throw new AssociationError(403, "Creator access is blocked.");
    // Consistent row order also covers racing target/source removal.
    await tx.execute(sql`select id from events where id=${galleryId}
      or id=${officialEventId} order by id for update`);
    const [gallery] = await tx.select({ creatorId: events.creatorId })
      .from(events).where(eq(events.id, galleryId));
    if (!gallery || gallery.creatorId !== ownerId)
      throw new AssociationError(404, "Owned gallery not found.");
    if (officialEventId === null) {
      await tx.delete(links).where(eq(links.galleryId, galleryId));
    } else {
      const [target] = await tx.select({ id: events.id }).from(events)
        .where(and(eq(events.id, officialEventId), officialPredicate()));
      if (!target) throw new AssociationError(404, "Official event is not available.");
      await tx.insert(links).values({ galleryId, officialEventId }).onConflictDoUpdate({
        target: links.galleryId, set: { officialEventId },
      });
    }
    return { galleryId, officialEventId };
  });
}

export function registerCreatorEventAssociationRoutes(app: Express) {
  app.get("/api/creator/official-events", requireCreator, async (_req, res) => {
    try {
      res.json(await db.select(summary).from(events).where(officialPredicate())
        .orderBy(desc(events.date), desc(events.id)));
    } catch {
      res.status(500).json({ error: "Official events could not be loaded." });
    }
  });
  app.get("/api/creator/event-associations", requireCreator, async (req, res) => {
    try {
      // A hidden target's title, date and even ID must not be disclosed through
      // a private link. Redact using the same statement/snapshot.
      const eligibleTargets = db.select({ id: events.id }).from(events).where(officialPredicate());
      const rows = await db.select({ galleryId: links.galleryId,
        officialEventId: sql<number | null>`case when ${links.officialEventId} in (${eligibleTargets})
          then ${links.officialEventId} else null end` })
        .from(links).innerJoin(events, eq(links.galleryId, events.id))
        .where(eq(events.creatorId, req.user!.id));
      res.json(rows.map(row => ({
        ...row, unavailable: row.officialEventId === null,
      })));
    } catch {
      res.status(500).json({ error: "Gallery associations could not be loaded." });
    }
  });
  app.put("/api/creator/events/:id/official-event", requireCreator, async (req, res) => {
    const id = idSchema.safeParse(req.params.id), body = associationBody.safeParse(req.body);
    if (!id.success || !body.success)
      return res.status(400).json({ error: "Select an official event or remove the association." });
    try {
      res.json(await setOfficialEvent(id.data, req.user!.id, body.data.officialEventId));
    } catch (error) {
      res.status(error instanceof AssociationError ? error.status : 500)
        .json({ error: error instanceof AssociationError ? error.message : "Association could not be saved." });
    }
  });
  app.get("/api/events/:id/community-galleries", async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ error: "Official event not found." });
    try {
      // One statement checks both target and galleries in the same snapshot.
      const target = await db.select({ id: events.id }).from(events)
        .where(and(eq(events.id, id.data), officialPredicate()));
      if (!target.length) return res.status(404).json({ error: "Official event not found." });
      const eligibleTargets = db.select({ id: events.id }).from(events).where(officialPredicate());
      const rows = await db.select({ ...summary, creatorId: events.creatorId, creatorName: users.username })
        .from(links).innerJoin(events, eq(events.id, links.galleryId))
        .innerJoin(users, eq(users.id, events.creatorId))
        .where(and(eq(links.officialEventId, id.data), eq(events.isPremium, false),
          publicEventPredicate(), sql`${links.officialEventId} in (${eligibleTargets})`))
        .orderBy(desc(events.date), desc(events.id));
      res.json(rows);
    } catch {
      res.status(500).json({ error: "Community galleries could not be loaded." });
    }
  });
}
