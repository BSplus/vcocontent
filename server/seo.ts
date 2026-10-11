import type { Request } from "express";
import { storage } from "./storage";
import { eventPublic, mediaPublic } from "./beta-access";
import { activeCreator } from "./creator-profiles";
import { searchData } from "./public-search-data";
import { dateLabel, escapeHtml, eventLinks, imageLinks, jsonLd, publicThumbnail, summary } from "./seo-markup";
import { ARCHIVE_FAQ } from "@shared/public-content";

const defaultTitle = "VCO Media Database | Esports Racing Photos";
const defaultDescription = "Explore VCO esports racing photos, event galleries and creator media.";
const indexPages: Record<string, { title: string; description: string; scope: string }> = {
  "/": { title: defaultTitle, description: defaultDescription, scope: "all" },
  "/current-events": { title: "Recent Esports Racing Events | VCO Media Database", description: "Browse VCO event galleries from the last four weeks.", scope: "current" },
  "/upcoming-events": { title: "Upcoming Esports Racing Events | VCO Media Database", description: "Explore upcoming VCO esports racing events.", scope: "upcoming" },
  "/archive-events": { title: "Esports Racing Event Archive | VCO Media Database", description: "Browse past VCO esports racing event galleries and photos.", scope: "archive" },
  "/creator-events": { title: "Creator Photo Galleries | VCO Media Database", description: "Discover published esports racing photo galleries from VCO community creators.", scope: "creator" },
};

/** An explicit published origin avoids producing canonical links from untrusted Host headers. */
export function publicSiteUrl(): string | null {
  const configured = process.env.PUBLIC_SITE_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      url.hostname.endsWith(".replit.dev") || url.hostname === "localhost") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Opt-in only after both origins have been verified by the operator. */
export function canonicalRedirect(req: Request): string | null {
  const base = publicSiteUrl(), old = process.env.PUBLIC_PREVIOUS_SITE_URL;
  if (!base || !old || !["GET", "HEAD"].includes(req.method) || req.protocol !== "https") return null;
  try {
    const previous = new URL(old);
    if (previous.protocol !== "https:" || previous.username || previous.password || previous.pathname !== "/" ||
      previous.search || previous.hash || previous.origin === base || req.get("host")?.toLowerCase() !== previous.host) return null;
    const path = new URL(req.originalUrl, "https://local.invalid");
    return base + path.pathname + path.search;
  } catch { return null; }
}

export async function seoHtml(req: Request, html: string): Promise<{ html: string; status: number }> {
  // Express mounts the SPA fallback at "*", so req.path is "/" there; use the
  // original request URL rather than the path relative to the fallback mount.
  const requestUrl = new URL(req.originalUrl || req.path, "https://local.invalid");
  const pathname = requestUrl.pathname.replace(/\/$/, "") || "/";
  let title = defaultTitle;
  let description = defaultDescription;
  let status = 200;
  let thumbnail: string | undefined;
  let body = "";
  let indexable = false;
  const schema: Record<string, unknown>[] = [];
  const base = publicSiteUrl();
  const routeUrl = base ? base + pathname : undefined;
  let crumb: { name: string; path: string }[] = [];
  const eventMatch = /^\/events\/([1-9]\d*)\/?$/.exec(pathname);
  const mediaMatch = /^\/media\/([1-9]\d*)\/?$/.exec(pathname);
  const creatorMatch = /^\/creator\/([1-9]\d*)\/?$/.exec(pathname);
  const paragraph = (value: string) => `<p>${escapeHtml(value)}</p>`;
  const invalidId = [eventMatch, mediaMatch, creatorMatch].some(match => match &&
    (!Number.isSafeInteger(Number(match[1])) || Number(match[1]) > 2147483647));
  if (invalidId) status = 404;
  else if (eventMatch) {
    const event = await storage.getEvent(Number(eventMatch[1]));
    if (!event || event.isPremium || !await eventPublic(event)) status = 404;
    else {
      title = `${event.title} | VCO Media Database`;
      description = summary(event.description || `Photos and media from ${event.title}.`);
      indexable = true;
      const images = await searchData.images(event.id, 1, 48);
      body = `<h1>${escapeHtml(event.title)}</h1>${paragraph(event.description || "")}${paragraph(dateLabel(event.date))}`;
      if (event.creatorId) {
        const creator = await storage.getUser(event.creatorId);
        if (creator && activeCreator(creator)) body += `<p>Creator: <a href="/creator/${creator.id}">${escapeHtml(creator.displayName?.trim() || creator.username)}</a></p>`;
      }
      body += imageLinks(images, event.title);
      thumbnail = images[0] && publicThumbnail(images[0]);
      crumb = [{ name: event.title, path: pathname }];
      if (routeUrl) schema.push({ "@type": "CollectionPage", name: event.title, description, url: routeUrl });
    }
  } else if (mediaMatch) {
    const item = await storage.getMediaItem(Number(mediaMatch[1]));
    const event = item?.eventId ? await storage.getEvent(item.eventId) : undefined;
    if (!item || !event || item.isPremium || event.isPremium || !await mediaPublic(item,event)) status = 404;
    else {
      title = `${summary(item.caption || `${event.title} photo`, 100)} | VCO Media Database`;
      description = summary(`${item.caption || event.title}. ${item.photographer ? `Photo by ${item.photographer}.` : ""} VCO esports media.`);
      thumbnail = publicThumbnail(item);
      indexable = item.type === "image" && !!thumbnail;
      body = `<p><a href="/events/${event.id}">Back to event gallery</a></p><h1>${escapeHtml(item.caption || "Esports racing media")}</h1>`;
      if (thumbnail) body += `<img class="public-photo" src="${escapeHtml(thumbnail)}" alt="${escapeHtml(item.caption || `${event.title} photo`)}" width="960" height="640">`;
      if (item.photographer) body += paragraph(`Photographer: ${item.photographer}`);
      body += `<p>Event: <a href="/events/${event.id}">${escapeHtml(event.title)}</a> ${escapeHtml(dateLabel(event.date))}</p>`;
      body += paragraph("Download availability does not grant a reuse licence. Check the applicable rights and permissions before publishing or reusing media.");
      body += `<p><a href="/auth">Register or sign in for original downloads</a></p>`;
      crumb = [{ name: event.title, path: `/events/${event.id}` }, { name: item.caption || "Photo", path: pathname }];
      if (indexable) {
        if (base) schema.push({
          "@type": "ImageObject", name: item.caption || `${event.title} photo`, description,
          contentUrl: base + thumbnail, thumbnailUrl: base + thumbnail, url: routeUrl,
          ...(item.photographer ? { creator: { "@type": "Person", name: item.photographer }, creditText: item.photographer } : {}),
          isPartOf: { "@type": "CollectionPage", name: event.title, url: `${base}/events/${event.id}` },
        });
      }
    }
  } else if (creatorMatch) {
    const creator = await storage.getUser(Number(creatorMatch[1]));
    if (!creator || !activeCreator(creator)) status = 404;
    else {
      const name = creator.displayName?.trim() || creator.username;
      title = `${name} · VCO Creator`;
      description = summary(creator.bio || `Published esports racing photo galleries by ${name}.`);
      indexable = true;
      body = `<h1>${escapeHtml(name)}</h1>${paragraph(`VCO creator · @${creator.username}`)}${paragraph(creator.bio || "No biography added yet.")}<h2>Published galleries</h2>`;
      body += eventLinks(await searchData.events("all", 1, 48, creator.id));
      crumb = [{ name, path: pathname }];
      if (routeUrl) schema.push({ "@type": "ProfilePage", url: routeUrl, mainEntity: { "@type": "Person", name, url: routeUrl, description } });
    }
  } else if (indexPages[pathname]) {
    const page = indexPages[pathname];
    title = page.title;
    description = page.description;
    indexable = true;
    body = `<h1>${pathname === "/" ? "Every race. Every frame." : escapeHtml(title.split(" | ")[0])}</h1>${paragraph(description)}`;
    body += eventLinks(await searchData.events(page.scope, 1, 48));
    if (pathname === "/") {
      body += `<section><h2>About the VCO archive</h2>${ARCHIVE_FAQ.map(entry => `<h3>${escapeHtml(entry.question)}</h3>${paragraph(entry.answer)}`).join("")}</section>`;
      if (base) schema.push({ "@type": "Organization", "@id": `${base}/#organization`, name: "VCO", url: base });
    } else crumb = [{ name: title.split(" | ")[0], path: pathname }];
  } else if (pathname === "/search") {
    title = "Search Esports Racing Photos | VCO Media Database";
  } else if (pathname === "/imprint") {
    title = "Imprint | VCO Media Database";
    description = "Company information and media rights for the VCO Media Database.";
  } else if (pathname === "/privacy-policy") {
    title = "Privacy Policy | VCO Media Database";
    description = "Privacy information for VCO galleries, accounts, creator uploads and AI processing.";
  } else if (!["/auth", "/account", "/credits", "/creator/dashboard", "/creator/apply", "/admin/dashboard", "/admin/users"].includes(pathname)) {
    status = 404;
  }
  const filtered = Array.from(requestUrl.searchParams.keys()).some(key => !/^(utm_(source|medium|campaign|term|content)|source|ref)$/.test(key));
  const url = base && indexable && status === 200 ? base + pathname : null;
  if (base && crumb.length && url) schema.push({
    "@type": "BreadcrumbList", itemListElement: [{ name: "VCO archive", path: "/" }, ...crumb]
      .map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: base + item.path })),
  });
  const tags = [
    `<meta name="vco-page-path" content="${escapeHtml(pathname)}">`,
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta name="robots" content="${url && !filtered ? "index,follow,max-image-preview:large" : "noindex,follow"}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    ...(url ? [`<link rel="canonical" href="${escapeHtml(url)}">`, `<meta property="og:url" content="${escapeHtml(url)}">`] : []),
    ...(base && url && thumbnail ? [
      `<meta property="og:image" content="${escapeHtml(base + thumbnail)}">`,
      `<meta property="og:image:alt" content="${escapeHtml(summary(description, 120))}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    ] : []),
    ...(url && schema.length ? [jsonLd({ "@context": "https://schema.org", "@graph": schema })] : []),
  ];
  const markedTags = tags.map(tag => tag.replace(/^<(title|meta|link|script)/, '<$1 data-vco-seo="true"'));
  // This is the same public content for every visitor, replaced by React when
  // JS loads. It is not a bot-only payload or a hidden second copy of the page.
  const content = body ? `<div class="public-html"><header><a href="/">VCO Media Database</a></header><nav aria-label="Archive navigation"><a href="/current-events">Recent events</a> · <a href="/upcoming-events">Upcoming events</a> · <a href="/archive-events">Archive</a> · <a href="/creator-events">Creator galleries</a> · <a href="/search">Search media</a></nav><main>${body}</main><footer><a href="/imprint">Imprint and media rights</a> · <a href="/privacy-policy">Privacy policy</a></footer></div>` : "";
  return {
    html: html.replace("</head>", `${markedTags.join("\n")}\n</head>`)
      .replace('<div id="root"></div>', `<div id="root">${status === 200 ? content : '<main class="public-html"><h1>Page not found</h1><a href="/">Back to archive</a></main>'}</div>`),
    status,
  };
}