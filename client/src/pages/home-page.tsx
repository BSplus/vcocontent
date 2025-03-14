import { useQuery } from "@tanstack/react-query";
import { type Event, type Series, type MediaItem } from "@shared/schema";
import { Loader2, Calendar, Trophy, History, Clock, ChevronRight, Star, Download } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import EventCard from "@/components/event-card";
import Footer from "@/components/footer";
import MainNavigation from "@/components/main-navigation";
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";


export default function HomePage() {
  const { user } = useAuth();
  const [selectedTopShot, setSelectedTopShot] = useState<MediaItem | null>(null);

  // Events loading with improved error handling
  const { data: events = [], isLoading: eventsLoading, error: eventsError } = useQuery<Event[]>({
    queryKey: ["/api/events"],
    retry: 3,
    onError: (error) => {
      console.error('Failed to fetch events:', error);
    }
  });

  // Series loading
  const { data: series = [], isLoading: seriesLoading } = useQuery<Series[]>({
    queryKey: ["/api/series"]
  });

  // Top shots loading
  const { data: topShots = [], isLoading: topShotsLoading } = useQuery<MediaItem[]>({
    queryKey: ["/api/media/top-shots"]
  });

  // Event categorization
  const today = new Date();
  const fourWeeksAgo = new Date(today.getTime() - (28 * 24 * 60 * 60 * 1000));

  // Current events
  const currentEvents = events
    .filter(event => {
      const eventDate = new Date(event.date);
      return eventDate >= fourWeeksAgo && eventDate <= today;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 4);

  // Upcoming events
  const upcomingEvents = events
    .filter(event => {
      const eventDate = new Date(event.date);
      return eventDate > today;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Archive events
  const archiveEvents = events
    .filter(event => {
      const eventDate = new Date(event.date);
      return eventDate < fourWeeksAgo && eventDate < today;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Loading state
  if (eventsLoading || seriesLoading || topShotsLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Error state
  if (eventsError) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <p className="text-red-500 mb-4">Failed to load events</p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  const handleDownload = async (url: string, quality: 'high' | 'low', mediaId: number) => {
    try {
      // Track download
      await fetch(`/api/media/${mediaId}/download`, {
        method: 'POST',
        credentials: 'include',
      });

      // Download the file
      const response = await fetch(url);
      const blob = await response.blob();
      const filename = url.split('/').pop() || 'download';
      const extension = '.jpg';

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${filename}-${quality}${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section with Header Image */}
      <div className="relative h-[60vh] overflow-hidden">
        <img
          src="./attached_assets/IMG_7464.png"
          alt="Racing track at sunset"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-background" />

        {/* Navigation */}
        <MainNavigation />
      </div>

      <main className="container mx-auto px-4 py-8 space-y-16">
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

        {upcomingEvents.length > 0 && (
          <section id="upcoming" className="bg-black/40 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-6">
              <Calendar className="h-6 w-6 text-accent" />
              <h2 className="text-2xl font-bold text-accent">Upcoming Events</h2>
            </div>
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
          </section>
        )}

        {/* TOP SHOTS Section */}
        <section id="top-shots" className="bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 rounded-lg p-8 border border-primary/20">
          <div className="flex items-center gap-3 mb-8">
            <Star className="h-8 w-8 text-primary" />
            <h2 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              TOP SHOTS
            </h2>
          </div>

          {topShotsLoading ? (
            <div className="flex justify-center items-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : !topShots.length ? (
            <p className="text-center text-foreground/60 py-12">
              No top shots available yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {topShots.map((shot) => (
                <div
                  key={shot.id}
                  className="group cursor-pointer"
                  onClick={() => setSelectedTopShot(shot)}
                >
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-black/40 border border-primary/20">
                    <img
                      src={shot.url}
                      alt={shot.caption || "Top shot"}
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      {shot.caption && (
                        <p className="text-sm font-medium text-white line-clamp-2 mb-2">
                          {shot.caption}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <Star className="h-4 w-4 text-primary fill-primary" />
                        <span className="text-sm font-bold text-primary">
                          {shot.downloadCount} Downloads
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
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
                    {archiveEvents.slice(4, 10).map((event) => (
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
                  <Button
                    variant="outline"
                    className="w-full mt-4 hover:bg-black/20 transition-colors"
                  >
                    View All {archiveEvents.length} Archive Events
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
      {/* Top Shot Preview Dialog */}
      <Dialog open={!!selectedTopShot} onOpenChange={(open) => !open && setSelectedTopShot(null)}>
        <DialogContent className="max-w-4xl">
          {selectedTopShot && (
            <div className="space-y-4">
              <div className="relative aspect-video bg-black/20">
                <img
                  src={selectedTopShot.url}
                  alt={selectedTopShot.caption || "Media preview"}
                  className="absolute inset-0 w-full h-full object-contain"
                />
              </div>

              <div className="flex justify-between items-center">
                <div>
                  {selectedTopShot.photographer && (
                    <p className="text-sm text-muted-foreground">
                      Photographer: {selectedTopShot.photographer}
                    </p>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => handleDownload(selectedTopShot.url, 'high', selectedTopShot.id)}>
                      Download High-Res
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload(selectedTopShot.thumbnail || selectedTopShot.url, 'low', selectedTopShot.id)}>
                      Download Low-Res
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {selectedTopShot.caption && (
                <p className="text-sm">{selectedTopShot.caption}</p>
              )}

              {selectedTopShot.tags && selectedTopShot.tags.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {selectedTopShot.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-secondary text-secondary-foreground text-sm rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Footer />
    </div>
  );
}