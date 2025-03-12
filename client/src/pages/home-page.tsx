import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Event, MediaItem } from "@shared/schema";
import EventCard from "@/components/event-card"; // Add back EventCard import
import {
  Loader2,
  Search,
  Calendar,
  Trophy,
  History,
  Clock,
  ChevronRight,
} from "lucide-react";
import Footer from "@/components/footer";
import { useState } from 'react';
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MediaGrid from "@/components/media-grid";

export default function HomePage() {
  const { user, logoutMutation } = useAuth();
  const { data: events, isLoading: eventsLoading } = useQuery<Event[]>({
    queryKey: ["/api/events"]
  });

  // Add state for search and filter
  const [searchQuery, setSearchQuery] = useState("");
  const [mediaFilter, setMediaFilter] = useState<"all" | "image" | "video">("all");

  // Fetch all media items
  const { data: allMediaItems, isLoading: mediaLoading } = useQuery<MediaItem[]>({
    queryKey: ["/api/media"],
    enabled: !!events // Only fetch media when we have events
  });

  // Filter media items based on search and type
  const filteredMediaItems = allMediaItems?.filter(item => {
    const matchesSearch = searchQuery === "" ||
      item.caption?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.photographer?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesType = mediaFilter === "all" || item.type === mediaFilter;

    return matchesSearch && matchesType;
  }) || [];

  // Scroll to section helper
  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const today = new Date();
  const fourWeeksAgo = new Date(today.getTime() - (28 * 24 * 60 * 60 * 1000));

  // Filter events based on search query and media type (This part is not used anymore but kept for completeness)
  const filteredEvents = events?.filter(event => {
    const matchesSearch = searchQuery === "" ||
      event.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.description.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch;
  }) || [];

  // Sort events by date
  const sortedEvents = filteredEvents.sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );


  // Current events (last 4 weeks)
  const currentEvents = sortedEvents.filter(event => {
    const eventDate = new Date(event.date);
    return eventDate >= fourWeeksAgo && eventDate <= today;
  }).slice(0, 4);

  // Upcoming events
  const upcomingEvents = sortedEvents.filter(event =>
    new Date(event.date) > today
  );

  // Archive events (older than 4 weeks)
  const archiveEvents = sortedEvents.filter(event => {
    const eventDate = new Date(event.date);
    return eventDate < fourWeeksAgo && eventDate < today;
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-primary/20 bg-black/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <img
                src="/attached_assets/VCO_2021_reg_White_Trans.png"
                alt="VCO Logo"
                className="h-8 w-auto"
              />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/80 text-transparent bg-clip-text">
                Media Database
              </h1>
            </div>
            <nav className="hidden md:flex gap-6">
              <button onClick={() => scrollToSection('home')} className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
                Home
              </button>
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

      <main id="home" className="container mx-auto px-4 py-8 space-y-16">
        <div className="container mx-auto px-4 py-8">
          <div className="flex gap-4 mb-8">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search media by caption, photographer, or tags..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={mediaFilter} onValueChange={(value: "all" | "image" | "video") => setMediaFilter(value)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Media</SelectItem>
                <SelectItem value="image">Images Only</SelectItem>
                <SelectItem value="video">Videos Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {(mediaLoading || eventsLoading) ? (
          <div className="flex justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredMediaItems.length > 0 ? (
          <div>
            <h2 className="text-2xl font-bold mb-6">Search Results</h2>
            <MediaGrid items={filteredMediaItems} showEditControls={false} />
          </div>
        ) : searchQuery || mediaFilter !== "all" ? (
          <p className="text-center text-foreground/60 py-12">
            No media items found matching your search criteria.
          </p>
        ) : null}


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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {archiveEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}