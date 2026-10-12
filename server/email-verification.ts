import type { Express } from "express";
import { createHash, randomBytes } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { users, emailVerifications } from "@shared/schema";
import { requireAuth } from "./middleware/auth";
import { publicSiteUrl } from "./seo";
import { takeBetaRate } from "./beta-policy";
import { verificationConfigured } from "./beta-config";
import { verificationEmail } from "./email-templates/verification";
import { sendBrandedEmail } from "./email-delivery";
import { enqueueTransactionalEmail } from "./transactional-emails";
export { verificationConfigured } from "./beta-config";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function sendVerification(user: {id:number;email:string;emailVerifiedAt:Date|null}) {
  if (user.emailVerifiedAt) return {status:200,error:undefined,sent:false};
  if (!verificationConfigured()) return {status:503,error:"Email verification is not configured. Please try again later."};
  if (!await takeBetaRate(`verify-send:${user.id}`,1,60000) ||
    !await takeBetaRate(`verify-daily:${user.id}`,10,86400000)) return {status:429,error:"Please wait before requesting another verification email."};
  const token = randomBytes(32).toString("hex");
  const hash = tokenHash(token);
  await db.insert(emailVerifications).values({userId:user.id,tokenHash:hash,expiresAt:new Date(Date.now()+3600000)})
    .onConflictDoUpdate({target:emailVerifications.userId,set:{tokenHash:hash,expiresAt:new Date(Date.now()+3600000),sentAt:new Date(),usedAt:null}});
  try {
    const siteUrl = publicSiteUrl();
    if (!siteUrl) throw new Error("Verification email origin is unavailable.");
    const url = `${siteUrl}/auth#verify=${token}`;
    const template = verificationEmail(siteUrl, url);
    await sendBrandedEmail(user.email, template, `verification-${hash}`);
    return {status:200,sent:true};
  } catch {
    await db.delete(emailVerifications).where(and(eq(emailVerifications.userId,user.id),eq(emailVerifications.tokenHash,hash)));
    return {status:502,error:"Verification email could not be sent. Please request a new email later."};
  }
}
export function registerVerificationRoutes(app: Express) {
  app.post("/api/email-verification/send",requireAuth,async(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    try { const result = await sendVerification(req.user!); res.status(result.status).json(result); }
    catch { res.status(503).json({error:"Verification is temporarily unavailable."}); }
  });
  app.post("/api/email-verification/confirm",async(req,res)=>{
    res.setHeader("Cache-Control","no-store");
    if (!verificationConfigured()) return res.status(503).json({error:"Email verification is not configured."});
    const token = req.body?.token;
    if (typeof token!=="string" || !/^[0-9a-f]{64}$/.test(token)) return res.status(400).json({error:"Invalid or expired verification link."});
    try {
      if (!await takeBetaRate(`verify-confirm:${createHash("sha256").update(req.ip || "").digest("hex")}`,30,3600000))
        return res.status(429).json({error:"Too many attempts. Try later."});
      const result = await db.transaction(async tx=>{
        const redeemed = await tx.execute(sql`update email_verifications set used_at=now()
          where token_hash=${tokenHash(token)} and used_at is null and expires_at>now() returning user_id`);
        if (!redeemed.rows.length) return false;
        const userId = Number(redeemed.rows[0].user_id);
        const [verified] = await tx.update(users).set({emailVerifiedAt:new Date()})
          .where(and(eq(users.id,userId),sql`${users.emailVerifiedAt} is null`))
          .returning({id:users.id,isCreator:users.isCreator,creatorStatus:users.creatorStatus,suspended:users.suspended});
        if (verified) {
          await enqueueTransactionalEmail(tx, "welcome", userId);
          // An administrator can approve Creator access before email confirmation.
          if (verified.isCreator && verified.creatorStatus === "approved" && !verified.suspended)
            await enqueueTransactionalEmail(tx, "creator-welcome", userId);
        }
        return true;
      });
      res.status(result?200:400).json(result?{verified:true}:{error:"Invalid, expired or already used verification link."});
    } catch { res.status(503).json({error:"Verification is temporarily unavailable."}); }
  });
}
