import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useLocationProperty } from "wouter/use-browser-location";
import { SITE_NAME, UNAVAILABLE_TITLE, UNAVAILABLE_DESCRIPTION } from "@shared/site-metadata";

const currentSearch = () => window.location.search;

/** Refresh server-owned public metadata on SPA navigation, not auth/API data. */
export default function PageMetadata() {
  const [pathname] = useLocation();
  const search = useLocationProperty(currentSearch);
  const initial = useRef(true);
  useEffect(() => {
    const currentPath = pathname.replace(/\/$/, "") || "/";
    const first = initial.current;
    initial.current = false;
    if (first && document.querySelector('meta[name="vco-page-path"]')?.getAttribute("content") === currentPath &&
      document.querySelector('meta[name="vco-page-query"]')?.getAttribute("content") === search) return;
    const controller = new AbortController();
    // Clear everything owned by the previous route, including its title and image.
    // Global favicon/touch-icon links are deliberately not owned by this component.
    document.head.querySelectorAll("[data-vco-seo],title").forEach(node => node.remove());
    const title = document.createElement("title");
    title.textContent = UNAVAILABLE_TITLE; title.dataset.vcoSeo = "true";
    document.head.append(title);
    for (const [name, content] of [
      ["robots", "noindex,follow"], ["description", UNAVAILABLE_DESCRIPTION],
      ["og:type", "website"], ["og:site_name", SITE_NAME],
      ["og:title", UNAVAILABLE_TITLE], ["og:description", UNAVAILABLE_DESCRIPTION],
      ["twitter:card", "summary"], ["twitter:title", UNAVAILABLE_TITLE],
      ["twitter:description", UNAVAILABLE_DESCRIPTION],
    ]) {
      const meta = document.createElement("meta");
      meta.setAttribute(name.startsWith("og:") ? "property" : "name", name);
      meta.content = content; meta.dataset.vcoSeo = "true"; document.head.append(meta);
    }
    void fetch(currentPath + search, { signal: controller.signal, credentials: "omit", headers: { Accept: "text/html" } })
      .then(response => {
        if ((!response.ok && response.status !== 404) || !response.headers.get("content-type")?.includes("text/html")) throw new Error("Metadata unavailable");
        return response.text();
      }).then(html => {
        if (controller.signal.aborted) return;
        const page = new DOMParser().parseFromString(html, "text/html");
        if (page.querySelector('meta[name="vco-page-path"]')?.getAttribute("content") !== currentPath ||
          page.querySelector('meta[name="vco-page-query"]')?.getAttribute("content") !== search) return;
        const tags = page.head.querySelectorAll("title[data-vco-seo],meta[data-vco-seo],link[rel=canonical][data-vco-seo],script[type='application/ld+json'][data-vco-seo]");
        if (!page.head.querySelector("title[data-vco-seo]") || !page.head.querySelector('meta[name="robots"][data-vco-seo]')) return;
        document.head.querySelectorAll("[data-vco-seo],title").forEach(node => node.remove());
        tags.forEach(tag => document.head.append(document.importNode(tag, true)));
      }).catch(() => { /* Fail closed: no canonical and noindex remain. */ });
    return () => controller.abort();
  }, [pathname, search]);
  return null;
}
