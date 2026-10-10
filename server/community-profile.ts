import type { Express } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "./db";
import { requireAuth } from "./middleware/auth";
import { checkContent } from "./content-safety";
import { takeBetaRate, lockedCreatorBudget, creatorAllowed } from "./beta-policy";
import { profileUpdateSchema, normalizeProfileImage } from "./profile-validation";
import { storage } from "./storage";

export function registerCommunityProfile(app:Express) {
  app.patch("/api/account/profile",requireAuth,async(req,res)=>{
    try {
      const data=profileUpdateSchema.parse(req.body);
      const currentUser=await storage.getUser(req.user!.id);
      const creatorFields=["displayName","coverImage","publicContactEmail","websiteUrl","instagramUrl"] as const;
      if (!currentUser || currentUser.suspended) return res.status(403).json({error:"Account unavailable."});
      if (creatorFields.some(field=>data[field]!==undefined) && !creatorAllowed(currentUser))
        return res.status(403).json({error:"Creator access is required to edit public creator details."});
      if (!await takeBetaRate(`profile:${req.user!.id}`,8,3600000))
        return res.status(429).json({error:"Please wait before changing your profile again."});
      let image:Buffer|undefined;
      if (data.profileImage) {
        const normalized=await normalizeProfileImage(data.profileImage);
        image=normalized.buffer;
        data.profileImage=normalized.dataUrl;
      }
      let cover:Buffer|undefined;
      if(data.coverImage) {
        const normalized=await normalizeProfileImage(data.coverImage,true);
        cover=normalized.buffer; data.coverImage=normalized.dataUrl;
      }
      const publicText=JSON.stringify({username:data.username,bio:data.bio,displayName:data.displayName,
        publicContactEmail:data.publicContactEmail,websiteUrl:data.websiteUrl,instagramUrl:data.instagramUrl});
      // Both changed images are reviewed independently; a reviewed avatar does not approve a cover.
      for(const buffer of image && cover ? [image,cover] : [image || cover]) {
        const safety=await checkContent(publicText,buffer);
        if (safety.status!=="approved") return res.status(safety.status==="error"?503:400).json({error:"Your profile could not pass the safety check. Nothing has changed."});
      }
      const result=await db.transaction(async tx=>{
        const [current]=await tx.select().from(users).where(eq(users.id,req.user!.id)).for("update");
        if (!current || current.suspended) throw new Error("Account unavailable");
        if(creatorFields.some(field=>data[field]!==undefined) && !creatorAllowed(current)) throw new Error("Creator unavailable");
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
      if (error instanceof z.ZodError) return res.status(400).json({error:"Check your profile fields, contact email and links. Use HTTP/HTTPS and an Instagram profile URL."});
      // Constraint/provider/image errors may carry private content; do not echo them.
      res.status(400).json({error:"Profile could not be saved. Check the photo, choose an available name, or try again later."});
    }
  });
}
