import type { Express, Response } from "express";
import { publicSiteUrl } from "./seo";
import { searchData, SITEMAP_PAGE_SIZE } from "./public-search-data";
import { escapeHtml, publicThumbnail } from "./seo-markup";
import { storage } from "./storage";
import { eventPublic } from "./beta-access";

const pages = ["/", "/current-events", "/upcoming-events", "/archive-events", "/creator-events"];
const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n';
const urlset = (body: string) => `${xmlHeader}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${body}</urlset>`;
const loc = (base: string, path: string) => `<loc>${escapeHtml(base + path)}</loc>`;
const send = (res: Response, xml: string) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.type("application/xml").send(xml);
};
const validPage = (value: string | undefined) => value === undefined ? 1 : /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : 0;

export function registerSeoRoutes(app: Express) {
  app.get("/robots.txt", (_req, res) => {
    const base = publicSiteUrl();
    res.setHeader("Cache-Control", "private, no-store");
    res.type("text/plain").send(base
      ? `User-agent: *\nDisallow: /api/\nAllow: /api/media/files/thumb-\nAllow: /api/media/legacy/*/thumbnail\nDisallow: /admin\nDisallow: /creator/dashboard\nDisallow: /auth\nDisallow: /account\nDisallow: /credits\nDisallow: /search\nSitemap: ${base}/sitemap.xml\n`
      : "User-agent: *\nDisallow: /\n");
  });
  app.get("/sitemap.xml", async (_req, res) => {
    const base = publicSiteUrl();
    if (!base) return res.status(404).end();
    try {
      const counts = await searchData.counts();
      const paths = ["/sitemap-pages.xml"];
      const segments = (total: number, path: (page: number) => string) => {
        const n = Math.ceil(total / SITEMAP_PAGE_SIZE);
        if (n + paths.length > 50000) throw new Error("Sitemap index requires further segmentation");
        for (let page = 1; page <= n; page++) paths.push(path(page));
      };
      segments(counts.events, page => `/sitemap-events/${page}.xml`);
      segments(counts.creators, page => `/sitemap-creators/${page}.xml`);
      for (const item of counts.images) segments(item.total, page => `/sitemap-media/${item.id}/${page}.xml`);
      send(res, `${xmlHeader}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<sitemap>${loc(base, path)}</sitemap>`).join("")}</sitemapindex>`);
    } catch {
      console.error("Sitemap index generation failed");
      res.status(503).end();
    }
  });
  app.get("/sitemap-pages.xml", (_req, res) => {
    const base = publicSiteUrl();
    if (!base) return res.status(404).end();
    send(res, urlset(pages.map(path => `<url>${loc(base, path)}</url>`).join("")));
  });
  for (const kind of ["events", "creators"] as const) app.get(`/sitemap-${kind}/:page.xml`, async (req, res) => {
    const base = publicSiteUrl(), page = validPage(req.params.page);
    if (!base || !page) return res.status(404).end();
    try {
      const items = kind === "events" ? await searchData.events("all", page) : await searchData.creators(page);
      if (!items.length) return res.status(404).end();
      send(res, urlset(items.map(item => `<url>${loc(base, `/${kind === "events" ? "events" : "creator"}/${item.id}`)}</url>`).join("")));
    } catch {
      console.error("Public page sitemap generation failed");
      res.status(503).end();
    }
  });
  app.get(["/sitemap-media/:id.xml", "/sitemap-media/:id/:page.xml"], async (req, res) => {
    const base = publicSiteUrl(), id = validPage(req.params.id), page = validPage(req.params.page);
    if (!base || !id || !page) return res.status(404).end();
    try {
      const event = await storage.getEvent(id);
      if (!event || event.isPremium || !await eventPublic(event)) return res.status(404).end();
      const items = await searchData.images(id, page);
      if (!items.length) return res.status(404).end();
      send(res, urlset(items.map(item => {
        const preview = publicThumbnail(item);
        return preview ? `<url>${loc(base, `/media/${item.id}`)}<image:image><image:loc>${escapeHtml(base + preview)}</image:loc></image:image></url>` : "";
      }).join("")));
    } catch {
      console.error("Image sitemap generation failed");
      res.status(503).end();
    }
  });
}
