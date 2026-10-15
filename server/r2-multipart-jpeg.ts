import path from "node:path";
import {constants} from "node:fs";
import {lstat,realpath,open,link,unlink} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {eq} from "drizzle-orm";
import {db} from "./db";
import {mediaReservations,type InsertMediaItem} from "@shared/schema";
import {preparePhoto,InvalidPhotoError,PREVIEW_BYTES} from "./image-downloads";
import {withMediaWorkBudget} from "./media-work-budget";
import {databaseMultipartContext} from "./r2-multipart-journal";
import {MultipartUploadError,type MultipartPlan} from "./r2-multipart-upload";
import type {R2MultipartDriver} from "./r2-multipart-driver";
import {uploadSessionDirectory} from "./upload-session-staging";
import {isCreatorOriginal,isPreservedPhoto} from "@shared/image-provenance";

const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const integrity=():never=>{throw new MultipartUploadError("integrity");};
export type PreparedMultipartJpeg={
  sourcePath:string;
  thumbnail:{path:string;key:string;size:number;sha256:string;mime:"image/webp"};
  media:Pick<InsertMediaItem,"eventId"|"type"|"url"|"thumbnail"|"highBytes"|"lowBytes"|"storedBytes"|"objectCount"|"isPremium">;
};

/** Private intake bridge, not an HTTP endpoint. The future authenticated
 * finalizer supplies a persisted plan and a source assembled inside its owned
 * staging directory. No R2 write, metadata extraction or AI call occurs here.
 * Reopen the journal context for uploadR2MultipartFile after this returns:
 * decoding must not hold the transport's own processing-budget slot.
 */
export async function prepareMultipartJpeg(plan:MultipartPlan,sourcePath:string,
  driver:R2MultipartDriver):Promise<PreparedMultipartJpeg>{
  const context=databaseMultipartContext(plan,driver);
  return context.journal.exclusive(driver.scope,plan.key,plan.sessionId,async raw=>{
    if(raw&&["initiating","completing"].includes((raw as {phase:string}).phase))
      throw new MultipartUploadError("uncertain");
    if(raw&&["aborted","aborting"].includes((raw as {phase:string}).phase))
      throw new MultipartUploadError("closed");
    // This row pins source files against legacy expiry even before the first
    // provider intent. NULL is deliberately distinct from an uncertain Create.
    await context.journal.pinStaging();
    const sourceUrl=`/api/media/files/${plan.key}`;
    if(plan.mime!=="image/jpeg"||!isPreservedPhoto(sourceUrl)||
      isCreatorOriginal(sourceUrl)!==(plan.owner.kind==="creator"))integrity();
    const root=uploadSessionDirectory(plan.sessionId),filename=path.resolve(sourcePath);
    if(!filename.startsWith(root+path.sep)||await realpath(root)!==root||
      await realpath(filename)!==filename)integrity();
    const stat=await lstat(filename);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==plan.size)integrity();
    const [reservation]=await db.select().from(mediaReservations).where(eq(mediaReservations.id,plan.sessionId));
    if(!reservation||!/^thumb-[a-f0-9-]{36}\.webp$/.test(reservation.thumbnailKey))integrity();
    return withMediaWorkBudget(async()=>{
      let photo:Awaited<ReturnType<typeof preparePhoto>>;
      try{photo=await preparePhoto(filename,plan.mime,plan.size,plan.owner.kind==="creator"?"creator-original":"official");}
      catch(error){if(error instanceof InvalidPhotoError)integrity();throw error;}
      if(photo.mimeType!=="image/jpeg"||photo.download.length!==plan.size||
        hash(photo.download)!==plan.sha256||photo.preview.length<1||photo.preview.length>PREVIEW_BYTES)integrity();
      const preview=photo.preview,thumbnailPath=path.join(root,"native-thumbnail.webp"),sha256=hash(preview);
      const temporary=path.join(root,`native-preview-${randomUUID()}.tmp`);
      let installed=false;
      try{
        const output=await open(temporary,"wx",0o600);
        try{await output.writeFile(preview);await output.sync();}
        finally{await output.close();}
        try{await link(temporary,thumbnailPath);installed=true;}
        catch(error:any){if(error.code!=="EEXIST")throw error;}
      }finally{await unlink(temporary).catch(()=>{});}
      if(!installed){
        const current=await open(thumbnailPath,constants.O_RDONLY|constants.O_NOFOLLOW);
        try{
          const stat=await current.stat();
          if(!stat.isFile()||stat.size!==preview.length||stat.size>PREVIEW_BYTES)integrity();
          if(hash(await current.readFile())!==sha256)integrity();
        }finally{await current.close();}
      }
      context.journal.assertLease();
      if(plan.size+preview.length>reservation.reservedBytes)integrity();
      return {sourcePath:filename,thumbnail:{path:thumbnailPath,key:reservation.thumbnailKey,
        size:preview.length,sha256,mime:"image/webp" as const},
        media:{eventId:plan.eventId,type:"image" as const,url:sourceUrl,
          thumbnail:`/api/media/files/${reservation.thumbnailKey}`,highBytes:plan.size,
          lowBytes:preview.length,storedBytes:plan.size+preview.length,objectCount:2,isPremium:false}};
    });
  });
}
