import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Event, MediaItem } from "@shared/schema";
import { Loader2, Calendar, Trophy, History, Clock, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import MediaGrid from "@/components/media-grid";
import EventCard from "@/components/event-card";
import Footer from "@/components/footer";

export default function HomePage() {
  const { user, logoutMutation } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch all media items - add success callback for debugging
  const { data: allMediaItems, isLoading: mediaLoading } = useQuery<MediaItem[]>({
    queryKey: ["/api/media"],
    onSuccess: (data) => {
      console.log('Received media items:', data?.length);
      console.log('Sample items:', data?.slice(0, 2));
    }
  });

  // Fetch events separately
  const { data: events, isLoading: eventsLoading } = useQuery<Event[]>({
    queryKey: ["/api/events"]
  });

  // Simple full text search on media items
  const searchResults = searchQuery.trim() ? allMediaItems?.filter(item => {
    const query = searchQuery.toLowerCase().trim();

    // First just check the caption to verify basic search
    if (item.caption) {
      const match = item.caption.toLowerCase().includes(query);
      if (match) {
        console.log('Found match:', {
          query,
          caption: item.caption,
        });
      }
      return match;
    }
    return false;
  }) : [];

  // Add debug logging for search state
  console.log('Search state:', {
    query: searchQuery,
    totalItems: allMediaItems?.length,
    resultsCount: searchResults?.length,
  });

  // Event categorization
  const today = new Date();
  const fourWeeksAgo = new Date(today.getTime() - (28 * 24 * 60 * 60 * 1000));

  const sortedEvents = events?.sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  ) || [];

  const currentEvents = sortedEvents
    .filter(event => {
      const eventDate = new Date(event.date);
      return eventDate >= fourWeeksAgo && eventDate <= today;
    })
    .slice(0, 4);

  const upcomingEvents = sortedEvents.filter(event =>
    new Date(event.date) > today
  );

  const archiveEvents = sortedEvents.filter(event => {
    const eventDate = new Date(event.date);
    return eventDate < fourWeeksAgo && eventDate < today;
  });

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-primary/20 bg-black/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-[Orbitron] text-[#4B71FF]">
                VCO MEDIA DATABASE
              </h1>
            </div>
            <nav className="hidden md:flex gap-6">
              <button onClick={() => scrollToSection('home')} className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
                Home
              </button>
              <button onClick={() => scrollToSection('current')} className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
                Current Events
              </button>
              <button onClick={() => scrollToSection('upcoming')} className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
                Upcoming Events
              </button>
              <button onClick={() => scrollToSection('archive')} className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
                Archive
              </button>
            </nav>
          </div>
          <div className="flex gap-4 items-center">
            {user?.isAdmin && (
              <Button variant="outline" asChild className="border-primary/20 hover:bg-primary hover:text-black">
                <Link href="/admin">Creator Dashboard</Link>
              </Button>
            )}
            {user ? (
              <Button
                variant="secondary"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className="bg-primary text-black hover:bg-primary/90"
              >
                {logoutMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Logout'
                )}
              </Button>
            ) : (
              <Button asChild className="bg-primary text-black hover:bg-primary/90">
                <Link href="/auth">CREATOR LOGIN</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main id="home" className="container mx-auto px-4 py-8 space-y-16">
        {/* Search Section */}
        <section className="max-w-2xl mx-auto">
          <div className="flex flex-col gap-4">
            <h2 className="text-2xl font-bold text-center">Search Media Assets</h2>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by caption, photographer, or tags..."
              className="w-full"
            />
            {searchQuery && (
              <div className="mt-4">
                <h3 className="text-lg font-semibold mb-4">
                  {searchResults?.length
                    ? `Found ${searchResults.length} results`
                    : 'No results found'}
                </h3>
                {searchResults && searchResults.length > 0 && (
                  <MediaGrid items={searchResults} />
                )}
              </div>
            )}
          </div>
        </section>

        {/* Only show events sections when not searching */}
        {!searchQuery && (
          <>
            <section id="current">
              <div className="flex items-center gap-3 mb-6">
                <Trophy className="h-6 w-6 text-primary" />
                <h2 className="text-2xl font-bold text-primary">Current Events</h2>
              </div>
              {!currentEvents.length ? (
                <p className="text-center text-foreground/60 py-12">
                  No current events.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {currentEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              )}
            </section>

            <section id="upcoming" className="bg-black/40 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-6">
                <Calendar className="h-6 w-6 text-accent" />
                <h2 className="text-2xl font-bold text-accent">Upcoming Events</h2>
              </div>
              {!upcomingEvents.length ? (
                <p className="text-center text-foreground/60 py-6">
                  No upcoming events scheduled.
                </p>
              ) : (
                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {upcomingEvents.slice(0, 10).map((event) => (
                      <div
                        key={event.id}
                        className="group bg-black/20 rounded-lg p-4 hover:bg-black/30 transition-all hover:scale-[1.02] cursor-default h-[88px]"
                      >
                        <div className="flex items-center gap-3">
                          <Clock className="h-5 w-5 text-primary shrink-0" />
                          <div className="min-w-0">
                            <h3 className="font-bold truncate group-hover:text-primary transition-colors">
                              {event.title}
                            </h3>
                            <p className="text-sm text-foreground/60 truncate">
                              {new Date(event.date).toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                              })}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {upcomingEvents.length > 10 && (
                    <Button
                      variant="outline"
                      className="w-full mt-4 hover:bg-black/20 transition-colors"
                    >
                      View All {upcomingEvents.length} Upcoming Events
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </Button>
                  )}
                </div>
              )}
            </section>

            <section id="archive">
              <div className="flex items-center gap-3 mb-6">
                <History className="h-6 w-6 text-foreground/60" />
                <h2 className="text-2xl font-bold text-foreground/80">Archive</h2>
              </div>
              {!archiveEvents.length ? (
                <p className="text-center text-foreground/60 py-12">
                  No archived events available.
                </p>
              ) : (
                <div className="space-y-6">
                  {/* Featured archive events (latest 4) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {archiveEvents.slice(0, 4).map((event) => (
                      <EventCard key={event.id} event={event} />
                    ))}
                  </div>

                  {/* Remaining archive events in compact view */}
                  {archiveEvents.length > 4 && (
                    <div className="bg-black/40 rounded-lg p-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {archiveEvents.slice(4).map((event) => (
                          <div
                            key={event.id}
                            className="group bg-black/20 rounded-lg p-4 hover:bg-black/30 transition-all hover:scale-[1.02] cursor-default h-[88px]"
                          >
                            <div className="flex items-center gap-3">
                              <History className="h-5 w-5 text-primary shrink-0" />
                              <div className="min-w-0">
                                <h3 className="font-bold truncate group-hover:text-primary transition-colors">
                                  {event.title}
                                </h3>
                                <p className="text-sm text-foreground/60 truncate">
                                  {new Date(event.date).toLocaleDateString('en-US', {
                                    weekday: 'short',
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric'
                                  })}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <Link href="/archive-events">
                        <Button
                          variant="outline"
                          className="w-full mt-4 hover:bg-black/20 transition-colors"
                        >
                          View All {archiveEvents.length} Archive Events
                          <ChevronRight className="h-4 w-4 ml-2" />
                        </Button>
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}