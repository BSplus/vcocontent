import { useLayoutEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useLocationProperty } from "wouter/use-browser-location";

const currentHash = () => window.location.hash;

/** Reset new pages before paint, but leave history restoration to the browser. */
export default function NavigationScroll() {
  const [pathname] = useLocation();
  const hash = useLocationProperty(currentHash);
  const previous = useRef<string | null>(null);
  const historyTarget = useRef<string | null>(null);
  const target = pathname + hash;

  useLayoutEffect(() => {
    const onPopState = () => {
      historyTarget.current = window.location.pathname + window.location.hash;
    };
    const onNavigation = () => { historyTarget.current = null; };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pushState", onNavigation);
    window.addEventListener("replaceState", onNavigation);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pushState", onNavigation);
      window.removeEventListener("replaceState", onNavigation);
    };
  }, []);

  useLayoutEffect(() => {
    const initial = previous.current === null;
    previous.current = target;
    const restoring = historyTarget.current === target;
    historyTarget.current = null;
    if (restoring) return;

    if (hash) {
      let id = hash.slice(1);
      try { id = decodeURIComponent(id); } catch { /* Treat malformed fragments literally. */ }
      const anchor = document.getElementById(id) || document.getElementsByName(id)[0];
      if (anchor) {
        anchor.scrollIntoView({ behavior: "instant", block: "start" });
        return;
      }
    }
    // Do not interfere with scroll restoration on reload or query-only edits.
    if (!initial) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [target, hash]);

  return null;
}
