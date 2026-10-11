import type { Express } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "./db";
import { checkContent } from "./content-safety";
import { takeBetaRate, lockedCreatorBudget, creatorAllowed } from "./beta-policy";
import { profileUpdateSchema, normalizeProfileImage, ProfileImageError } from "./profile-validation";
import { profileFailure, profileFields, profileImageMessage, type ProfileFieldErrors } from "../shared/profile-errors";
import { mapProfileError, ProfileAccessError } from "./profile-errors";
import { storage } from "./storage";

export function registerCommunityProfile(app:Express) {
  app.patch("/api/account/profile",async(req,res)=>{
    if (!req.isAuthenticated() || !req.user) return res.status(401).json(profileFailure("authentication"));
    if (req.user.suspended) return res.status(403).json(profileFailure("permission"));
    try {
      const data=profileUpdateSchema.parse(req.body);
      const currentUser=await storage.getUser(req.user!.id);
      const creatorFields=["displayName","coverImage","publicContactEmail","websiteUrl","instagramUrl"] as const;
      if (!currentUser || currentUser.suspended) return res.status(403).json(profileFailure("permission"));
      if (creatorFields.some(field=>data[field]!==undefined) && !creatorAllowed(currentUser))
        return res.status(403).json(profileFailure("permission"));
      if (!await takeBetaRate(`profile:${req.user!.id}`,8,3600000))
        return res.status(429).json(profileFailure("rate_limit"));
      const imageErrors: ProfileFieldErrors = {};
      const normalize = async (field: "profileImage" | "coverImage") => {
        if (!data[field]) return;
        try {
          const normalized = await normalizeProfileImage(data[field]!, field === "coverImage");
          data[field] = normalized.dataUrl;
          return normalized.buffer;
        } catch (error) {
          if (!(error instanceof ProfileImageError)) throw error;
          imageErrors[field] = profileImageMessage(field, error.reason);
        }
      };
      let image:Buffer|undefined;
      image = await normalize("profileImage");
      let cover:Buffer|undefined;
      cover = await normalize("coverImage");
      if (Object.keys(imageErrors).length) return res.status(400).json(profileFailure("validation", imageErrors));
      const publicText=JSON.stringify({username:data.username,bio:data.bio,displayName:data.displayName,
        publicContactEmail:data.publicContactEmail,websiteUrl:data.websiteUrl,instagramUrl:data.instagramUrl});
      // Both changed images are reviewed independently; a reviewed avatar does not approve a cover.
      for(const buffer of image && cover ? [image,cover] : [image || cover]) {
        const safety=await checkContent(publicText,buffer);
        if (safety.status!=="approved") return res.status(safety.status==="blocked" || safety.status==="review"?400:503).json(
          profileFailure(safety.status==="blocked" ? "safety_blocked" : safety.status==="review" ? "safety_uncertain" : "safety_unavailable"));
      }
      const result=await db.transaction(async tx=>{
        const [current]=await tx.select().from(users).where(eq(users.id,req.user!.id)).for("update");
        if (!current || current.suspended) throw new ProfileAccessError();
        if(creatorFields.some(field=>data[field]!==undefined) && !creatorAllowed(current)) throw new ProfileAccessError();
        if ((image || cover) && creatorAllowed(current)) {
          const bytes=(value:string|null)=>value?.startsWith("data:")?Buffer.from(value.split(",")[1],"base64").length:0;
          const delta=(data.profileImage!==undefined ? (image?.length || 0)-bytes(current.profileImage):0)+
            (data.coverImage!==undefined ? (cover?.length || 0)-bytes(current.profileCoverImage):0);
          await lockedCreatorBudget(tx,current.id,Math.max(0,delta));
        }
        const {coverImage,profileImage,username,bio,...details}=data;
        const [updated]=await tx.update(users).set({username:data.username,bio:data.bio,
          ...details,
          ...(profileImage!==undefined?{profileImage,profileImagePublic:!!profileImage}:{}),
          ...(coverImage!==undefined?{profileCoverImage:coverImage,profileCoverPublic:!!coverImage}:{})})
          .where(eq(users.id,current.id)).returning();
        return updated;
      });
      const {password,...safe}=result;res.json(safe);
    } catch(error) {
      if (error instanceof z.ZodError) {
        const fields: ProfileFieldErrors = {};
        for (const field of profileFields) {
          const issue = error.issues.find(issue => issue.path[0] === field);
          if (issue) fields[field] = ["too_big", "too_small", "custom"].includes(issue.code) ? issue.message : "Enter a valid value for this field.";
        }
        return res.status(400).json(profileFailure("validation", fields));
      }
      // Constraint/provider/image errors may carry private content; do not echo them.
      const failure = mapProfileError(error);
      res.status(failure.status).json(failure.body);
    }
  });
}
