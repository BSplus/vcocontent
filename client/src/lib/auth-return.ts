import type { User } from "@shared/schema";

export function authRedirectForCurrentPage(): string {
  const next = window.location.pathname + window.location.search + window.location.hash;
  return `/auth?${new URLSearchParams({ next }).toString()}`;
}

export function returnAfterAuth(next: string | null, user: User): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") ||
      /[\\\u0000-\u001f\u007f]/.test(next)) return "/";

  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname === "/auth" || url.pathname.startsWith("/auth/")) return "/";
    if (url.pathname.startsWith("/admin/") && !user.isAdmin) return "/";
    if (url.pathname === "/creator/dashboard" &&
        !(user.isCreator || user.isAdmin || user.creatorStatus === "approved")) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}