import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import { profileImageBytes } from "./helpers/profile-image.mjs";

// Fully synthetic safety transport, installed before importing the SDK.
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "https://profile-test.invalid";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "synthetic";
const originalFetch = globalThis.fetch;
let safetyImages = 0, rejectNext = false, rejectAtImage = Infinity;
let safetyMode = "approved", beforeSafety, secondImageMode;
const fingerprints = [];
globalThis.fetch = async (input, init) => {
  if (!String(input).startsWith("https://profile-test.invalid")) return originalFetch(input, init);
  if (beforeSafety) { const action = beforeSafety; beforeSafety = undefined; await action(); }
  if (safetyMode === "error") return new Response("private provider failure", {status:503});
  const body = JSON.parse(init.body);
  const parts=body.messages[1].content;
  const text=parts.find(part=>part.type==="text")?.text || "";
  const encoded=parts.find(part=>part.type==="image_url")?.image_url?.url?.split(",")[1];
  fingerprints.push(createHash("sha256").update(SAFETY_POLICY).update(TAG_MODEL).update(text)
    .update(encoded?Buffer.from(encoded,"base64"):"").digest("hex"));
  safetyImages += body.messages[1].content.filter(part => part.type === "image_url").length;
  const mode = secondImageMode?.at === safetyImages ? secondImageMode.mode : safetyMode;
  if (mode === "error") return new Response("private provider failure", {status:503});
  const prohibited = rejectNext || safetyImages === rejectAtImage; rejectNext = false;
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    sexualized: prohibited ? "prohibited" : "clear", pornography: "clear", racistOrDehumanizing: "clear",
    hateSymbolsOrGlorification: mode === "review" ? "uncertain" : "clear", visibleTextAndSymbolsReviewed: mode !== "incomplete",
  }) } }] }), { headers: { "Content-Type": "application/json" } });
};
const { db, pool } = await import("../server/db.ts");
const { users, creatorFollows, safetyResults } = await import("../shared/schema.ts");
const { eq, inArray, sql } = await import("drizzle-orm");
const { storage } = await import("../server/storage.ts");
const { registerCommunityProfile } = await import("../server/community-profile.ts");
const { registerCreatorProfiles, publicCreatorById } = await import("../server/creator-profiles.ts");
const { profileUpdateSchema, normalizeProfileImage } = await import("../server/profile-validation.ts");
const { registerRequestParsers } = await import("../server/request-parsers.ts");
const { PROFILE_JSON_BYTES } = await import("../shared/profile-image-limits.ts");
const { creatorUsage } = await import("../server/beta-policy.ts");
const { SAFETY_POLICY } = await import("../server/beta-policy.ts");
const { TAG_MODEL } = await import("../server/utils/ai-tagger.ts");
const id = randomUUID();
let creator, viewer, stranger, suspended, sizeCreator, server, base;
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
    ["sizes", { isCreator: true, creatorStatus: "approved" }],
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
    if (role === "sizes") sizeCreator = row;
  }
  const app = express(); registerRequestParsers(app);
  app.use(async (req, _res, next) => {
    req.user = req.headers["x-fixture-user"] ? await storage.getUser(Number(req.headers["x-fixture-user"])) : undefined;
    req.isAuthenticated = () => !!req.user; next();
  });
  registerCommunityProfile(app); registerCreatorProfiles(app);
  app.all("/api/parser-fixture", (_req, res) => res.json({ ok: true }));
  app.post("/api/account/profile", (_req, res) => res.json({ ok: true }));
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
test.beforeEach(async () => {
  safetyMode = "approved";
  secondImageMode = undefined;
  await db.execute(sql`delete from beta_rate_limits where key = any(${`{${fixtureIds.map(id => `profile:${id}`).join(",")}}`}::text[])`);
});
test("ordinary users save immediately without becoming creators or changing private account details", async () => {
  const before = await storage.getUser(viewer.id);
  const avatar = await sharp({create:{width:32,height:32,channels:3,background:"#347890"}}).png().toBuffer();
  const result = await request("/api/account/profile", viewer, "PATCH", {
    username: `edited-viewer-${id}`, bio: `Approved user biography ${id}`,
    profileImage: `data:image/png;base64,${avatar.toString("base64")}`,
  });
  assert.equal(result.status, 200);
  const saved = await storage.getUser(viewer.id);
  assert.equal(saved.username, result.data.username);
  assert.equal(saved.bio, result.data.bio);
  assert.equal(saved.profileImage, result.data.profileImage);
  assert.equal(saved.profileImagePublic, true);
  for (const key of ["id","email","password","isAdmin","isCreator","creatorStatus","suspended","emailVerifiedAt"])
    assert.deepEqual(saved[key], before[key]);
  assert.equal("password" in result.data, false);
  assert.equal(await publicCreatorById(viewer.id), null);
  // Rejected edits never replace the approved user profile.
  for (const mode of ["blocked","review","incomplete","error"]) {
    safetyMode = mode === "blocked" ? "approved" : mode;
    rejectNext = mode === "blocked";
    const denied = await request("/api/account/profile", viewer, "PATCH", {
      username: saved.username, bio: `User failure ${mode} ${id}`, profileImage: null,
    });
    assert.equal(denied.status, ["incomplete","error"].includes(mode) ? 503 : 400);
    assert.deepEqual(await storage.getUser(viewer.id), saved);
  }
});
test("approved creators save directly with stable public URLs, roles and private email", async () => {
  for (const isCreator of [true, false]) {
    await db.update(users).set({isCreator,creatorStatus:"approved"}).where(eq(users.id, stranger.id));
    const before = await storage.getUser(stranger.id);
    const result = await request("/api/account/profile", stranger, "PATCH", {
      username: `edited-creator-${isCreator}-${id}`, bio: `Immediate creator ${isCreator} ${id}`,
      displayName: "Immediately visible", publicContactEmail: "explicit@example.invalid",
    });
    assert.equal(result.status, 200);
    const saved = await storage.getUser(stranger.id);
    const publicProfile = await publicCreatorById(stranger.id);
    assert.equal(publicProfile.username, result.data.username);
    assert.equal(publicProfile.bio, result.data.bio);
    assert.equal(publicProfile.displayName, "Immediately visible");
    assert.equal(publicProfile.publicContactEmail, "explicit@example.invalid");
    assert.equal(publicProfile.profileUrl, `/creator/${before.id}`);
    for (const key of ["id","email","password","isAdmin","isCreator","creatorStatus","suspended","emailVerifiedAt"])
      assert.deepEqual(saved[key], before[key]);
    assert.equal("email" in publicProfile, false);
    assert.equal("password" in publicProfile, false);
  }
  await db.update(users).set({isCreator:true}).where(eq(users.id,stranger.id));
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

test("admins without creator flags use the same public whitelist and image approvals as visitors", async () => {
  const before = await storage.getUser(viewer.id);
  try {
    await db.update(users).set({ isAdmin: true, isCreator: false, creatorStatus: "none",
      profileImage: "synthetic-avatar", profileCoverImage: "synthetic-cover",
      profileImagePublic: false, profileCoverPublic: false }).where(eq(users.id, viewer.id));
    for (const viewerId of [undefined, viewer.id, creator.id]) {
      const profile = await publicCreatorById(viewer.id, viewerId);
      assert.equal(profile.profileUrl, `/creator/${viewer.id}`);
      assert.equal(profile.profileImage, null);
      assert.equal(profile.coverImage, null);
      for (const field of ["email", "password", "credits", "emailVerifiedAt", "isAdmin"])
        assert.equal(field in profile, false);
    }
    await db.update(users).set({ profileImagePublic: true, profileCoverPublic: true }).where(eq(users.id, viewer.id));
    const ownerProfile = await publicCreatorById(viewer.id, viewer.id);
    assert.deepEqual(ownerProfile, await publicCreatorById(viewer.id));
    assert.equal(ownerProfile.profileImage, "synthetic-avatar");
    assert.equal(ownerProfile.coverImage, "synthetic-cover");
    assert.equal((await request(`/api/creators/${viewer.id}/follow`, viewer, "PUT")).status, 400);
    for (const state of [{ suspended: true }, { suspended: false, creatorStatus: "rejected" }]) {
      await db.update(users).set(state).where(eq(users.id, viewer.id));
      assert.equal(await publicCreatorById(viewer.id, viewer.id), null);
    }
  } finally {
    const { id: ignored, ...fields } = before;
    await db.update(users).set(fields).where(eq(users.id, viewer.id));
  }
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

test("source size boundaries use decimal bytes for both assets and preserve output limits", async () => {
  for (const size of [1_500_000, 3_000_000]) {
    const source = await profileImageBytes(size);
    assert.equal(source.length, size);
    const dataUrl = `data:image/jpeg;base64,${source.toString("base64")}`;
    assert.equal(profileUpdateSchema.safeParse({ username: "Fixture", bio: "", profileImage: dataUrl, coverImage: dataUrl }).success, true);
    for (const cover of [false, true]) {
      const result = await normalizeProfileImage(dataUrl, cover);
      const info = await sharp(result.buffer).metadata();
      assert.equal(info.format, "webp");
      assert.ok(info.width <= (cover ? 1920 : 256));
      assert.ok(info.height <= (cover ? 640 : 256));
      assert.ok(result.buffer.length <= (cover ? 250000 : 100000));
    }
  }
  const oversized = `data:image/jpeg;base64,${(await profileImageBytes(3_000_001)).toString("base64")}`;
  for (const field of ["profileImage", "coverImage"]) {
    const parsed = profileUpdateSchema.safeParse({ username: "Fixture", bio: "", [field]: oversized });
    assert.equal(parsed.success, false);
    assert.match(parsed.error.issues[0].message, /3 MB/);
    await assert.rejects(normalizeProfileImage(oversized, field === "coverImage"), /3 MB/);
  }
});

test("the production parser accepts two exact 3 MB images together and keeps other request limits narrow", async () => {
  const body = {
    username: sizeCreator.username, bio: `Synthetic maximum assets ${id}`,
    displayName: "Both maximum images", publicContactEmail: "sizes@example.invalid",
    websiteUrl: "https://example.invalid/", instagramUrl: null,
    profileImage: `data:image/jpeg;base64,${(await profileImageBytes(3_000_000)).toString("base64")}`,
    coverImage: `data:image/jpeg;base64,${(await profileImageBytes(3_000_000, "#abcdef")).toString("base64")}`,
  };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 8_000_000);
  const previous = safetyImages;
  const result = await request("/api/account/profile", sizeCreator, "PATCH", body);
  assert.equal(result.status, 200);
  assert.equal(safetyImages - previous, 2);
  const profile = await publicCreatorById(sizeCreator.id);
  assert.equal(profile.bio, body.bio);
  assert.ok(profile.profileImage.startsWith("data:image/webp;base64,"));
  assert.ok(profile.coverImage.startsWith("data:image/webp;base64,"));
  assert.equal((await creatorUsage(db, sizeCreator.id)).bytes,
    Buffer.from(profile.profileImage.split(",")[1], "base64").length +
    Buffer.from(profile.coverImage.split(",")[1], "base64").length);
  for (const [path, method] of [["/api/parser-fixture", "PATCH"], ["/api/account/profile", "POST"], ["/api/account/profile/extra", "PATCH"]]) {
    const denied = await request(path, sizeCreator, method, body);
    assert.equal(denied.status, 413);
    assert.deepEqual(denied.data, { error: "The request is too large. Send less data." });
  }
  const tooLarge = await request("/api/account/profile", sizeCreator, "PATCH", { ...body, bio: "x".repeat(PROFILE_JSON_BYTES) });
  assert.equal(tooLarge.status, 413);
  assert.match(tooLarge.data.error, /3 MB/);
  assert.equal(tooLarge.data.error.includes(body.username), false);
  assert.deepEqual(await publicCreatorById(sizeCreator.id), profile);
});

test("direct API size and malformed-image failures keep all existing fields unchanged", async () => {
  const before = await publicCreatorById(sizeCreator.id);
  const oversized = `data:image/jpeg;base64,${(await profileImageBytes(3_000_001)).toString("base64")}`;
  for (const field of ["profileImage", "coverImage"]) {
    const result = await request("/api/account/profile", sizeCreator, "PATCH", {
      username: sizeCreator.username, bio: "Must not change", [field]: oversized,
    });
    assert.equal(result.status, 400);
    assert.match(result.data.error, /3 MB/);
    assert.deepEqual(await publicCreatorById(sizeCreator.id), before);
  }
  for (const image of ["data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,bm90LWFuLWltYWdl"]) {
    const result = await request("/api/account/profile", sizeCreator, "PATCH", {
      username: sizeCreator.username, bio: "Malformed source", profileImage: null, coverImage: image,
    });
    assert.equal(result.status, 400);
    assert.deepEqual(await publicCreatorById(sizeCreator.id), before);
  }
});

test("a rejected second maximum image rolls back the first image and all text changes", async () => {
  const before = await publicCreatorById(sizeCreator.id);
  const previous = safetyImages;
  rejectAtImage = previous + 2;
  const result = await request("/api/account/profile", sizeCreator, "PATCH", {
    username: sizeCreator.username, bio: `Synthetic second image rejection ${id}`, displayName: "Must not change",
    profileImage: `data:image/jpeg;base64,${(await profileImageBytes(3_000_000, "#135790")).toString("base64")}`,
    coverImage: `data:image/jpeg;base64,${(await profileImageBytes(3_000_000, "#246801")).toString("base64")}`,
  });
  rejectAtImage = Infinity;
  assert.equal(result.status, 400);
  assert.equal(safetyImages - previous, 2);
  assert.deepEqual(await publicCreatorById(sizeCreator.id), before);
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
    profileImage:null,
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

test("multiple known field errors are returned together without echoing values", async () => {
  const before = await storage.getUser(stranger.id);
  const result = await request("/api/account/profile", stranger, "PATCH", {
    username: "x", bio: "private".repeat(100), displayName: "x".repeat(81),
    publicContactEmail: "sensitive-invalid", websiteUrl: "https://private:secret@example.invalid", instagramUrl: "https://wrong.invalid",
  });
  assert.equal(result.status, 400);
  assert.deepEqual(Object.keys(result.data.fieldErrors).sort(), ["username","bio","displayName","publicContactEmail","websiteUrl","instagramUrl"].sort());
  assert.equal(JSON.stringify(result.data).includes("private"), false);
  assert.deepEqual(await storage.getUser(stranger.id), before);
});

test("a real update collision targets Username, while duplicate public display names are allowed", async () => {
  const before = await storage.getUser(stranger.id);
  const denied = await request("/api/account/profile", stranger, "PATCH", {username: creator.username, bio: `Conflict ${id}`});
  assert.equal(denied.status, 409);
  assert.deepEqual(denied.data.fieldErrors, {username:"This username is already taken. Choose another username."});
  assert.equal(denied.data.code, "username_taken");
  assert.deepEqual(await storage.getUser(stranger.id), before);
  const accepted = await request("/api/account/profile", stranger, "PATCH", {username:stranger.username, bio:"", displayName:creator.username});
  assert.equal(accepted.status, 200);
});

test("each image target reports corrupt, animated, oversized and excessive pixel sources", async () => {
  const png = await sharp({create:{width:32,height:32,channels:3,background:"#113355"}}).png().toBuffer();
  const animated = Buffer.concat([png, Buffer.from("acTL")]);
  const largePixels = await sharp({create:{width:7000,height:6000,channels:3,background:"#113355"}}).png().toBuffer();
  const before = await storage.getUser(stranger.id);
  for (const field of ["profileImage", "coverImage"]) {
    for (const [source, mime, expected] of [
      [Buffer.from("private-corrupt-file"),"png",/damaged or could not be read/],
      [animated,"png",/supported static JPEG/],
      [await profileImageBytes(3_000_001),"jpeg",/3 MB/],
      [largePixels,"png",/Reduce its pixel dimensions/],
    ]) {
      const result = await request("/api/account/profile",stranger,"PATCH",{
        username:stranger.username,bio:"Must not persist",[field]:`data:image/${mime};base64,${source.toString("base64")}`,
      });
      assert.equal(result.status,400);
      assert.match(result.data.fieldErrors[field], expected);
      assert.match(result.data.fieldErrors[field], field === "profileImage" ? /^Profile photo/ : /^Creator cover image/);
      assert.deepEqual(Object.keys(result.data.fieldErrors), [field]);
      assert.deepEqual(await storage.getUser(stranger.id), before);
      await db.execute(sql`delete from beta_rate_limits where key=${`profile:${stranger.id}`}`);
    }
  }
  const both = await request("/api/account/profile",stranger,"PATCH",{username:stranger.username,bio:"",profileImage:"data:image/png;base64,YQ==",coverImage:"data:image/png;base64,Yg=="});
  assert.deepEqual(Object.keys(both.data.fieldErrors).sort(), ["coverImage","profileImage"]);
});

test("uncertain inspection and service outage are not claimed as proven policy violations", async () => {
  const before = await storage.getUser(stranger.id);
  for (const mode of ["review","incomplete","error"]) {
    safetyMode = mode;
    const result = await request("/api/account/profile",stranger,"PATCH",{username:stranger.username,bio:`${mode} ${id}`});
    assert.equal(result.status,mode === "review" ? 400 : 503);
    assert.equal(result.data.code,mode === "review" ? "safety_uncertain" : "safety_unavailable");
    assert.deepEqual(result.data.fieldErrors,{});
    assert.equal(result.data.error.includes("private provider"),false);
    assert.match(result.data.error, /saved profile is unchanged/);
    assert.match(result.data.error, /try saving again/i);
    assert.doesNotMatch(result.data.error, /contact an administrator|until an administrator|pending/i);
    assert.deepEqual(await storage.getUser(stranger.id), before);
  }
});
test("an uncertain, incomplete or unavailable second image leaves the entire published profile unchanged", async () => {
  const before = await storage.getUser(creator.id);
  const published = await publicCreatorById(creator.id);
  const avatar = await sharp({create:{width:32,height:32,channels:3,background:"#317953"}}).png().toBuffer();
  const cover = await sharp({create:{width:96,height:32,channels:3,background:"#593713"}}).png().toBuffer();
  for (const mode of ["review","incomplete","error"]) {
    const previous = safetyImages;
    secondImageMode = {at: previous + 2, mode};
    const result = await request("/api/account/profile", creator, "PATCH", {
      username: creator.username, bio: `Second image ${mode} ${id}`, displayName: "Not published",
      publicContactEmail:"not-saved@example.invalid",
      profileImage: `data:image/png;base64,${avatar.toString("base64")}`,
      coverImage: `data:image/png;base64,${cover.toString("base64")}`,
    });
    assert.equal(result.status, mode === "review" ? 400 : 503);
    assert.equal(result.data.code, mode === "review" ? "safety_uncertain" : "safety_unavailable");
    assert.equal(safetyImages - previous, 2);
    assert.deepEqual(await storage.getUser(creator.id), before);
    assert.deepEqual(await publicCreatorById(creator.id), published);
  }
});

test("quota errors, access races, rate limits and technical database errors preserve saved data", async () => {
  const {mediaCleanup, events, mediaItems} = await import("../shared/schema.ts");
  const before = await storage.getUser(stranger.id);
  const key = `profile-error-fixture-${id}`;
  const image = `data:image/png;base64,${(await sharp({create:{width:32,height:32,channels:3,background:"#987654"}}).png().toBuffer()).toString("base64")}`;
  try {
    for (const [bytes, expected] of [[500_000_000,"storage_full"],[null,"storage_cleanup"]]) {
      await db.insert(mediaCleanup).values({key,creatorId:stranger.id,storedBytes:bytes}).onConflictDoUpdate({target:mediaCleanup.key,set:{storedBytes:bytes}});
      const result = await request("/api/account/profile",stranger,"PATCH",{username:stranger.username,bio:`quota ${bytes} ${id}`,coverImage:image});
      assert.equal(result.data.code,expected);
      assert.deepEqual(await storage.getUser(stranger.id),before);
    }
  } finally { await db.delete(mediaCleanup).where(eq(mediaCleanup.key,key)); }
  // Unknown historical object size, with no pending cleanup, requires an administrator.
  const [event] = await db.insert(events).values({title:"Synthetic quota fixture",description:"fixture",date:new Date(),creatorId:stranger.id}).returning();
  try {
    await db.insert(mediaItems).values({eventId:event.id,type:"image",url:`/api/media/files/${id}.png`,thumbnail:`/api/media/files/${id}.webp`});
    const unknown = await request("/api/account/profile",stranger,"PATCH",{username:stranger.username,bio:`unknown quota ${id}`,profileImage:image});
    assert.equal(unknown.status,503); assert.equal(unknown.data.code,"storage_unknown");
    assert.deepEqual(await storage.getUser(stranger.id),before);
  } finally {
    await db.delete(mediaItems).where(eq(mediaItems.eventId,event.id));
    await db.delete(events).where(eq(events.id,event.id));
  }
  // Change access while safety is running, so the locked recheck must reject it.
  beforeSafety = () => db.update(users).set({creatorStatus:"rejected"}).where(eq(users.id,stranger.id));
  const denied = await request("/api/account/profile",stranger,"PATCH",{username:stranger.username,bio:`race ${id}`,displayName:"Do not save"});
  assert.equal(denied.status,403);
  await db.update(users).set({creatorStatus:before.creatorStatus}).where(eq(users.id,stranger.id));
  assert.deepEqual(await storage.getUser(stranger.id),before);
  await db.execute(sql`insert into beta_rate_limits(key,count,reset_at) values (${`profile:${stranger.id}`},8,now()+interval '1 hour') on conflict(key) do update set count=8,reset_at=excluded.reset_at`);
  const rate = await request("/api/account/profile",stranger,"PATCH",{username:stranger.username,bio:"rate"});
  assert.equal(rate.status,429); assert.equal(rate.data.code,"rate_limit");
  await db.execute(sql`delete from beta_rate_limits where key=${`profile:${stranger.id}`}`);
  const execute = db.execute;
  db.execute = async () => { throw new Error("SQL sensitive secret"); };
  try {
    const failure = await request("/api/account/profile",stranger,"PATCH",{username:stranger.username,bio:"technical"});
    assert.equal(failure.status,500); assert.equal(failure.data.code,"server");
    assert.equal(JSON.stringify(failure.data).includes("secret"),false);
  } finally { db.execute = execute; }
  assert.deepEqual(await storage.getUser(stranger.id),before);
});
