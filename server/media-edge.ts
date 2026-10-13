import type { Express } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { edgeAuthMessage, previewKeyPattern, previewDigestPattern } from "@shared/media-edge-auth";
import { storage } from "./storage";
import { mediaPublic } from "./beta-access";
import { routeFor } from "./media-object-routing";

export function validEdgeAuth(key: string, version: string, timestamp: string, signature: string,
  secret = process.env.MEDIA_EDGE_AUTH_SECRET, now = Date.now()) {
  if (!secret || secret.length < 32 || !previewKeyPattern.test(key) || !previewDigestPattern.test(version) ||
    !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 15_000 ||
    !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(edgeAuthMessage(key,version,timestamp)).digest();
  return timingSafeEqual(expected,Buffer.from(signature,"hex"));
}
export function edgeOrigin() {
  if (!process.env.MEDIA_EDGE_ORIGIN) return undefined;
  if (process.env.NODE_ENV === "production") throw new Error("Development edge delivery only");
  const url = new URL(process.env.MEDIA_EDGE_ORIGIN);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
    url.pathname !== "/") throw new Error("Invalid development edge origin");
  return url.origin;
}
export async function publicPreviewVersion(key: string) {
  if (!previewKeyPattern.test(key)) return undefined;
  const item = await storage.findMediaByKey(key);
  const event = item?.eventId ? await storage.getEvent(item.eventId) : undefined;
  // Owner/admin preview privilege is deliberately not sufficient for edge.
  if (!item || !event || item.thumbnail !== `/api/media/files/${key}` ||
    event.visibility !== "published" || item.isPremium || event.isPremium || !await mediaPublic(item,event)) return undefined;
  const route = await routeFor(key);
  if (!route || route.provider !== "r2" || route.state !== "verified" ||
    !previewDigestPattern.test(route.sha256) || Number(route.size) >= 100_000 ||
    route.mime !== "image/webp") return undefined;
  return route.sha256;
}
export function registerMediaEdge(app: Express) {
  app.post("/api/internal/media-preview/:key/:version", async (req,res) => {
    res.setHeader("Cache-Control","private, no-store");
    const {key,version} = req.params;
    try {
      if (!edgeOrigin() || !validEdgeAuth(key,version,
        String(req.headers["x-vco-timestamp"] || ""),String(req.headers["x-vco-signature"] || "")))
        return res.status(404).end();
      if (await publicPreviewVersion(key) !== version) return res.status(404).end();
      return res.json({allowed:true,version});
    } catch { return res.status(503).end(); }
  });
}
