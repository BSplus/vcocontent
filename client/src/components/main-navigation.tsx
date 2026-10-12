import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Loader2, Menu, Search, Settings, Users, X, CircleUserRound } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const links = [
  { href: "/", label: "Home" },
  { href: "/current-events", label: "Recent events" },
  { href: "/upcoming-events", label: "Upcoming" },
  { href: "/archive-events", label: "Archive" },
  { href: "/creator-events", label: "Creator events" },
];

export default function MainNavigation() {
  const { user, logoutMutation } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const betaUser = user as (typeof user & { suspended?: boolean }) | null;
  const creatorAccessAvailable = Boolean(betaUser && !betaUser.suspended && betaUser.creatorStatus !== "rejected");
  const isActive = (href: string) => location === href;
  const itemClasses = (href: string) =>
    `relative inline-flex min-h-11 items-center text-xs font-bold uppercase tracking-[0.09em] transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
      isActive(href) ? "text-primary" : "text-foreground/80"
    }`;
  const closeMenu = () => setMobileOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex min-h-[72px] max-w-[1492px] items-center justify-between gap-4 px-5 sm:px-6 lg:px-9">
        <Link href="/" aria-label="VCO Media Database home" className="flex shrink-0 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <img src="/attached_assets/VCO_2021_reg_White_Trans.png" alt="VCO" className="h-10 w-auto sm:h-12" />
          <span className="hidden border-l border-foreground/20 pl-3 text-[11px] font-bold leading-tight tracking-[0.16em] text-foreground sm:block md:text-xs">
            MEDIA<br className="hidden sm:block" /> DATABASE
          </span>
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-3 2xl:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} aria-current={location === link.href ? "page" : undefined} className={itemClasses(link.href)}>
              {link.label}
              {location === link.href && <span className="absolute inset-x-0 bottom-1 h-0.5 bg-primary" />}
            </Link>
          ))}
          {creatorAccessAvailable && (user?.isCreator || user?.isAdmin || user?.creatorStatus === "approved") && <Link href="/creator/dashboard" aria-current={isActive("/creator/dashboard") ? "page" : undefined} className={itemClasses("/creator/dashboard")}>Creator Studio</Link>}
          {user && <Link href="/account" className={itemClasses("/account")}><CircleUserRound className="mr-1.5 h-4 w-4" />My account</Link>}
          {user?.isAdmin && (
            <>
              <Link href="/admin/dashboard" className={itemClasses("/admin/dashboard")}><Settings className="mr-1.5 h-4 w-4" />Admin</Link>
              <Link href="/admin/users" className={itemClasses("/admin/users")}><Users className="mr-1.5 h-4 w-4" />Users</Link>
            </>
          )}
        </nav>

        <div className="hidden shrink-0 items-center gap-2 2xl:flex">
          <Button asChild className="vco-button h-10 bg-primary px-4 text-primary-foreground hover:bg-primary/90">
            <Link href="/search" aria-current={location === "/search" ? "page" : undefined} aria-label="Search media"><Search className="mr-2 h-4 w-4" />Search media</Link>
          </Button>
          {!user ? (
            <Button variant="outline" asChild className="vco-button h-10 border-foreground/25">
              <Link href="/auth">Sign in</Link>
            </Button>
          ) : (
            <>
              {!user.isCreator && !user.isAdmin && user.creatorStatus !== "approved" && (
                <Button variant="outline" asChild className="h-10 border-accent/60 text-accent hover:bg-accent/10">
                  <Link href="/creator/apply">Become a creator</Link>
                </Button>
              )}
              <Button variant="ghost" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending} className="h-10">
                {logoutMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log out"}
              </Button>
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 2xl:hidden">
          <Button asChild size="icon" className="h-10 w-10 bg-primary text-primary-foreground" aria-label="Search media">
            <Link href="/search" aria-current={location === "/search" ? "page" : undefined}><Search className="h-5 w-5" /></Link>
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileOpen((open) => !open)}
            className="h-10 w-10"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileOpen && (
        <nav id="mobile-navigation" aria-label="Mobile navigation" className="max-h-[calc(100dvh-76px)] overflow-y-auto border-t border-primary/20 bg-background px-5 py-3 2xl:hidden">
          <div className="container mx-auto grid grid-cols-2 gap-x-5 gap-y-1">
            {links.map((link) => (
              <Link key={link.href} href={link.href} onClick={closeMenu} aria-current={location === link.href ? "page" : undefined} className={`${itemClasses(link.href)} border-b border-foreground/10`}>
                {link.label}{location === link.href && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
              </Link>
            ))}
            {creatorAccessAvailable && (user?.isCreator || user?.isAdmin || user?.creatorStatus === "approved") && <Link href="/creator/dashboard" onClick={closeMenu} aria-current={isActive("/creator/dashboard") ? "page" : undefined} className={`${itemClasses("/creator/dashboard")} col-span-2`}>Creator Studio</Link>}
            {user && <Link href="/account" onClick={closeMenu} className={`${itemClasses("/account")} col-span-2`}><CircleUserRound className="mr-2 h-4 w-4" />My account</Link>}
            {user?.isAdmin && (
              <>
                <Link href="/admin/dashboard" onClick={closeMenu} className={`${itemClasses("/admin/dashboard")} col-span-2`}><Settings className="mr-2 h-4 w-4" />Admin dashboard</Link>
                <Link href="/admin/users" onClick={closeMenu} className={`${itemClasses("/admin/users")} col-span-2`}><Users className="mr-2 h-4 w-4" />User management</Link>
              </>
            )}
            <div className="col-span-2 flex flex-wrap gap-2 pt-3">
              {!user && <Button asChild variant="outline" onClick={closeMenu}><Link href="/auth">Sign in / Register</Link></Button>}
              {user && !user.isCreator && !user.isAdmin && user.creatorStatus !== "approved" && <Button asChild variant="outline" onClick={closeMenu}><Link href="/creator/apply">Become a creator</Link></Button>}
              {user && <Button variant="ghost" onClick={() => { closeMenu(); logoutMutation.mutate(); }} disabled={logoutMutation.isPending}>{logoutMutation.isPending ? "Signing out…" : "Log out"}</Button>}
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}