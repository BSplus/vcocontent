import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { type Event } from "@shared/schema";
import { ArrowLeft, CalendarDays, Clock3, Search } from "lucide-react";
import Footer from "@/components/footer";
import MainNavigation from "@/components/main-navigation";
import EventTitle from "@/components/event-title";
import { formatDate } from "@/lib/utils";

export default function UpcomingEventsPage() {
  const { data: events, isLoading, error, refetch, isFetching } = useQuery<Event[]>({ queryKey: ["/api/events"] });
  const upcomingEvents = (events ?? [])
    .filter((event) => new Date(event.date) > new Date())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="min-h-[100dvh] bg-background">
      <MainNavigation />
      <main className="container mx-auto px-4 pb-16 pt-9 sm:pt-12">
        <Link href="/" className="mb-8 inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-semibold text-foreground/75 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <ArrowLeft className="h-4 w-4" />Back to home
        </Link>
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5 border-b border-foreground/15 pb-6">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-accent">Next on the calendar</p>
            <div className="flex items-center gap-3">
              <CalendarDays className="h-7 w-7 text-accent" aria-hidden="true" />
              <h1 className="text-3xl font-bold tracking-wide text-foreground sm:text-4xl">Upcoming events</h1>
            </div>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-foreground/75">Calendar information only: upcoming race dates and event listings, not links to media galleries.</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-[88px] animate-pulse rounded-md border border-foreground/10 bg-card/60" />)}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-12 text-center">
            <h2 className="text-xl font-bold">Calendar could not be loaded</h2>
            <p className="mt-2 text-sm text-foreground/75">Please try again in a moment.</p>
            <Button onClick={() => refetch()} disabled={isFetching} className="mt-5">{isFetching ? "Retrying…" : "Try again"}</Button>
          </div>
        ) : upcomingEvents.length ? (
          <ol className="divide-y divide-foreground/10 border-y border-foreground/10">
            {upcomingEvents.map((event, index) => {
              const date = new Date(event.date);
              return (
                <li key={event.id} className="flex min-w-0 flex-wrap items-center justify-between gap-4 py-5 sm:gap-6">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold tracking-wide sm:text-xl"><EventTitle title={event.title} /></h2>
                    <p className="mt-1 flex items-center gap-2 text-sm text-foreground/75">
                      <Clock3 className="h-4 w-4 shrink-0 text-accent" />
                      <time dateTime={date.toISOString()}>{formatDate(date)}</time>
                    </p>
                    {event.description && <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-relaxed text-foreground/70">{event.description}</p>}
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-widest text-foreground/60">
                    {index === 0 ? "Next event" : "Scheduled"}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="rounded-lg border border-foreground/15 bg-card/50 px-6 py-14 text-center">
            <CalendarDays className="mx-auto h-8 w-8 text-accent" />
            <h2 className="mt-4 text-xl font-bold">No events on the calendar</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-foreground/75">Take a look through recent galleries while the next race weekend takes shape.</p>
            <div className="mt-5 flex justify-center gap-3">
              <Button asChild variant="outline"><Link href="/current-events">Recent events</Link></Button>
              <Button asChild><Link href="/search"><Search className="mr-2 h-4 w-4" />Search media</Link></Button>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}