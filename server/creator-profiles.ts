import type { Express } from "express";
import { and, eq, inArray, asc, desc, sql } from "drizzle-orm";
import { creatorFollows, users } from "@shared/schema";
import { db } from "./db";
import { storage } from "./storage";
import { pageMetadata } from "@shared/pagination";
import { requireAuth } from "./middleware/auth";
import { creatorAllowed, takeBetaRate } from "./beta-policy";

export const activeCreator = (user: Parameters<typeof creatorAllowed>[0]) =>
  !!user && user.creatorStatus !== "rejected" && creatorAllowed(user);
type ProfileUser = Pick<typeof users.$inferSelect, "id" | "username" | "isCreator" | "creatorStatus" | "bio" |
  "profileImage" | "profileImagePublic" | "displayName" | "profileCoverImage" | "profileCoverPublic" |
  "publicContactEmail" | "websiteUrl" | "instagramUrl">;

export function publicCreator(user: ProfileUser, state: { followerCount: number; following: boolean }) {
  // Intentionally whitelist public fields; account email and billing fields never enter this response.
  return {
    id: user.id, username: user.username, isCreator: user.isCreator, creatorStatus: user.creatorStatus,
    bio: user.bio, profileImage: user.profileImagePublic ? user.profileImage : null,
    displayName: user.displayName, coverImage: user.profileCoverPublic ? user.profileCoverImage : null,
    publicContactEmail: user.publicContactEmail, websiteUrl: user.websiteUrl, instagramUrl: user.instagramUrl,
    profileUrl: `/creator/${user.id}`, ...state,
  };
}

export async function creatorFollowState(creatorId: number, viewerId?: number, executor: any = db) {
  const result = await executor.execute(sql`
    select (select count(*)::int from creator_follows f join users u on u.id=f.user_id
      where f.creator_id=${creatorId} and not u.suspended) as count,
    exists(select 1 from creator_follows f join users u on u.id=f.user_id
      where f.creator_id=${creatorId} and f.user_id=${viewerId ?? 0} and not u.suspended) as following`);
  return { followerCount: Number(result.rows[0].count), following: !!result.rows[0].following };
}

export function registerCreatorProfiles(app: Express) {
  for (const method of ["put", "delete"] as const) app[method]("/api/creators/:id/follow", requireAuth, async (req, res) => {
    try {
      const creatorId = Number(req.params.id), viewerId = req.user!.id;
      if (!Number.isSafeInteger(creatorId) || creatorId < 1) return res.status(400).json({ error: "Invalid creator." });
      if (viewerId === creatorId) return res.status(400).json({ error: "You cannot follow yourself." });
      if (!await takeBetaRate(`follow:${viewerId}`, 90, 60000)) return res.status(429).json({ error: "Please wait before following again." });
      const state = await db.transaction(async tx => {
        // Consistent lock order serializes duplicate requests and account suspension without deadlocks.
        const locked = await tx.select().from(users).where(inArray(users.id, [viewerId, creatorId])).orderBy(asc(users.id)).for("update");
        const actor = locked.find(user => user.id === viewerId), creator = locked.find(user => user.id === creatorId);
        if (!actor || actor.suspended || !activeCreator(creator)) return null;
        if (method === "put") await tx.insert(creatorFollows).values({ userId: viewerId, creatorId }).onConflictDoNothing();
        else await tx.delete(creatorFollows).where(and(eq(creatorFollows.userId, viewerId), eq(creatorFollows.creatorId, creatorId)));
        return creatorFollowState(creatorId, viewerId, tx);
      });
      if (!state) return res.status(404).json({ error: "Creator is unavailable." });
      res.setHeader("Cache-Control", "private, no-store"); res.json(state);
    } catch { res.status(503).json({ error: "Your follow change could not be saved." }); }
  });

  app.get("/api/account/following", requireAuth, async (req, res) => {
    try {
      const page = Number(req.query.page ?? 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return res.status(400).json({ error: "Invalid page." });
      const predicate = and(eq(creatorFollows.userId, req.user!.id), eq(users.suspended, false),
        sql`coalesce(${users.creatorStatus},'none') <> 'rejected' and
          (${users.isAdmin} or ${users.isCreator} or ${users.creatorStatus}='approved')`);
      const [count] = await db.select({total:sql<number>`count(*)::int`}).from(creatorFollows)
        .innerJoin(users,eq(users.id,creatorFollows.creatorId)).where(predicate);
      const metadata = pageMetadata(count.total,page,24);
      const records = await db.select({ user: users,
        followerCount: sql<number>`(select count(*)::int from creator_follows cf join users fu on fu.id=cf.user_id
          where cf.creator_id=${users.id} and not fu.suspended)`,
      }).from(creatorFollows).innerJoin(users, eq(users.id, creatorFollows.creatorId))
        .where(predicate)
        .orderBy(desc(creatorFollows.createdAt), desc(creatorFollows.id)).limit(24).offset((metadata.page - 1) * 24);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ items: records.slice(0, 24).map(row => publicCreator(
        // Following cards do not need large cover photos.
        { ...row.user, profileCoverImage: null }, { followerCount: Number(row.followerCount), following: true })),
        ...metadata });
    } catch { res.status(503).json({ error: "Your followed creators could not be loaded." }); }
  });
}

export async function publicCreatorById(id: number, viewerId?: number) {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const user = await storage.getUser(id);
  if (!user || !activeCreator(user)) return null;
  return publicCreator(user, await creatorFollowState(id, viewerId));
}
