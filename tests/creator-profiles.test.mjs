import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";

// Fully synthetic safety transport, installed before importing the SDK.
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://profile-test.invalid";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "synthetic";
const originalFetch = globalThis.fetch;
let safetyImages = 0, rejectNext = false;
const fingerprints = [];
globalThis.fetch = async (input, init) => {
  if (!String(input).startsWith("https://profile-test.invalid")) return originalFetch(input, init);
  const body = JSON.parse(init.body);
  const parts=body.messages[1].content;
  const text=parts.find(part=>part.type==="text")?.text || "";
  const encoded=parts.find(part=>part.type==="image_url")?.image_url?.url?.split(",")[1];
  fingerprints.push(createHash("sha256").update(SAFETY_POLICY).update(TAG_MODEL).update(text)
    .update(encoded?Buffer.from(encoded,"base64"):"").digest("hex"));
  safetyImages += body.messages[1].content.filter(part => part.type === "image_url").length;
  const prohibited = rejectNext; rejectNext = false;
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    sexualized: prohibited ? "prohibited" : "clear", pornography: "clear", racistOrDehumanizing: "clear",
    hateSymbolsOrGlorification: "clear", visibleTextAndSymbolsReviewed: true,
  }) } }] }), { headers: { "Content-Type": "application/json" } });
};
const { db, pool } = await import("../server/db.ts");
const { users, creatorFollows, safetyResults } = await import("../shared/schema.ts");
const { eq, inArray, sql } = await import("drizzle-orm");
const { storage } = await import("../server/storage.ts");
const { registerCommunityProfile } = await import("../server/community-profile.ts");
const { registerCreatorProfiles, publicCreatorById } = await import("../server/creator-profiles.ts");
const { profileUpdateSchema, normalizeProfileImage } = await import("../server/profile-validation.ts");
const { creatorUsage } = await import("../server/beta-policy.ts");
const { SAFETY_POLICY } = await import("../server/beta-policy.ts");
const { TAG_MODEL } = await import("../server/utils/ai-tagger.ts");
const id = randomUUID();
let creator, viewer, stranger, suspended, server, base;
const fixtureIds = [];
const request = async (path, actor, method = "GET", data) => {
  const response = await originalFetch(base + path, { method,
    headers: { ...(actor ? { "x-fixture-user": String(actor.id) } : {}), ...(data ? { "Content-Type": "application/json" } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return { status: response.status, data: await response.json() };
};

test.before(async () => {
  for (const [role, state] of [
    ["creator", { isCreator: true, creatorStatus: "approved" }],
    ["viewer", { isCreator: false, creatorStatus: "none" }],
    ["stranger", { isCreator: true, creatorStatus: "approved" }],
    ["suspended", { isCreator: true, creatorStatus: "approved", suspended: true }],
  ]) {
    const [row] = await db.insert(users).values({
      username: `profile-${role}-${id}`, email: `${role}-${id}@example.invalid`, password: "synthetic-not-used",
      emailVerifiedAt: new Date(), ...state,
    }).returning();
    fixtureIds.push(row.id);
    if (role === "creator") creator = row;
    if (role === "viewer") viewer = row;
    if (role === "stranger") stranger = row;
    if (role === "suspended") suspended = row;
  }
  const app = express(); app.use(express.json({ limit: "2mb" }));
  app.use(async (req, _res, next) => {
    req.user = req.headers["x-fixture-user"] ? await storage.getUser(Number(req.headers["x-fixture-user"])) : undefined;
    req.isAuthenticated = () => !!req.user; next();
  });
  registerCommunityProfile(app); registerCreatorProfiles(app);
  server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.delete(users).where(inArray(users.id, fixtureIds));
  await db.execute(sql`delete from beta_rate_limits where key like ${`profile:%`} and
    split_part(key,':',2) = any(${`{${fixtureIds.join(",")}}`}::text[])`);
  await db.execute(sql`delete from beta_rate_limits where key like ${`follow:%`} and
    split_part(key,':',2) = any(${`{${fixtureIds.join(",")}}`}::text[])`);
  // Delete only synthetic safety fingerprints associated with this fixture's text.
  if(fingerprints.length) await db.delete(safetyResults).where(inArray(safetyResults.fingerprint,fingerprints));
  globalThis.fetch = originalFetch; await pool.end();
});

test("public profiles whitelist fields, preserve unique URLs, and never default contact email", async () => {
  const profile = await publicCreatorById(creator.id);
  assert.equal(profile.profileUrl, `/creator/${creator.id}`);
  assert.equal(profile.publicContactEmail, null);
  assert.equal(profile.followerCount, 0);
  for (const key of ["email", "password", "credits", "stripeCustomerId", "stripeSubscriptionId", "emailVerifiedAt"])
    assert.equal(key in profile, false);
  assert.equal(await publicCreatorById(viewer.id), null);
  assert.equal(await publicCreatorById(suspended.id), null);
  assert.equal(await publicCreatorById(0), null);
});

test("links are HTTP/HTTPS only, reject embedded credentials and non-Instagram hosts", () => {
  const core = { username: creator.username, bio: "" };
  for (const websiteUrl of ["javascript:alert(1)", "data:text/html,test", "ftp://example.org", "https://user:pass@example.org"])
    assert.equal(profileUpdateSchema.safeParse({ ...core, websiteUrl }).success, false);
  for (const instagramUrl of ["https://instagram.com.evil.invalid/x", "https://evil.invalid/instagram.com"])
    assert.equal(profileUpdateSchema.safeParse({ ...core, instagramUrl }).success, false);
  assert.equal(profileUpdateSchema.parse({ ...core, websiteUrl: "", instagramUrl: null }).websiteUrl, null);
  assert.equal(profileUpdateSchema.parse({ ...core, instagramUrl: "https://www.instagram.com/vco/" }).instagramUrl, "https://www.instagram.com/vco/");
  assert.equal(profileUpdateSchema.safeParse({ ...core, publicContactEmail: "not-an-email" }).success, false);
});

test("follow requests are authenticated, idempotent under concurrency, cannot self-follow", async () => {
  assert.equal((await request(`/api/creators/${creator.id}/follow`, undefined, "PUT")).status, 401);
  assert.equal((await request(`/api/creators/${creator.id}/follow`, creator, "PUT")).status, 400);
  assert.equal((await request(`/api/creators/${creator.id}/follow`, suspended, "PUT")).status, 403);
  assert.equal((await request(`/api/creators/${suspended.id}/follow`, viewer, "PUT")).status, 404);
  const results = await Promise.all(Array.from({ length: 6 }, () => request(`/api/creators/${creator.id}/follow`, viewer, "PUT")));
  assert.ok(results.every(result => result.status === 200 && result.data.followerCount === 1 && result.data.following));
  const rows = await db.select().from(creatorFollows).where(eq(creatorFollows.creatorId, creator.id));
  assert.equal(rows.length, 1);
  const list = await request("/api/account/following", viewer);
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].id, creator.id);
  assert.equal(list.data.items[0].following, true);
  assert.equal("email" in list.data.items[0], false);
  assert.equal((await request("/api/account/following?page=-1", viewer)).status, 400);
});

test("counts and following lists respect suspension, and unfollow is idempotent", async () => {
  await db.update(users).set({ suspended: true }).where(eq(users.id, creator.id));
  assert.equal((await request("/api/account/following", viewer)).data.items.length, 0);
  assert.equal(await publicCreatorById(creator.id), null);
  await db.update(users).set({ suspended: false }).where(eq(users.id, creator.id));
  await db.update(users).set({ suspended: true }).where(eq(users.id, viewer.id));
  assert.equal((await publicCreatorById(creator.id)).followerCount, 0);
  await db.update(users).set({ suspended: false }).where(eq(users.id, viewer.id));
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await request(`/api/creators/${creator.id}/follow`, viewer, "DELETE");
    assert.equal(result.status, 200); assert.equal(result.data.following, false); assert.equal(result.data.followerCount, 0);
  }
});

test("profile edits are owner-only; optional public fields are not mandatory", async () => {
  assert.equal((await request("/api/account/profile", undefined, "PATCH", { username: creator.username, bio: "" })).status, 401);
  assert.equal((await request("/api/account/profile", viewer, "PATCH", { username: viewer.username, bio: "", displayName: "Not a creator" })).status, 403);
  assert.equal((await request("/api/account/profile", stranger, "PATCH", { username: stranger.username, bio: "", id: creator.id })).status, 400);
  const result = await request("/api/account/profile", creator, "PATCH", {
    username: creator.username, bio: "Synthetic photographer", displayName: "Synthetic Display",
    publicContactEmail: "public@example.invalid", websiteUrl: "https://example.invalid", instagramUrl: null,
  });
  assert.equal(result.status, 200);
  const profile = await publicCreatorById(creator.id);
  assert.equal(profile.displayName, "Synthetic Display"); assert.equal(profile.publicContactEmail, "public@example.invalid");
  assert.equal(profile.profileUrl, `/creator/${creator.id}`);
});

test("avatar and cover are normalized, independently reviewed, and included in storage usage", async () => {
  const avatar = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#124578" } }).png().toBuffer();
  const cover = await sharp({ create: { width: 2000, height: 800, channels: 3, background: "#234567" } }).png().toBuffer();
  const previous = safetyImages;
  const result = await request("/api/account/profile", creator, "PATCH", {
    username: creator.username, bio: `Synthetic avatar-cover ${id}`,
    profileImage: `data:image/png;base64,${avatar.toString("base64")}`,
    coverImage: `data:image/png;base64,${cover.toString("base64")}`,
  });
  assert.equal(result.status, 200);
  assert.equal(safetyImages - previous, 2);
  const profile = await publicCreatorById(creator.id);
  assert.ok(profile.coverImage.startsWith("data:image/webp;base64,"));
  const coverInfo = await sharp(Buffer.from(profile.coverImage.split(",")[1], "base64")).metadata();
  assert.equal(coverInfo.width, 1920); assert.equal(coverInfo.height, 640);
  const usage = await creatorUsage(db, creator.id);
  assert.equal(usage.bytes, Buffer.from(profile.coverImage.split(",")[1], "base64").length +
    Buffer.from(profile.profileImage.split(",")[1], "base64").length);
  await assert.rejects(normalizeProfileImage("data:image/svg+xml;base64,PHN2Zz4="));
  await assert.rejects(normalizeProfileImage("data:image/png;base64,bm90LWFuLWltYWdl"));
});

test("failed safety review leaves all profile fields and public images unchanged", async () => {
  const before = await publicCreatorById(creator.id);
  rejectNext = true;
  const result = await request("/api/account/profile", creator, "PATCH", {
    username: creator.username, bio: `Synthetic rejected biography ${id}`, displayName: "Rejected update",
  });
  assert.equal(result.status, 400);
  assert.deepEqual(await publicCreatorById(creator.id), before);
});

test("an unsafe cover cannot be published or alter any other profile field", async () => {
  const before=await publicCreatorById(creator.id);
  const cover=await sharp({create:{width:500,height:200,channels:3,background:"#975321"}}).png().toBuffer();
  rejectNext=true;
  const result=await request("/api/account/profile",creator,"PATCH",{
    username:creator.username,bio:`Synthetic rejected cover ${id}`,displayName:"Not saved",
    coverImage:`data:image/png;base64,${cover.toString("base64")}`,
  });
  assert.equal(result.status,400);
  assert.deepEqual(await publicCreatorById(creator.id),before);
});

test("public images and contact fields can be removed explicitly", async () => {
  const result = await request("/api/account/profile", creator, "PATCH", {
    username: creator.username, bio: "", coverImage: null, profileImage: null, publicContactEmail: "",
    websiteUrl: null, instagramUrl: null, displayName: null,
  });
  assert.equal(result.status, 200);
  const profile = await publicCreatorById(creator.id);
  assert.equal(profile.coverImage, null); assert.equal(profile.profileImage, null);
  assert.equal(profile.publicContactEmail, null); assert.equal(profile.displayName, null);
});
