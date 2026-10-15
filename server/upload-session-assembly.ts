import {createReadStream} from "node:fs";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,open,rename,rm,stat} from "node:fs/promises";
import path from "node:path";
import {withMediaWorkBudget} from "./media-work-budget";
import {MultipartUploadError} from "./r2-multipart-upload";
import {uploadSessionDirectory} from "./upload-session-staging";
import type {mediaUploadSessions} from "@shared/schema";
type Session=typeof mediaUploadSessions.$inferSelect;
export const UPLOAD_PART_BYTES=1024*1024;
const invalid=():never=>{throw new MultipartUploadError("integrity");};

/** Local assembly only; its processing slot closes before image/transport work. */
export async function assembleUploadSource(row:Session,stable=false){
  return withMediaWorkBudget(async()=>{
    const root=uploadSessionDirectory(row.id);
    const directory=stable?path.join(root,"assembled-native"):await mkdtemp(path.join(root,"assembled-"));
    await mkdir(directory,{recursive:true});
    const filename=path.join(directory,"source"),pending=path.join(directory,"source.pending");
    if(stable){
      try{
        if((await stat(filename)).size!==row.size)invalid();
        const hash=createHash("sha256");
        for await(const chunk of createReadStream(filename))hash.update(chunk);
        if(hash.digest("hex")!==row.sha256)invalid();
        return {filename,directory};
      }catch(error:any){if(error.code!=="ENOENT")throw error;}
    }
    await rm(pending,{force:true});
    const output=await open(pending,"wx",0o600),digest=createHash("sha256");
    const parts=row.parts as Record<string,{size:number;sha256:string}>;
    let size=0;
    try{
      if(Object.keys(parts).length!==Math.ceil(row.size/UPLOAD_PART_BYTES))invalid();
      for(let i=0;i<Math.ceil(row.size/UPLOAD_PART_BYTES);i++){
        const part=parts[String(i)];if(!part)invalid();
        const input=createReadStream(path.join(root,`${i}.part`)),hash=createHash("sha256");
        let count=0;
        for await(const chunk of input){
          count+=chunk.length;size+=chunk.length;
          if(count>part.size||size>row.size)invalid();
          hash.update(chunk);digest.update(chunk);
          let offset=0;
          while(offset<chunk.length)offset+=(await output.write(chunk,offset,chunk.length-offset)).bytesWritten;
        }
        if(count!==part.size||hash.digest("hex")!==part.sha256)invalid();
      }
      if(size!==row.size||digest.digest("hex")!==row.sha256)invalid();
      await output.sync();await output.close();await rename(pending,filename);
      return {filename,directory};
    }catch(error){
      await output.close().catch(()=>{});
      if(!stable)await rm(directory,{recursive:true,force:true});
      throw error;
    }
  });
}
