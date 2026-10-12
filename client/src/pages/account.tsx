import { useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Download, ArrowUpRight, ChevronLeft, ChevronRight, CircleUserRound, Image as ImageIcon, Users, UserRound } from "lucide-react";
import MainNavigation from "@/components/main-navigation";
import Footer from "@/components/footer";
import CommunityActions from "@/components/community-actions";
import ProfileSettings from "@/components/profile-settings";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { formatDate } from "@/lib/utils";
import CreatorIdentity, { type PublicCreator } from "@/components/creator-identity";
import type { PageEnvelope } from "@shared/pagination";
import PageStatus from "@/components/page-status";
import { usePageState } from "@/hooks/use-page-state";

type FavoriteItem = { kind: "media" | "event"; id: number; title: string; thumbnail: string | null; eventTitle: string; href: string; date: string };
type DownloadItem = { historyId: number; id: number; title: string; thumbnail: string | null; eventTitle: string; href: string; date: string; quality: string };
type AccountTab = "downloads" | "favorites" | "following" | "settings";

function PanelSkeleton() {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading account content">
    {[0, 1, 2].map(key => <div key={key} className="animate-pulse overflow-hidden rounded-sm border border-border bg-card">
      <div className="aspect-[4/3] bg-secondary" /><div className="space-y-3 p-4"><div className="h-4 w-2/3 bg-secondary" /><div className="h-3 w-1/2 bg-secondary" /></div>
    </div>)}
  </div>;
}

export default function AccountPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const search = useSearch();
  const active = (new URLSearchParams(search).get("tab") || "downloads") as AccountTab;
  const tab = (["downloads", "favorites", "following", "settings"].includes(active) ? active : "downloads") as AccountTab;
  const [page, setPage] = usePageState(`${user?.id}:${tab}`);
  const endpoint = tab === "favorites" ? "favorites" : "downloads";
  const queryKey = [`/api/account/${endpoint}?page=${page}`, user?.id ?? "signed-out"];
  const { data, isLoading, isFetching, isError, refetch } = useQuery<PageEnvelope<FavoriteItem | DownloadItem>>({
    queryKey,
    enabled: !!user && tab !== "settings" && tab !== "following",
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const followingQuery = useQuery<PageEnvelope<PublicCreator>>({
    queryKey: ["/api/account/following", user?.id ?? "signed-out", page],
    queryFn: async () => {
      const response=await fetch(`/api/account/following?page=${page}`,{credentials:"include"});
      if(!response.ok) throw new Error("Your followed creators could not be loaded.");
      return response.json();
    },
    enabled: !!user && tab === "following",
    staleTime: 0,
    retry: false,
  });
  const confirmedData = tab === "following" ? followingQuery.data : data;
  const busy = tab === "following" ? followingQuery.isFetching : isFetching;
  const failed = tab === "following" ? followingQuery.isError : isError;
  useEffect(() => {
    if (!busy && !failed && confirmedData) setPage(confirmedData.page);
  }, [confirmedData, busy, failed, setPage]);
  const changeTab = (next: AccountTab) => {
    setPage(1);
    setLocation(`/account?tab=${next}`);
  };
  const invalidateFavorites = () => {
    void queryClient.invalidateQueries({ queryKey: [`/api/account/favorites?page=${page}`, user?.id ?? "signed-out"] });
  };

  return <div className="min-h-[100dvh] bg-background">
    <MainNavigation />
    <main className="mx-auto max-w-[1492px] px-5 py-8 sm:px-7 lg:px-10 lg:py-12">
      <header className="mb-8 border-b border-border pb-7">
        <p className="vco-kicker">Your VCO archive</p>
        <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><h1 className="text-4xl sm:text-5xl">My account</h1><p className="mt-3 max-w-xl text-foreground/70">Your saved moments, completed file deliveries and profile settings in one place.</p></div>
          <p className="text-sm text-muted-foreground">Signed in as <span className="font-semibold text-foreground">{user?.username}</span></p>
        </div>
      </header>
      <nav aria-label="Account sections" className="mb-8 flex flex-wrap gap-2 border-b border-border pb-3">
        {([
          ["downloads", "My Downloads", Download],
          ["favorites", "My Favorites", Bookmark],
          ["following", "Following", Users],
          ["settings", "Settings", CircleUserRound],
        ] as const).map(([value, label, Icon]) => <button key={value} type="button" onClick={() => changeTab(value)} aria-current={tab === value ? "page" : undefined}
          className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-bold uppercase tracking-wider transition-colors ${tab === value ? "border-primary text-primary" : "border-transparent text-foreground/65 hover:text-foreground"}`}>
          <Icon className="h-4 w-4" />{label}
        </button>)}
      </nav>

      {tab === "following" ? <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="vco-kicker">The photographers you follow</p><h2 className="mt-2 text-2xl">Following</h2></div><PageStatus page={followingQuery.data?.page ?? page} totalPages={!busy && !failed ? followingQuery.data?.totalPages : undefined} /></div>
        {followingQuery.isLoading ? <PanelSkeleton /> : followingQuery.isError ? <div role="alert" className="border border-destructive/40 bg-card px-5 py-8 text-center"><p className="text-lg">Your following list is temporarily unavailable.</p><Button variant="outline" className="mt-4" onClick={() => void followingQuery.refetch()}>Try again</Button></div> : !followingQuery.data?.items.length ? <div className="border border-dashed border-border bg-card/50 px-6 py-14 text-center">
          <Users className="mx-auto h-8 w-8 text-primary" /><h3 className="mt-4 text-xl">Your circuit starts here</h3><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Follow a photographer to keep their public galleries close at hand.</p>
          <Button asChild className="vco-button mt-5 min-h-11 bg-primary text-primary-foreground"><Link href="/creator-events">Discover creator galleries</Link></Button>
        </div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {followingQuery.data.items.map(creator => <article key={creator.id} className="flex min-h-32 items-center gap-4 border border-border bg-card p-5">
            <Link href={`/creator/${creator.id}`} aria-label={`View ${creator.displayName || creator.username}'s profile`} className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/30 bg-primary/10 text-primary">
              {creator.profileImage ? <img src={creator.profileImage} alt="" className="h-full w-full object-cover" /> : <UserRound className="h-7 w-7" />}
            </Link>
            <div className="min-w-0 flex-1"><CreatorIdentity creator={creator} className="text-lg font-bold" /><p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{creator.bio || "VCO creator"}</p><p className="mt-2 text-xs text-muted-foreground">{creator.followerCount ?? 0} followers</p></div>
          </article>)}
        </div>}
        {!followingQuery.isLoading && !followingQuery.isError && followingQuery.data?.items.length ? <nav aria-label="Following pages" className="mt-7 flex flex-wrap gap-2 items-center justify-between border-t border-border pt-4">
          <Button variant="outline" className="min-h-11" disabled={busy || followingQuery.data.page === 1} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
          <PageStatus page={followingQuery.data.page} totalPages={!busy ? followingQuery.data.totalPages : undefined} />
          <Button variant="outline" className="min-h-11" disabled={busy || !followingQuery.data?.hasMore} onClick={() => setPage(value => value + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
        </nav> : null}
      </section> : tab === "settings" ? <section className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <div className="space-y-6">
          {user && <ProfileSettings user={user} />}
          <div className="border border-border bg-card p-5 sm:p-7">
            <p className="vco-kicker">Account details</p><h2 className="mt-3 text-2xl">Sign-in information</h2>
            <dl className="mt-4 divide-y divide-border">
              <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-muted-foreground">Email</dt><dd className="break-all font-semibold">{user?.email || "Not available"}</dd></div>
              <div className="flex flex-wrap justify-between gap-2 py-3"><dt className="text-muted-foreground">Email status</dt><dd className="font-semibold">{user?.emailVerifiedAt ? "Verified" : "Verification pending"}</dd></div>
            </dl>
          </div>
        </div>
        <aside className="border border-primary/25 bg-primary/[0.04] p-5 sm:p-7">
          <p className="vco-kicker">Preferences & help</p><h2 className="mt-3 text-2xl">Keep your account in good standing.</h2>
          <p className="mt-4 leading-relaxed text-foreground/75">Profile changes are checked automatically before saving. Once the check passes, changes are saved immediately and public details are visible without administrator approval. If the check cannot approve your changes, your saved profile stays unchanged; adjust your entries and try saving again. Creator accounts can also add an optional display name, cover and explicitly public contact details. Profile photo and cover are checked independently. Private account email remains private.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild variant="outline" className="min-h-11"><Link href="/privacy-policy">Privacy policy</Link></Button>
            <Button asChild variant="outline" className="min-h-11"><Link href="/credits">Credits & beta information</Link></Button>
          </div>
        </aside>
      </section> : <>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="vco-kicker">{tab === "favorites" ? "Kept close" : "Your recent deliveries"}</p><h2 className="mt-2 text-2xl">{tab === "favorites" ? "My Favorites" : "My Downloads"}</h2></div><PageStatus page={data?.page ?? page} totalPages={!busy && !failed ? data?.totalPages : undefined} /></div>
        {isLoading ? <PanelSkeleton /> : isError ? <div role="alert" className="border border-destructive/40 bg-card px-5 py-8 text-center"><p className="text-lg">This account list is temporarily unavailable.</p><Button variant="outline" className="mt-4" onClick={() => void refetch()}>Try again</Button></div> : !data?.items.length ? <div className="border border-dashed border-border bg-card/50 px-6 py-14 text-center">
          {tab === "favorites" ? <Bookmark className="mx-auto h-8 w-8 text-primary" /> : <Download className="mx-auto h-8 w-8 text-primary" />}
          <h3 className="mt-4 text-xl">{tab === "favorites" ? "Nothing saved just yet" : "No completed downloads yet"}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{tab === "favorites" ? "Save photos or galleries as you explore. They will be gathered here for you." : "Downloads appear here after the file delivery has completed."}</p>
          <Button asChild className="vco-button mt-5 min-h-11 bg-primary text-primary-foreground"><Link href="/">Explore the archive</Link></Button>
        </div> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map(item => {
            const thumb = item.thumbnail;
            const isFavorite = tab === "favorites";
            const favorite = item as FavoriteItem;
            const downloaded = item as DownloadItem;
            return <article key={isFavorite ? `${favorite.kind}-${favorite.id}` : downloaded.historyId} className="group overflow-hidden border border-border bg-card transition-transform hover:-translate-y-0.5">
              <Link href={item.href} className="relative block aspect-[4/3] overflow-hidden bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]" /> : <div className="flex h-full items-center justify-center text-primary/60"><ImageIcon className="h-10 w-10" /></div>}
                <span className="absolute bottom-3 left-3 rounded-sm bg-background/90 px-2.5 py-1 text-xs font-bold uppercase tracking-wider">{isFavorite ? favorite.kind : downloaded.quality}</span>
              </Link>
              <div className="p-4">
                <p className="line-clamp-2 min-h-10 text-lg font-semibold leading-tight">{item.title}</p>
                <p className="mt-2 truncate text-sm text-foreground/70">{item.eventTitle}</p>
                <p className="mt-1 text-xs text-muted-foreground"><time dateTime={item.date}>{formatDate(item.date)}</time></p>
                <div className="mt-4 flex min-h-11 items-center justify-between gap-2 border-t border-border pt-3">
                  <Link href={item.href} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary underline underline-offset-4">Open original <ArrowUpRight className="h-4 w-4" /></Link>
                  {isFavorite && <CommunityActions kind={favorite.kind} id={favorite.id} title={favorite.title} compact onFavoriteChange={invalidateFavorites} />}
                </div>
              </div>
            </article>;
          })}
        </div>}
        {!isLoading && !isError && data?.items.length ? <nav aria-label={`${tab} pages`} className="mt-7 flex flex-wrap gap-2 items-center justify-between border-t border-border pt-4">
          <Button variant="outline" className="min-h-11" disabled={busy || data.page === 1} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
          <PageStatus page={data.page} totalPages={!busy ? data.totalPages : undefined} />
          <Button variant="outline" className="min-h-11" disabled={busy || !data?.hasMore} onClick={() => setPage(value => value + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
        </nav> : null}
      </>}
    </main>
    <Footer />
  </div>;
}
