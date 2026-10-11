import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useLocationProperty } from "wouter/use-browser-location";

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
    if (first && document.querySelector('meta[name="vco-page-path"]')?.getAttribute("content") === currentPath) return;
    const controller = new AbortController();
    document.head.querySelectorAll("[data-vco-seo]").forEach(node => node.remove());
    const robots = document.createElement("meta");
    robots.name = "robots"; robots.content = "noindex,follow"; robots.dataset.vcoSeo = "true";
    document.head.append(robots);
    void fetch(currentPath + search, { signal: controller.signal, headers: { Accept: "text/html" } })
      .then(response => response.text()).then(html => {
        if (controller.signal.aborted) return;
        const page = new DOMParser().parseFromString(html, "text/html");
        const tags = page.head.querySelectorAll("title[data-vco-seo],meta[data-vco-seo],link[rel=canonical][data-vco-seo],script[type='application/ld+json'][data-vco-seo]");
        if (!tags.length) return;
        document.head.querySelectorAll("[data-vco-seo],title").forEach(node => node.remove());
        tags.forEach(tag => document.head.append(document.importNode(tag, true)));
      }).catch(() => { /* Fail closed: no canonical and noindex remain. */ });
    return () => controller.abort();
  }, [pathname, search]);
  return null;
}
