import { useQuery } from "@tanstack/react-query";
import { type Event, type MediaItem } from "@shared/schema";
import { useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight, CalendarDays, Clock3, Download, History,
  Eye, PlayCircle, Search, Star, Trophy,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import EventCard from "@/components/event-card";
import Footer from "@/components/footer";
import MainNavigation from "@/components/main-navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { downloadMedia, downloadOptionLabel } from "@/lib/media-download";
import EventTitle from "@/components/event-title";
import { formatDate } from "@/lib/utils";

export default function HomePage() {
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const previewOpener = useRef<HTMLButtonElement | null>(null);
  const { user } = useAuth();
  const { data: events = [], isLoading: eventsLoading, error: eventsError, refetch, isFetching } = useQuery<Event[]>({
    queryKey: ["/api/events"],
    retry: 3,
  });
  const { data: topShots = [], isLoading: topShotsLoading } = useQuery<MediaItem[]>({ queryKey: ["/api/media/top-shots"] });
  const { data: creatorTopMedia = [], isLoading: creatorMediaLoading } = useQuery<MediaItem[]>({
    queryKey: ["/api/media/creator-top"],
    enabled: !topShotsLoading,
  });

  const today = new Date();
  const recentBoundary = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000);
  const datedEvents = events.filter((event) => Number.isFinite(new Date(event.date).getTime()));
  const recentEvents = datedEvents
    .filter((event) => new Date(event.date) >= recentBoundary && new Date(event.date) <= today)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const officialRecent = recentEvents.filter((event) => !event.creatorId).slice(0, 4);
  const creatorRecent = recentEvents.filter((event) => event.creatorId).slice(0, 4);
  const upcomingEvents = datedEvents
    .filter((event) => new Date(event.date) > today)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 3);
  const archiveEvents = datedEvents
    .filter((event) => new Date(event.date) < recentBoundary)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 4);

  const handleDownload = async (item: MediaItem, quality: "high" | "low") => {
    try {
      await downloadMedia(item, quality);
    } catch (error) {
      console.error("Download failed:", error);
      window.alert(error instanceof Error ? error.message : "Unable to download this media item.");
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <MainNavigation />
      <main>
        <section className="relative isolate overflow-hidden border-b border-primary/20">
          <div className="absolute inset-0 -z-20">
            <img src="/attached_assets/IMG_7464.png" alt="" className="h-full w-full object-cover object-center" />
          </div>
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-background via-background/90 to-background/45" />
          <div className="mx-auto flex min-h-[390px] w-full max-w-[1492px] items-center px-4 py-12 sm:px-6 md:min-h-[440px] md:py-14 lg:px-9">
            <div className="max-w-3xl">
              <p className="vco-kicker mb-4">
                VCO Media Database
              </p>
              <h1 className="max-w-2xl text-[clamp(3.2rem,8vw,7.25rem)] font-extrabold uppercase leading-[0.82] tracking-[-0.035em] text-foreground">
                Every race.<br /><span className="text-primary">Every frame.</span>
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-foreground/85 sm:text-lg">
                Find the moment you remember. Browse event galleries and creator coverage from the VCO racing world.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild className="vco-button min-h-12 bg-primary px-5 text-primary-foreground hover:bg-primary/90">
                  <Link href="/search"><Search className="mr-2 h-4 w-4" />Search media<ArrowRight className="ml-3 h-4 w-4" /></Link>
                </Button>
                <Button asChild variant="outline" className="min-h-12 border-foreground/40 bg-background/60 px-5 hover:bg-background/90">
                  <Link href="/current-events">Browse recent events</Link>
                </Button>
              </div>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 h-1 w-1/3 bg-primary" />
          <div className="absolute bottom-0 left-1/3 h-1 w-1/6 bg-accent" />
        </section>

        <div className="container mx-auto space-y-14 px-4 py-10 sm:py-14">
          <section aria-labelledby="recent-heading">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-primary">Fresh from the track</p>
                <h2 id="recent-heading" className="flex items-center gap-3 text-2xl font-bold tracking-wide sm:text-3xl"><Trophy className="h-6 w-6 text-primary" />Recent events</h2>
              </div>
              <Button asChild variant="ghost" className="text-foreground/80 hover:text-primary"><Link href="/current-events">All recent events<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
            </div>
            {eventsLoading ? (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="overflow-hidden rounded-lg border border-foreground/10 bg-card/60"><div className="aspect-[16/10] animate-pulse bg-foreground/10" /><div className="space-y-3 p-5"><div className="h-5 w-3/4 animate-pulse rounded bg-foreground/10" /><div className="h-4 w-1/2 animate-pulse rounded bg-foreground/10" /></div></div>)}</div>
            ) : eventsError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-5 py-8 text-center">
                <p className="font-semibold">Recent events are temporarily unavailable.</p>
                <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="mt-4">{isFetching ? "Retrying…" : "Try again"}</Button>
              </div>
            ) : officialRecent.length ? (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">{officialRecent.map((event) => <EventCard key={event.id} event={event} />)}</div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-foreground/15 bg-card/50 p-6">
                <div><h3 className="font-bold">No recent event galleries</h3><p className="mt-1 text-sm text-foreground/75">Explore the full archive or see what is coming up.</p></div>
                <Button asChild variant="outline"><Link href="/archive-events">Browse archive<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              </div>
            )}
          </section>

          {creatorRecent.length > 0 && (
            <section aria-labelledby="creator-heading" className="border-t border-foreground/10 pt-9">
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-accent">From the community</p>
                  <h2 id="creator-heading" className="flex items-center gap-3 text-2xl font-bold tracking-wide sm:text-3xl"><UserRound className="h-6 w-6 text-accent" />Creator events</h2>
                </div>
                <Button asChild variant="ghost" className="text-foreground/80 hover:text-accent"><Link href="/creator-events">All creator events<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">{creatorRecent.map((event) => <EventCard key={event.id} event={event} />)}</div>
            </section>
          )}

          <section aria-labelledby="upcoming-heading" className="grid gap-8 border-y border-foreground/15 py-9 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-accent">Mark the date</p>
              <h2 id="upcoming-heading" className="flex items-center gap-3 text-2xl font-bold tracking-wide sm:text-3xl"><Clock3 className="h-6 w-6 text-accent" />Coming up</h2>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-foreground/75">The next race weekends on the calendar. Calendar information only — these listings do not open galleries.</p>
              <Button asChild variant="outline" className="mt-5 border-foreground/30"><Link href="/upcoming-events">Full calendar<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
            </div>
            {eventsLoading ? (
              <div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-[76px] animate-pulse rounded-md bg-card/70" />)}</div>
            ) : upcomingEvents.length ? (
              <ol className="divide-y divide-foreground/10 border-y border-foreground/10">
                {upcomingEvents.map((event) => {
                  const date = new Date(event.date);
                  return <li key={event.id} className="flex items-center gap-4 py-4">
                    <div className="min-w-0 border-l-2 border-accent pl-4"><p className="truncate font-bold"><EventTitle title={event.title} /></p><p className="mt-1 text-sm text-foreground/70"><time dateTime={date.toISOString()}>{formatDate(date)}</time></p></div>
                  </li>;
                })}
              </ol>
            ) : (
              <div className="flex min-h-36 items-center rounded-md border border-foreground/10 bg-card/40 px-5 text-sm text-foreground/75">No future event dates currently listed.</div>
            )}
          </section>

          {topShots.length > 0 && (
            <section aria-labelledby="top-shots-heading">
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-primary">Worth another look</p>
                  <h2 id="top-shots-heading" className="flex items-center gap-3 text-2xl font-bold tracking-wide sm:text-3xl"><Star className="h-6 w-6 text-primary" />Top shots</h2>
                </div>
                <Button asChild variant="ghost"><Link href="/search">Explore all media<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              </div>
              {topShotsLoading ? <div className="grid grid-cols-1 gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-72 animate-pulse rounded-md bg-card/70" />)}</div> : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {topShots.slice(0, 3).map((shot) => <button key={shot.id} type="button" onClick={(event) => { previewOpener.current = event.currentTarget; setSelectedMedia(shot); }} aria-label={`Preview ${shot.type === "video" ? "video" : "photo"}: ${shot.caption || `Media ${shot.id}`}`} className="group flex min-w-0 flex-col overflow-hidden rounded-md border border-foreground/15 bg-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <span className="relative flex h-60 w-full items-center justify-center bg-background sm:h-72 md:h-64 lg:h-72">
                      <img src={shot.thumbnail} alt="" className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.025] motion-reduce:transform-none" loading="lazy" />
                      {shot.type === "video" && <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded bg-black/85 px-2 py-1 text-xs font-semibold text-white"><PlayCircle className="h-4 w-4" /> Video</span>}
                    </span>
                      <span className="flex w-full items-center justify-between gap-3 p-4">
                       <span className="line-clamp-2 min-w-0 text-sm font-semibold">{shot.caption || (shot.type === "video" ? "Featured video" : "Featured photo")}</span>
                       <span className="shrink-0 text-xs font-semibold text-foreground/70">{shot.downloadCount} downloads</span>
                    </span>
                     <span className="flex w-full items-center gap-2 border-t border-foreground/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-primary"><Eye className="h-3.5 w-3.5" />Preview {shot.type === "video" ? "video" : "photo"}</span>
                  </button>)}
                </div>
              )}
            </section>
          )}

          {creatorTopMedia.length > 0 && !creatorMediaLoading && (
            <section aria-labelledby="creator-media-heading" className="border-t border-foreground/10 pt-9">
              <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-accent">Creator spotlight</p><h2 id="creator-media-heading" className="text-2xl font-bold tracking-wide sm:text-3xl">Popular creator media</h2></div>
                <Button asChild variant="ghost"><Link href="/creator-events">Browse creator events<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {creatorTopMedia.slice(0, 3).map((item) => <button key={item.id} type="button" onClick={(event) => { previewOpener.current = event.currentTarget; setSelectedMedia(item); }} aria-label={`Preview ${item.type === "video" ? "video" : "photo"}: ${item.caption || `Media ${item.id}`}`} className="group relative aspect-video overflow-hidden border border-accent/25 bg-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  <img src={item.thumbnail} alt={item.caption || "Creator racing media"} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.035] motion-reduce:transform-none" loading="lazy" />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                  <span className="absolute bottom-0 left-0 right-0 p-4">
                    <span className="line-clamp-2 block text-sm font-semibold text-white">{item.caption || "Creator media"}</span>
                     <span className="mt-2 flex items-center justify-between gap-2 text-xs text-white/85"><span>{item.photographer ? `By ${item.photographer}` : "Creator spotlight"}</span><span className="text-accent">{item.downloadCount} downloads</span></span>
                  </span>
                   <span className="absolute left-3 top-3 flex items-center gap-1.5 bg-background/90 px-2.5 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-accent"><Eye className="h-3.5 w-3.5" />Preview {item.type === "video" ? "video" : "photo"}</span>
                </button>)}
              </div>
            </section>
          )}

          <section aria-labelledby="archive-heading" className="border-t border-foreground/10 pt-9">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div><p className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-foreground/65">From the vault</p><h2 id="archive-heading" className="flex items-center gap-3 text-2xl font-bold tracking-wide sm:text-3xl"><History className="h-6 w-6 text-foreground/70" />Archive</h2></div>
              <Button asChild variant="ghost"><Link href="/archive-events">All archived events<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
            </div>
            {archiveEvents.length > 0 ? (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">{archiveEvents.map((event) => <EventCard key={event.id} event={event} />)}</div>
            ) : (
              <p className="border-l-2 border-foreground/25 py-2 pl-4 text-sm text-foreground/70">Older event galleries will collect here as the season goes on.</p>
            )}
          </section>
        </div>
      </main>

      <Dialog open={!!selectedMedia} onOpenChange={(open) => !open && setSelectedMedia(null)}>
        <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); previewOpener.current?.focus(); }} className="w-[calc(100%-1rem)] max-w-4xl max-h-[95dvh] overflow-y-auto border-foreground/15 bg-background">
          {selectedMedia && <div className="space-y-4">
             <DialogTitle>Media preview</DialogTitle>
            <div className="relative flex min-h-40 items-center justify-center bg-black/30">
              {selectedMedia.type === "video" && user && selectedMedia.url
                ? <video key={selectedMedia.id} src={selectedMedia.url} poster={selectedMedia.thumbnail} controls preload="none" className="max-h-[65dvh] max-w-full" />
                : <img src={selectedMedia.thumbnail || selectedMedia.url} alt={selectedMedia.caption || "Media preview"} className="max-h-[65dvh] max-w-full object-contain" />}
            </div>
            {selectedMedia.type === "video" && !user && <p className="text-sm text-foreground/75">Sign in to play this video. Its poster is shown above.</p>}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>{selectedMedia.photographer && <p className="text-sm text-foreground/70">Photographer: {selectedMedia.photographer}</p>}{selectedMedia.caption && <p className="mt-1 text-sm">{selectedMedia.caption}</p>}</div>
              <DropdownMenu>
                 <DropdownMenuTrigger asChild><Button variant="outline"><Download className="mr-2 h-4 w-4" />Download options</Button></DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => handleDownload(selectedMedia, "high")}>{downloadOptionLabel(selectedMedia, "high")}{!user && " · Sign in required"}</DropdownMenuItem>
                  {selectedMedia.type === "image" && <DropdownMenuItem onSelect={() => handleDownload(selectedMedia, "low")}>{downloadOptionLabel(selectedMedia, "low")}</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {selectedMedia.tags?.length ? <div className="flex flex-wrap gap-2">{selectedMedia.tags.map((tag) => <span key={tag} className="border border-border bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">{tag}</span>)}</div> : null}
          </div>}
        </DialogContent>
      </Dialog>
      <Footer />
    </div>
  );
}