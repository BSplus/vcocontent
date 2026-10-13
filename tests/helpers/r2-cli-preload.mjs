// Test-only disk transport. Requires disposable runner; never touches a provider.
import { ReplitStore, R2Store, ObjectStoreError, objectMime, assertMediaKey } from "../../server/object-store.ts";
import { mkdir, readFile, writeFile, stat, unlink, copyFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
if (!process.env.VCO_TEST_OBJECTS || !process.env.VCO_TEST_PG_PROXY)
  throw new Error("R2 fixture requires disposable PostgreSQL/local-object runner");
const roots={replit:process.env.VCO_TEST_OBJECTS,r2:path.join(process.env.VCO_TEST_OBJECTS,"r2")};
await mkdir(roots.r2,{recursive:true});
const originals=[];
for(const [provider,Class] of [["replit",ReplitStore],["r2",R2Store]]) {
  const filename=key=>{assertMediaKey(key);return path.join(roots[provider],key);};
  for (const method of ["metadata","open",...(provider==="r2"?["put","delete","exists"]:[])])
    originals.push([Class,method,Class.prototype[method]]);
  Class.prototype.metadata=async function(key) {
    try {return {size:(await stat(filename(key))).size,mime:objectMime(key),version:"fixture"};}
    catch(e){throw new ObjectStoreError(e.code==="ENOENT"?"missing":"upstream");}
  };
  Class.prototype.open=function(key,range){return createReadStream(filename(key),range||{});};
  if(provider==="r2") {
    Class.prototype.put=async function(key,bytes) {
      if(typeof bytes==="string")await copyFile(bytes,filename(key));else await writeFile(filename(key),bytes);
    };
    Class.prototype.delete=async function(key){await unlink(filename(key)).catch(e=>{if(e.code!=="ENOENT")throw e;});};
    Class.prototype.exists=async function(key){try{await stat(filename(key));return true;}catch(e){if(e.code==="ENOENT")return false;throw e;}};
  }
}
export const fixtureRoots=roots;
export function restoreR2Fixture(){for(const [Class,method,original] of originals)Class.prototype[method]=original;}
