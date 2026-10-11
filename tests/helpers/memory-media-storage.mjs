import { Client } from "@replit/object-storage";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";

/** Install only in isolated test processes; no network/object bucket is used. */
export function mockMediaStorage() {
  const objects = new Map(), writes = [];
  const original = {};
  const methods = {
    async uploadFromFilename(key, filename) {
      writes.push(key);
      if (api.failKey?.(key)) return {ok:false,error:new Error("Synthetic storage failure")};
      objects.set(key, await readFile(filename));
      return {ok:true};
    },
    async uploadFromBytes(key, bytes) {objects.set(key, Buffer.from(bytes));writes.push(key);return {ok:true};},
    downloadAsStream(key) {return objects.has(key) ? Readable.from(objects.get(key)) :
      new Readable({read(){this.destroy(new Error("Synthetic missing object"));}});},
    async delete(key) {
      if (api.failDelete?.(key)) return {ok:false,error:new Error("Synthetic deletion failure")};
      objects.delete(key);return {ok:true};
    },
  };
  for (const [name, fn] of Object.entries(methods)) {original[name]=Client.prototype[name];Client.prototype[name]=fn;}
  const api = {objects,writes,failKey:null,failDelete:null,
    restore(){for(const [name,fn] of Object.entries(original)) Client.prototype[name]=fn;}};
  return api;
}
