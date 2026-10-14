import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { CalendarDays, Home, Loader2, Menu, MoreHorizontal, Search, Settings, Users, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import ProfileAvatar from "@/components/profile-avatar";
import "./main-navigation-mobile.css";

const links = [
  { href: "/", label: "Home" },
  { href: "/current-events", label: "Recent events" },
  { href: "/upcoming-events", label: "Upcoming" },
  { href: "/archive-events", label: "Archive" },
  { href: "/creator-events", label: "Creator events" },
];

const mobileMoreLinks = links.slice(2);

export default function MainNavigation() {
  const { user, logoutMutation } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const betaUser = user as (typeof user & { suspended?: boolean }) | null;
  const creatorAccessAvailable = Boolean(betaUser && !betaUser.suspended && betaUser.creatorStatus !== "rejected");
  const isActive = (href: string) => location === href;
  const isRouteActive = (href: string) =>
    location === href || (href !== "/" && location.startsWith(`${href}/`));
   const isEventsActive = isRouteActive("/current-events") || isRouteActive("/events") || isRouteActive("/media");
  const isMoreActive =
    mobileMoreLinks.some(({ href }) => isRouteActive(href)) ||
    isRouteActive("/creator/dashboard") ||
    isRouteActive("/admin/dashboard") ||
    isRouteActive("/admin/users") ||
    isRouteActive("/creator/apply") ||
     isRouteActive("/auth") || isRouteActive("/account") || isRouteActive("/creator");
  const itemClasses = (href: string) =>
    `relative inline-flex min-h-11 items-center text-xs font-bold uppercase tracking-[0.09em] transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
      isActive(href) ? "text-primary" : "text-foreground/80"
    }`;
  const closeMenu = () => {
    setMobileOpen(false);
    setMoreOpen(false);
  };

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateBreakpoint = () => {
      const isMobile = mediaQuery.matches;
      setMobileViewport(isMobile);
      if (!isMobile) {
        setMobileOpen(false);
        setMoreOpen(false);
      }
    };
    updateBreakpoint();
    mediaQuery.addEventListener("change", updateBreakpoint);
    return () => mediaQuery.removeEventListener("change", updateBreakpoint);
  }, []);

  useEffect(() => {
    const body = document.body;
    body.classList.add("vco-mobile-navigation-enabled");

    const isEditable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.matches("input, textarea, select") || target.isContentEditable);
    const updateKeyboardState = () => {
      const viewport = window.visualViewport;
      const viewportIsShort = Boolean(viewport && window.innerHeight - viewport.height > 120);
      const editableHasFocus = isEditable(document.activeElement);
      const open = mobileViewport && (viewportIsShort || editableHasFocus);
      body.classList.toggle("vco-mobile-keyboard-open", open);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isEditable(event.target)) updateKeyboardState();
    };
    const onFocusOut = () => window.setTimeout(updateKeyboardState, 80);
    const viewport = window.visualViewport;

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    viewport?.addEventListener("resize", updateKeyboardState);
    window.addEventListener("resize", updateKeyboardState);
    updateKeyboardState();

    return () => {
      body.classList.remove("vco-mobile-navigation-enabled", "vco-mobile-keyboard-open");
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      viewport?.removeEventListener("resize", updateKeyboardState);
      window.removeEventListener("resize", updateKeyboardState);
    };
  }, [mobileViewport]);

  useEffect(() => {
    setMobileOpen(false);
    setMoreOpen(false);
  }, [location]);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-md vco-main-navigation-header">
        <div className="mx-auto flex min-h-[72px] max-w-[1492px] items-center justify-between gap-2 px-5 sm:gap-4 sm:px-6 lg:px-9 vco-main-navigation-inner">
          <Link href="/" aria-label="VCO Media Database home" className="flex shrink-0 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary vco-brand-link">
            <img src="/attached_assets/VCO_2021_reg_White_Trans.png" alt="VCO" className="h-9 w-auto sm:h-12 vco-brand-mark" />
            <span className="hidden border-l border-foreground/20 pl-3 text-[11px] font-bold leading-tight tracking-[0.16em] text-foreground sm:block md:text-xs vco-brand-caption">
              MEDIA<br className="hidden sm:block" /> DATABASE
            </span>
          </Link>

          <nav aria-label="Main navigation" className="hidden items-center gap-3 2xl:flex">
            {links.map((link) => (
              <Link key={link.href} href={link.href} aria-current={isActive(link.href) ? "page" : undefined} className={itemClasses(link.href)}>
                {link.label}
                {isActive(link.href) && <span className="absolute inset-x-0 bottom-1 h-0.5 bg-primary" />}
              </Link>
            ))}
            {creatorAccessAvailable && (user?.isCreator || user?.isAdmin || user?.creatorStatus === "approved") && <Link href="/creator/dashboard" aria-current={isActive("/creator/dashboard") ? "page" : undefined} className={itemClasses("/creator/dashboard")}>Creator Studio</Link>}
            {user?.isAdmin && (
              <>
                <Link href="/admin/dashboard" className={itemClasses("/admin/dashboard")}><Settings className="mr-1.5 h-4 w-4" />Admin</Link>
                <Link href="/admin/users" className={itemClasses("/admin/users")}><Users className="mr-1.5 h-4 w-4" />Users</Link>
              </>
            )}
          </nav>

          <div className="hidden shrink-0 items-center gap-2 2xl:flex">
            {user && <ProfileAvatar username={user.username} profileImage={user.profileImage} />}
            <Button asChild className="vco-button h-11 bg-primary px-4 text-primary-foreground hover:bg-primary/90">
              <Link href="/search" aria-current={isActive("/search") ? "page" : undefined} aria-label="Search media"><Search className="mr-2 h-4 w-4" />Search media</Link>
            </Button>
            {!user ? (
              <Button variant="outline" asChild className="vco-button h-10 border-foreground/25">
                <Link href="/auth">Sign in</Link>
              </Button>
            ) : (
              <>
                {!user.isCreator && !user.isAdmin && user.creatorStatus !== "approved" && (
                  <Button variant="outline" asChild className="h-10 border-accent/60 text-accent hover:bg-accent/10 hover:text-accent">
                    <Link href="/creator/apply">Become a creator</Link>
                  </Button>
                )}
                <Button variant="ghost" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending} className="h-10">
                  {logoutMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log out"}
                </Button>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2 2xl:hidden vco-legacy-mobile-actions">
            <Button asChild size="icon" className="h-11 w-11 bg-primary text-primary-foreground" aria-label="Search media">
              <Link href="/search" aria-current={isActive("/search") ? "page" : undefined}><Search className="h-5 w-5" /></Link>
            </Button>
            {user && <ProfileAvatar username={user.username} profileImage={user.profileImage} />}
            <Button
              variant="outline"
              size="icon"
              aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMobileOpen((open) => !open)}
              className="h-11 w-11"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>

          <div className="vco-mobile-profile">
            {user && <ProfileAvatar username={user.username} profileImage={user.profileImage} />}
          </div>
        </div>

        {mobileOpen && (
          <nav id="mobile-navigation" aria-label="Mobile navigation" className="max-h-[calc(100dvh-76px)] overflow-y-auto border-t border-primary/20 bg-background px-5 py-3 2xl:hidden">
            <div className="container mx-auto grid grid-cols-2 gap-x-5 gap-y-1">
              {links.map((link) => (
                <Link key={link.href} href={link.href} onClick={closeMenu} aria-current={isActive(link.href) ? "page" : undefined} className={`${itemClasses(link.href)} border-b border-foreground/10`}>
                  {link.label}{isActive(link.href) && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                </Link>
              ))}
              {creatorAccessAvailable && (user?.isCreator || user?.isAdmin || user?.creatorStatus === "approved") && <Link href="/creator/dashboard" onClick={closeMenu} aria-current={isActive("/creator/dashboard") ? "page" : undefined} className={`${itemClasses("/creator/dashboard")} col-span-2`}>Creator Studio</Link>}
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

      <nav aria-label="Mobile quick navigation" className="vco-mobile-bottom-nav">
        <Link href="/" aria-current={isRouteActive("/") ? "page" : undefined} className={`vco-mobile-nav-item${isRouteActive("/") ? " is-active" : ""}`}>
          <Home aria-hidden="true" /><span>Home</span>
        </Link>
        <Link href="/search" aria-current={isRouteActive("/search") ? "page" : undefined} className={`vco-mobile-nav-item${isRouteActive("/search") ? " is-active" : ""}`}>
          <Search aria-hidden="true" /><span>Search</span>
        </Link>
        <Link href="/current-events" aria-current={isEventsActive ? "page" : undefined} className={`vco-mobile-nav-item${isEventsActive ? " is-active" : ""}`}>
          <CalendarDays aria-hidden="true" /><span>Events</span>
        </Link>
        <button
          ref={moreButtonRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-controls="vco-mobile-more-dialog"
          onClick={() => setMoreOpen(true)}
          className={`vco-mobile-nav-item${isMoreActive || moreOpen ? " is-active" : ""}`}
        >
          <MoreHorizontal aria-hidden="true" /><span>More</span>
        </button>
      </nav>

      <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="vco-mobile-more-overlay" />
          <Dialog.Content
            id="vco-mobile-more-dialog"
             aria-describedby={undefined}
            className="vco-mobile-more-panel"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              moreButtonRef.current?.focus();
            }}
          >
            <div className="vco-mobile-more-heading">
              <div>
                <p className="vco-mobile-more-kicker">VCO / MEDIA DATABASE</p>
                <Dialog.Title className="vco-mobile-more-title">More</Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close More menu" className="h-10 w-10">
                  <X className="h-5 w-5" />
                </Button>
              </Dialog.Close>
            </div>

            <nav aria-label="More navigation" className="vco-mobile-more-links">
              {mobileMoreLinks.map((link) => (
                <Link key={link.href} href={link.href} onClick={closeMenu} aria-current={isRouteActive(link.href) ? "page" : undefined} className="vco-mobile-more-link">
                  <span>{link.label}</span>{isRouteActive(link.href) && <span className="vco-mobile-current-mark">CURRENT</span>}
                </Link>
              ))}
              {creatorAccessAvailable && (user?.isCreator || user?.isAdmin || user?.creatorStatus === "approved") && (
                <Link href="/creator/dashboard" onClick={closeMenu} aria-current={isRouteActive("/creator/dashboard") ? "page" : undefined} className="vco-mobile-more-link">
                  <span>Creator Studio</span>{isRouteActive("/creator/dashboard") && <span className="vco-mobile-current-mark">CURRENT</span>}
                </Link>
              )}
              {user?.isAdmin && (
                <>
                  <Link href="/admin/dashboard" onClick={closeMenu} aria-current={isRouteActive("/admin/dashboard") ? "page" : undefined} className="vco-mobile-more-link">
                    <span><Settings aria-hidden="true" />Admin dashboard</span>{isRouteActive("/admin/dashboard") && <span className="vco-mobile-current-mark">CURRENT</span>}
                  </Link>
                  <Link href="/admin/users" onClick={closeMenu} aria-current={isRouteActive("/admin/users") ? "page" : undefined} className="vco-mobile-more-link">
                    <span><Users aria-hidden="true" />User management</span>{isRouteActive("/admin/users") && <span className="vco-mobile-current-mark">CURRENT</span>}
                  </Link>
                </>
              )}
            </nav>

            <div className="vco-mobile-account-actions">
               {user && <Button asChild variant="outline" onClick={closeMenu}><Link href="/account">My account</Link></Button>}
              {!user && <Button asChild variant="outline" onClick={closeMenu}><Link href="/auth">Sign in / Register</Link></Button>}
              {user && !user.isCreator && !user.isAdmin && user.creatorStatus !== "approved" && <Button asChild variant="outline" onClick={closeMenu}><Link href="/creator/apply">Become a creator</Link></Button>}
              {user && <Button variant="ghost" onClick={() => { closeMenu(); logoutMutation.mutate(); }} disabled={logoutMutation.isPending}>{logoutMutation.isPending ? "Signing out…" : "Log out"}</Button>}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
