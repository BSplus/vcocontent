import type { Request } from "express";
import { storage } from "./storage";
import { eventPublic, mediaPublic } from "./beta-access";

const defaultTitle = "VCO Media Database | Esports Racing Photos";
const defaultDescription = "Explore VCO esports racing photos, event galleries and creator media.";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function summary(value: string, max = 160): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** An explicit published origin avoids producing canonical links from untrusted Host headers. */
export function publicSiteUrl(): string | null {
  const configured = process.env.PUBLIC_SITE_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function seoHtml(req: Request, html: string): Promise<{ html: string; status: number }> {
  // Express mounts the SPA fallback at "*", so req.path is "/" there; use the
  // original request URL rather than the path relative to the fallback mount.
  const pathname = new URL(req.originalUrl || req.path, "https://local.invalid").pathname;
  let title = defaultTitle;
  let description = defaultDescription;
  let status = 200;
  let thumbnail: string | undefined;
  let indexable = pathname === "/" || ["/current-events", "/upcoming-events", "/archive-events", "/creator-events"].includes(pathname);
  const eventMatch = /^\/events\/([1-9]\d*)\/?$/.exec(pathname);
  const mediaMatch = /^\/media\/([1-9]\d*)\/?$/.exec(pathname);
  if (eventMatch) {
    const event = await storage.getEvent(Number(eventMatch[1]));
    if (!event || event.isPremium || !await eventPublic(event)) status = 404;
    else {
      title = `${event.title} | VCO Media Database`;
      description = summary(event.description || `Photos and media from ${event.title}.`);
      indexable = true;
    }
  } else if (mediaMatch) {
    const item = await storage.getMediaItem(Number(mediaMatch[1]));
    const event = item?.eventId ? await storage.getEvent(item.eventId) : undefined;
    if (!item || !event || item.isPremium || event.isPremium || !await mediaPublic(item,event)) status = 404;
    else {
      title = `${summary(item.caption || `${event.title} photo`, 100)} | VCO Media Database`;
      description = summary(`${item.caption || event.title}. ${item.photographer ? `Photo by ${item.photographer}.` : ""} VCO esports media.`);
      indexable = item.type === "image";
      if (indexable) {
        const candidate = item.thumbnail.startsWith("data:") ? `/api/media/legacy/${item.id}/thumbnail` : item.thumbnail;
        if (/^\/api\/media\/(?:files\/thumb-[0-9a-f-]{36}\.webp|legacy\/[1-9]\d*\/thumbnail)$/.test(candidate))
          thumbnail = candidate;
      }
    }
  } else if (pathname === "/search") {
    title = "Search Esports Racing Photos | VCO Media Database";
  } else if (pathname === "/imprint") {
    title = "Imprint | VCO Media Database";
  }
  const base = publicSiteUrl();
  const url = base && indexable && status === 200 ? `${base}${pathname === "/" ? "/" : pathname.replace(/\/$/, "")}` : null;
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta name="robots" content="${url ? "index,follow" : "noindex,follow"}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    ...(url ? [`<link rel="canonical" href="${escapeHtml(url)}">`, `<meta property="og:url" content="${escapeHtml(url)}">`] : []),
    ...(base && url && thumbnail ? [
      `<meta property="og:image" content="${escapeHtml(base + thumbnail)}">`,
      `<meta property="og:image:alt" content="${escapeHtml(summary(description, 120))}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    ] : []),
  ];
  return { html: html.replace("</head>", `${tags.join("\n")}\n</head>`), status };
}