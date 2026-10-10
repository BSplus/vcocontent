import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { type Event } from "@shared/schema";
import { ArrowLeft, CalendarDays, Search, Trophy } from "lucide-react";
import EventCard from "@/components/event-card";
import Footer from "@/components/footer";
import MainNavigation from "@/components/main-navigation";

export default function CurrentEventsPage() {
  const { data: events, isLoading, error, refetch, isFetching } = useQuery<Event[]>({ queryKey: ["/api/events"] });
  const today = new Date();
  const fourWeeksAgo = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000);
  const currentEvents = (events ?? [])
    .filter((event) => {
      const date = new Date(event.date);
      return date >= fourWeeksAgo && date <= today;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="min-h-[100dvh] bg-background">
      <MainNavigation />
      <main className="container mx-auto px-4 pb-16 pt-9 sm:pt-12">
        <Link href="/" className="mb-8 inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-semibold text-foreground/75 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <ArrowLeft className="h-4 w-4" />Back to home
        </Link>
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5 border-b border-foreground/15 pb-6">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-primary">The latest from the paddock</p>
            <div className="flex items-center gap-3">
              <Trophy className="h-7 w-7 text-primary" aria-hidden="true" />
              <h1 className="text-3xl font-bold tracking-wide text-foreground sm:text-4xl">Recent events</h1>
            </div>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-foreground/75">Recent event galleries, updated as the season unfolds.</p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="overflow-hidden rounded-lg border border-foreground/10 bg-card/60"><div className="aspect-[16/10] animate-pulse bg-foreground/10" /><div className="space-y-3 p-5"><div className="h-5 w-3/4 animate-pulse rounded bg-foreground/10" /><div className="h-4 w-1/2 animate-pulse rounded bg-foreground/10" /></div></div>)}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-12 text-center">
            <h2 className="text-xl font-bold">Events could not be loaded</h2>
            <p className="mt-2 text-sm text-foreground/75">Please try again in a moment.</p>
            <Button onClick={() => refetch()} disabled={isFetching} className="mt-5">{isFetching ? "Retrying…" : "Try again"}</Button>
          </div>
        ) : currentEvents.length ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {currentEvents.map((event) => <EventCard key={event.id} event={event} />)}
          </div>
        ) : (
          <div className="rounded-lg border border-foreground/15 bg-card/50 px-6 py-14 text-center">
            <CalendarDays className="mx-auto h-8 w-8 text-primary" />
            <h2 className="mt-4 text-xl font-bold">No recent events yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-foreground/75">Browse upcoming race weekends or search the full media archive.</p>
            <div className="mt-5 flex justify-center gap-3">
              <Button asChild variant="outline"><Link href="/upcoming-events">Upcoming events</Link></Button>
              <Button asChild><Link href="/search"><Search className="mr-2 h-4 w-4" />Search media</Link></Button>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}