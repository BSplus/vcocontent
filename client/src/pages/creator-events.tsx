import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Event } from "@shared/schema";
import EventCard from "@/components/event-card";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, CalendarDays, CalendarSearch, Search, X } from "lucide-react";
import MainNavigation from "@/components/main-navigation";
import Footer from "@/components/footer";

export default function CreatorEventsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const { data: allEvents = [], isLoading, error, refetch, isFetching } = useQuery<Event[]>({ queryKey: ["/api/events"] });
  const filteredEvents = useMemo(() => {
    const creatorEvents = allEvents.filter((event) => Boolean(event.creatorId));
    const query = searchQuery.trim().toLocaleLowerCase();
    return query ? creatorEvents.filter((event) =>
      `${event.title ?? ""} ${event.description ?? ""}`.toLocaleLowerCase().includes(query)
    ) : creatorEvents;
  }, [allEvents, searchQuery]);
  const now = new Date();
  const currentEvents = filteredEvents
    .filter((event) => event.date && new Date(event.date) <= now)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const upcomingEvents = filteredEvents
    .filter((event) => event.date && new Date(event.date) > now)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="min-h-[100dvh] bg-background">
      <MainNavigation />
      <main className="container mx-auto px-4 pb-16 pt-9 sm:pt-12">
        <Link href="/" className="mb-8 inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-semibold text-foreground/75 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <ArrowLeft className="h-4 w-4" />Back to home
        </Link>
        <div className="mb-7 flex flex-wrap items-end justify-between gap-5 border-b border-foreground/15 pb-6">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-accent">Independent perspectives</p>
            <div className="flex items-center gap-3">
              <CalendarDays className="h-7 w-7 text-accent" aria-hidden="true" />
              <h1 className="text-3xl font-bold tracking-wide text-foreground sm:text-4xl">Creator events</h1>
            </div>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-foreground/75">Find race weekends covered by the VCO creator community.</p>
        </div>

        <div className="mb-9 flex max-w-2xl items-center gap-2 rounded-md border border-foreground/20 bg-card/70 p-2 focus-within:border-primary/75 focus-within:ring-2 focus-within:ring-primary/25">
          <Search className="ml-2 h-5 w-5 shrink-0 text-foreground/60" aria-hidden="true" />
          <Input
            aria-label="Search creator events"
            placeholder="Search by event or description"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="h-11 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          {searchQuery && <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="Clear search" onClick={() => setSearchQuery("")}><X className="h-4 w-4" /></Button>}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="overflow-hidden rounded-lg border border-foreground/10 bg-card/60"><div className="aspect-[16/10] animate-pulse bg-foreground/10" /><div className="space-y-3 p-5"><div className="h-5 w-3/4 animate-pulse rounded bg-foreground/10" /><div className="h-4 w-1/2 animate-pulse rounded bg-foreground/10" /></div></div>)}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-12 text-center">
            <h2 className="text-xl font-bold">Creator events could not be loaded</h2>
            <p className="mt-2 text-sm text-foreground/75">Please try again in a moment.</p>
            <Button onClick={() => refetch()} disabled={isFetching} className="mt-5">{isFetching ? "Retrying…" : "Try again"}</Button>
          </div>
        ) : currentEvents.length || upcomingEvents.length ? (
          <>
            {upcomingEvents.length > 0 && (
              <section aria-labelledby="creator-upcoming" className="mb-12">
                <div className="mb-5 flex items-center gap-3">
                  <CalendarSearch className="h-5 w-5 text-accent" />
                  <h2 id="creator-upcoming" className="text-xl font-bold tracking-wide text-accent sm:text-2xl">Upcoming</h2>
                  <span className="text-sm text-foreground/60">{upcomingEvents.length}</span>
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {upcomingEvents.map((event) => <EventCard key={event.id} event={event} />)}
                </div>
              </section>
            )}
            {currentEvents.length > 0 && (
              <section aria-labelledby="creator-current">
                <div className="mb-5 flex items-center gap-3">
                  <CalendarDays className="h-5 w-5 text-primary" />
                  <h2 id="creator-current" className="text-xl font-bold tracking-wide sm:text-2xl">Recent &amp; past</h2>
                  <span className="text-sm text-foreground/60">{currentEvents.length}</span>
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {currentEvents.map((event) => <EventCard key={event.id} event={event} />)}
                </div>
              </section>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-foreground/15 bg-card/50 px-6 py-14 text-center">
            <CalendarDays className="mx-auto h-8 w-8 text-accent" />
            <h2 className="mt-4 text-xl font-bold">{searchQuery ? "No creator events match that search" : "No creator events yet"}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-foreground/75">{searchQuery ? "Try another event name or clear your search." : "Creator event coverage will appear here as it is published."}</p>
            {searchQuery ? (
              <Button variant="outline" className="mt-5" onClick={() => setSearchQuery("")}>Clear search</Button>
            ) : (
              <Button asChild className="mt-5"><Link href="/search"><Search className="mr-2 h-4 w-4" />Search all media</Link></Button>
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}