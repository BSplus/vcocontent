import { edgeAuthMessage, previewKeyPattern, previewDigestPattern } from "../../shared/media-edge-auth";

type Bucket = { get(key: string): Promise<null | {
  size: number; httpMetadata?: {contentType?: string}; arrayBuffer(): Promise<ArrayBuffer>;
}> };
type EdgeCache = {match(request: Request): Promise<Response | undefined>;put(request: Request,response: Response): Promise<void>};
type Env = { MEDIA: Bucket; APP_ORIGIN: string; MEDIA_EDGE_AUTH_SECRET: string; DEVELOPMENT_ONLY: string };
type Context = {waitUntil(promise: Promise<unknown>): void};
const deny = (status = 404) => new Response(null,{status,headers:{"Cache-Control":"no-store"}});
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,"0")).join("");

/** Cache is explicitly consulted ONLY after a fresh app permission decision. */
export async function servePreview(request: Request, env: Env, ctx: Context, cache: EdgeCache,
  appFetch: typeof fetch = fetch) {
  const url = new URL(request.url);
  const match = /^\/preview\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (env.DEVELOPMENT_ONLY !== "true" || !env.MEDIA_EDGE_AUTH_SECRET || env.MEDIA_EDGE_AUTH_SECRET.length < 32 ||
    request.method !== "GET" || url.search || !match ||
    !previewKeyPattern.test(match[1]) || !previewDigestPattern.test(match[2])) return deny();
  const [,key,version] = match;
  try {
    const origin = new URL(env.APP_ORIGIN);
    if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash ||
        origin.username || origin.password) return deny(503);
    const timestamp = String(Date.now());
    const secret = await crypto.subtle.importKey("raw",new TextEncoder().encode(env.MEDIA_EDGE_AUTH_SECRET),
      {name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const signature = hex(await crypto.subtle.sign("HMAC",secret,
      new TextEncoder().encode(edgeAuthMessage(key,version,timestamp))));
    const decision = await appFetch(`${origin.origin}/api/internal/media-preview/${key}/${version}`,{
      method:"POST",redirect:"error",signal:AbortSignal.timeout(5_000),cache:"no-store",
      headers:{"X-VCO-Timestamp":timestamp,"X-VCO-Signature":signature}});
    if (!decision.ok) return deny(decision.status === 404 ? 404 : 503);
    const permission = await decision.json() as {allowed?: boolean;version?: string};
    if (permission.allowed !== true || permission.version !== version) return deny();
    const cacheKey = new Request(`${url.origin}/__private_preview_cache/${key}/${version}`);
    let content = await cache.match(cacheKey);
    const hit = !!content;
    if (!content) {
      const object = await env.MEDIA.get(key);
      if (!object || object.size <= 0 || object.size >= 100_000 ||
        object.httpMetadata?.contentType !== "image/webp") return deny();
      const bytes = await object.arrayBuffer();
      if (bytes.byteLength !== object.size || hex(await crypto.subtle.digest("SHA-256",bytes)) !== version) return deny(502);
      content = new Response(bytes,{headers:{"Content-Type":"image/webp","Cache-Control":"public, max-age=3600"}});
      ctx.waitUntil(cache.put(cacheKey,content.clone()));
    }
    // Browser caches cannot enforce revocation. Immutable identity only in the internal edge cache.
    const response = new Response(content.body,{headers:{"Content-Type":"image/webp",
      "Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-VCO-Cache":hit?"HIT":"MISS"}});
    return response;
  } catch { return deny(503); } // no stale-on-error, no bearer fallback
}
export default {
  fetch(request: Request,env: Env,ctx: Context) {
    const cache = (caches as unknown as {default:EdgeCache}).default;
    return servePreview(request,env,ctx,cache);
  },
};
