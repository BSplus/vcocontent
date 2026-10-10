import type { Express } from "express";
import { z } from "zod";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "./db";
import { requireAuth } from "./middleware/auth";
import { checkContent } from "./content-safety";
import { takeBetaRate, lockedCreatorBudget, creatorAllowed } from "./beta-policy";

export function registerCommunityProfile(app:Express) {
  app.patch("/api/account/profile",requireAuth,async(req,res)=>{
    try {
      const data=z.object({
        username:z.string().trim().min(3).max(80),
        bio:z.string().trim().max(500),
        profileImage:z.string().max(1400000).nullable().optional(),
      }).strict().parse(req.body);
      if (!await takeBetaRate(`profile:${req.user!.id}`,8,3600000))
        return res.status(429).json({error:"Please wait before changing your profile again."});
      let image:Buffer|undefined;
      if (data.profileImage) {
        if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data.profileImage))
          return res.status(400).json({error:"Choose a JPEG, PNG or WebP profile photo."});
        const source=Buffer.from(data.profileImage.split(",")[1],"base64");
        if (source.length>1000000) return res.status(400).json({error:"Profile photos must be at most 1 MB."});
        const info=await sharp(source,{animated:true,limitInputPixels:40000000}).metadata();
        if ((info.pages||1)>1 || source.includes(Buffer.from("acTL")) || source.includes(Buffer.from("ANIM")))
          return res.status(400).json({error:"Choose a still profile photo."});
        const normalized:Buffer=await sharp(source,{limitInputPixels:40000000}).rotate().resize(256,256,{fit:"cover"}).webp({quality:75}).toBuffer();
        if (normalized.length>100000) return res.status(400).json({error:"Profile photo could not fit its size limit."});
        image=normalized;
        data.profileImage=`data:image/webp;base64,${normalized.toString("base64")}`;
      }
      const safety=await checkContent(JSON.stringify({username:data.username,bio:data.bio}),image);
      if (safety.status!=="approved") return res.status(safety.status==="error"?503:400).json({error:"Your profile could not pass the safety check. Nothing has changed."});
      const result=await db.transaction(async tx=>{
        const [current]=await tx.select().from(users).where(eq(users.id,req.user!.id)).for("update");
        if (!current || current.suspended) throw new Error("Account unavailable");
        if (image && creatorAllowed(current)) {
          const previous=current.profileImage?.startsWith("data:") ? Buffer.from(current.profileImage.split(",")[1],"base64").length : 0;
          await lockedCreatorBudget(tx,current.id,Math.max(0,image.length-previous));
        }
        const [updated]=await tx.update(users).set({username:data.username,bio:data.bio,
          ...(data.profileImage!==undefined?{profileImage:data.profileImage,profileImagePublic:!!data.profileImage}:{})})
          .where(eq(users.id,current.id)).returning();
        return updated;
      });
      const {password,...safe}=result;res.json(safe);
    } catch(error) {
      if (error instanceof z.ZodError) return res.status(400).json({error:"Check your profile fields. Only your name, biography and photo can be changed."});
      // Constraint/provider/image errors may carry private content; do not echo them.
      res.status(400).json({error:"Profile could not be saved. Check the photo, choose an available name, or try again later."});
    }
  });
}
