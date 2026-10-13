import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getObjectStore, deferredStream, assertMediaKey, objectMime, ObjectStoreError, type Provider } from "./object-store";
import { mediaStorageEnvironment, assertMediaDatabaseTarget } from "./media-storage-config";

export function routingEnabled(env = process.env) {
  const provider = env.MEDIA_STORAGE_PROVIDER || "replit";
  if (provider !== "replit" && provider !== "r2") throw new ObjectStoreError("configuration");
  const enabled = env.MEDIA_STORAGE_ROUTING === "enabled";
  if (env.MEDIA_STORAGE_ROUTING && !["enabled","disabled"].includes(env.MEDIA_STORAGE_ROUTING))
    throw new ObjectStoreError("configuration");
  if (provider === "r2" && !enabled) throw new ObjectStoreError("configuration");
  if (enabled) {
    const scope = mediaStorageEnvironment(env);
    assertMediaDatabaseTarget(env);
    if (scope === "production" && provider === "r2" && env.R2_PROD_WRITE_ENABLED !== "true")
      throw new ObjectStoreError("configuration");
  }
  return enabled;
}
export async function verifyMediaStorageReadiness() {
  if (!routingEnabled()) {
    const table = await query(sql`select to_regclass('media_object_routes') as name`);
    if (table.rows[0]?.name) {
      const mapped = await query(sql`select key from media_object_routes where provider='r2' or to_jsonb(media_object_routes)->>'retained_source'='true' limit 1`);
      if (mapped.rows.length) throw new ObjectStoreError("configuration");
    }
    return;
  }
  await query(sql`select key from media_object_routes limit 0`);
  const active = await query(sql`select key from media_object_routes where provider='r2' limit 1`);
  if (process.env.MEDIA_STORAGE_PROVIDER === "r2" || active.rows.length) getObjectStore("r2");
}
async function query(statement: ReturnType<typeof sql>) {
  const {db} = await import("./db");
  return db.execute(statement);
}
export type RouteQuery = typeof query;
export function assertNewMediaUploadsEnabled() {
  const enabled = process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED;
  if (enabled === "false" ||
      (process.env.MEDIA_STORAGE_PROVIDER === "r2" && enabled !== "true"))
    throw new ObjectStoreError("configuration");
}
export async function routeFor(key: string, registered = false) {
  assertMediaKey(key);
  if (!registered && !routingEnabled()) return undefined;
  return (await query(sql`select * from media_object_routes where key=${key}`)).rows[0] as
    {provider:Provider;state:string;sha256:string;size:number;mime:string;retained_source:boolean;source_sha256:string;object_version:string} | undefined;
}
export async function hashStream(stream: Readable, limit = 100 * 1048576) {
  const hash = createHash("sha256"); let size = 0;
  const timer = setTimeout(() => stream.destroy(new ObjectStoreError("upstream")), 120_000);
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > limit) throw new ObjectStoreError("integrity");
      hash.update(chunk);
    }
    if (!size) throw new ObjectStoreError("integrity");
    return {sha256:hash.digest("hex"),size};
  } finally {clearTimeout(timer);stream.destroy();}
}
export async function putMediaObject(key: string, data: Buffer | string) {
  assertMediaKey(key);
  const enabled = routingEnabled();
  const existing = await routeFor(key);
  if (existing) throw new ObjectStoreError("integrity"); // immutable UUID objects; no overwrite
  const provider = (process.env.MEDIA_STORAGE_PROVIDER || "replit") as Provider;
  if (provider === "r2" && process.env.MEDIA_STORAGE_NEW_UPLOADS_ENABLED !== "true")
    throw new ObjectStoreError("configuration"); // readiness is not permission for a live smoke test
  if (enabled) await query(sql`insert into media_object_routes(key,provider,state)
    values(${key},${provider},'pending')`); // durable before first network write
  await getObjectStore(provider).put(key,data,objectMime(key),provider === "r2" ? {createOnly:true} : undefined);
  if (enabled) {
    const digest = await hashStream(typeof data === "string" ? createReadStream(data) : Readable.from(data));
    const actual = await hashStream(getObjectStore(provider).open(key));
    if (digest.sha256 !== actual.sha256 || digest.size !== actual.size) throw new ObjectStoreError("integrity");
    const metadata = await getObjectStore(provider).metadata(key);
    if (metadata.size !== actual.size || metadata.mime !== objectMime(key) || !metadata.version)
      throw new ObjectStoreError("integrity");
    await query(sql`update media_object_routes set state='verified',sha256=${actual.sha256},
      size=${actual.size},mime=${objectMime(key)},object_version=${metadata.version},updated_at=now() where key=${key}`);
  }
}
export function openMediaObject(key: string) {
  assertMediaKey(key);
  if (!routingEnabled()) return getObjectStore("replit").open(key);
  return deferredStream(async () => {
    const route = await routeFor(key);
    if (route && route.state !== "verified") throw new ObjectStoreError("integrity");
    // Never retry on another provider: auth/config/integrity errors fail closed.
    const store = getObjectStore(route?.provider || "replit");
    if (route) {
      const metadata = await store.metadata(key);
      if (!route.object_version || metadata.version !== route.object_version ||
        metadata.size !== Number(route.size) || metadata.mime !== route.mime)
        throw new ObjectStoreError("integrity");
      return store.open(key,undefined,metadata.version);
    }
    return store.open(key);
  });
}
export async function mediaVideoSource(key: string) {
  const route = await routeFor(key);
  if (route && route.state !== "verified") throw new ObjectStoreError("integrity");
  const store = getObjectStore(route?.provider || "replit");
  const meta = await store.metadata(key);
  if (route && (!route.object_version || meta.version !== route.object_version ||
    meta.size !== Number(route.size) || meta.mime !== route.mime)) throw new ObjectStoreError("integrity");
  return {size:meta.size,open:(range: {start:number;end:number}) => store.open(key,range,meta.version)};
}
export async function deleteRoutedMediaObject(key: string, registered = false, transactionQuery?: RouteQuery) {
  assertMediaKey(key);
  const execute = transactionQuery || query;
  const route = registered && transactionQuery
    ? (await execute(sql`select * from media_object_routes where key=${key} for update`)).rows[0] as Awaited<ReturnType<typeof routeFor>>
    : await routeFor(key,registered);
  if (route?.provider === "r2" && !routingEnabled()) throw new ObjectStoreError("configuration");
  if (route?.retained_source && route.provider === "replit") throw new ObjectStoreError("retained");
  await getObjectStore(route?.provider || "replit").delete(key);
  if (route) await execute(sql`update media_object_routes set state='deleted',updated_at=now() where key=${key}`);
  // Retained Replit source is NEVER removed, even on deletion of the R2 target.
}
