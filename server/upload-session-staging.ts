import path from "node:path";
import {tmpdir} from "node:os";
import {rm,lstat} from "node:fs/promises";

export const UPLOAD_SESSION_ROOT=path.join(tmpdir(),"vco-upload-sessions");
export function uploadSessionDirectory(id:string){
  if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))throw new Error("Invalid upload session");
  return path.join(UPLOAD_SESSION_ROOT,id);
}
export async function removeUploadSessionStaging(id:string){
  const directory=uploadSessionDirectory(id);
  await rm(directory,{recursive:true,force:true});
  try{await lstat(directory);}
  catch(error:any){if(error.code==="ENOENT")return;throw error;}
  throw new Error("Upload staging cleanup pending");
}
