import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Event, type MediaItem, type Series } from "@shared/schema";
import { Loader2, Calendar, Trophy, History, Clock, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useState, useMemo } from "react";
import MediaGrid from "@/components/media-grid";
import EventCard from "@/components/event-card";
import Footer from "@/components/footer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function HomePage() {
  const { user, logoutMutation } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>("all");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);

  // Media loading
  const { data: fetchedMediaItems, isLoading: mediaLoading } = useQuery<MediaItem[]>({
    queryKey: ["/api/media"]
  });

  const handleMediaDelete = (deletedItemId: number) => {
    setMediaItems(prev => prev.filter(item => item.id !== deletedItemId));
  };

  // Events loading with improved error handling
  const { 
    data: events = [], 
    isLoading: eventsLoading,
    error: eventsError 
  } = useQuery<Event[]>({
    queryKey: ["/api/events"]
  });

  // Series loading
  const { 
    data: series = [],
    isLoading: seriesLoading 
  } = useQuery<Series[]>({
    queryKey: ["/api/series"]
  });

  // Filter events based on series and search query
  const filteredEvents = useMemo(() => {
    let filtered = [...events];

    // First filter by series if one is selected
    if (selectedSeriesId !== "all") {
      filtered = filtered.filter(event => event.seriesId === parseInt(selectedSeriesId));
    }

    // Then filter by search query if present
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(event => {
        return event.title.toLowerCase().includes(query) ||
               event.description?.toLowerCase().includes(query);
      });
    }

    return filtered;
  }, [events, selectedSeriesId, searchQuery]);

  // Helper function to check if an event has images
  const eventHasImages = (eventId: number) => {
    return fetchedMediaItems?.some(item => item.eventId === eventId && item.type === "image") ?? false;
  };

  // Event categorization from filtered events
  const today = new Date();
  const fourWeeksAgo = new Date(today.getTime() - (28 * 24 * 60 * 60 * 1000));

  // Current events - only show events with images
  const currentEvents = filteredEvents
    .filter(event => {
      const eventDate = new Date(event.date);
      return eventDate >= fourWeeksAgo && 
             eventDate <= today && 
             eventHasImages(event.id);
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 4);

  // Upcoming events - include events without images regardless of date
  const upcomingEvents = filteredEvents
    .filter(event => {
      const eventDate = new Date(event.date);
      // Show in upcoming if:
      // 1. Event has no images OR
      // 2. Event date is in the future
      return !eventHasImages(event.id) || eventDate > today;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Archive events - only show events with images
  const archiveEvents = filteredEvents
    .filter(event => {
      const eventDate = new Date(event.date);
      return eventDate < fourWeeksAgo && 
             eventDate < today && 
             eventHasImages(event.id);
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

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
              <Link href="/" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
                Home
              </Link>
              <Link href="/current-events" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
                Current Events
              </Link>
              <Link href="/upcoming-events" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
                Upcoming Events
              </Link>
              <Link href="/archive-events" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
                Archive
              </Link>
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

      <main className="container mx-auto px-4 py-8 space-y-16">
        <section className="max-w-4xl mx-auto">
          <div className="flex flex-col gap-4">
            <h2 className="text-2xl font-bold text-center">Find Content</h2>
            <div className="flex items-center gap-4">
              <Select value={selectedSeriesId} onValueChange={setSelectedSeriesId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select Series" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Series</SelectItem>
                  {series.map(s => (
                    <SelectItem key={s.id} value={s.id.toString()}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <span className="text-muted-foreground font-medium">OR</span>

              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by event title, description..."
                className="flex-1"
              />
            </div>
          </div>
        </section>

        <section id="current">
          <div className="flex items-center gap-3 mb-6">
            <Trophy className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-bold text-primary">Current Events</h2>
          </div>
          {!currentEvents.length ? (
            <p className="text-center text-foreground/60 py-12">
              No current events found.
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {archiveEvents.slice(0, 4).map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
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
      </main>
      <Footer />
    </div>
  );
}