// Process-shared local fixture store for restart tests, removed with the test
// database by the runner. App Storage is never contacted in this test mode.
import { Client } from "@replit/object-storage";
import { mkdir, copyFile, readFile, writeFile, readdir, unlink, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
const root=process.env.VCO_TEST_OBJECTS;
if(root) {
  await mkdir(root,{recursive:true});
  const filename=key=>{
    if(!/^(media|thumb|ref)-[0-9a-f-]{36}\.[a-z0-9]+$/.test(key))throw new Error("Invalid fixture object key");
    return path.join(root,key);
  };
  Client.prototype.uploadFromFilename=async(key,source)=>{await copyFile(source,filename(key));return {ok:true};};
  Client.prototype.uploadFromBytes=async(key,bytes)=>{await writeFile(filename(key),bytes);return {ok:true};};
  Client.prototype.downloadAsStream=key=>createReadStream(filename(key));
  Client.prototype.downloadAsBytes=async key=>({ok:true,value:await readFile(filename(key))});
  Client.prototype.delete=async key=>{await unlink(filename(key)).catch(error=>{if(error.code!=="ENOENT")throw error;});return {ok:true};};
  Client.prototype.list=async({prefix=""}={})=>({ok:true,value:await Promise.all((await readdir(root))
    .filter(key=>key.startsWith(prefix)).map(async name=>({name,size:(await stat(filename(name))).size})))});
}
