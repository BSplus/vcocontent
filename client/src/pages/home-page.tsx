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
    retry: 3
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

  // Separate VCO events from Creator events
  const vcoEvents = events.filter(event => !event.creatorId);
  const creatorEvents = events.filter(event => event.creatorId);

  // Current VCO events
  const currentVcoEvents = vcoEvents
    .filter(event => {
      const eventDate = new Date(event.date);
      return eventDate >= fourWeeksAgo && eventDate <= today;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 4);

  // Current Creator events
  const currentCreatorEvents = creatorEvents
    .filter(event => {
      const eventDate = new Date(event.date);
      return eventDate >= fourWeeksAgo && eventDate <= today;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 4);

  // All current events (for backward compatibility)
  const currentEvents = [...currentVcoEvents, ...currentCreatorEvents].slice(0, 4);

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
    
  // Popular creator content (based on download count, limited to 3 items)
  const { data: creatorTopMedia = [], isLoading: creatorMediaLoading } = useQuery<MediaItem[]>({
    queryKey: ["/api/media/creator-top"],
    enabled: !topShotsLoading, // Load after top shots
  });

  // Loading state
  if (eventsLoading || seriesLoading || topShotsLoading || creatorMediaLoading) {
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

  const handleDownload = async (item: MediaItem, quality: 'high' | 'low') => {
    try {
      const authorization = await fetch(`/api/media/${item.id}/download`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!authorization.ok) {
        const message = await authorization.text();
        throw new Error(message || `Download authorization failed (${authorization.status})`);
      }

      let blob: Blob;
      let filename = `media-${item.id}`;
      if ((authorization.headers.get('content-type') || '').includes('application/json')) {
        const result = await authorization.json();
        if (typeof result.url !== 'string' || !result.url) {
          throw new Error('The server did not provide an authorized media download URL.');
        }
        filename = result.url.split('/').pop() || filename;
        const downloadUrl = quality === 'low' ? item.thumbnail : result.url;
        const response = await fetch(downloadUrl, { credentials: 'include' });
        if (!response.ok) throw new Error(`Media download failed (${response.status})`);
        blob = await response.blob();
      } else {
        blob = await authorization.blob();
      }
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
      window.alert(error instanceof Error ? error.message : 'Unable to download this media item.');
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
        {/* VCO Current Events */}
        <section id="current-vco">
          <div className="flex items-center gap-3 mb-6">
            <Trophy className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-bold text-primary">VCO Official Events</h2>
          </div>
          {!currentVcoEvents.length ? (
            <p className="text-center text-foreground/60 py-12">
              No current VCO events found.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {currentVcoEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>
        
        {/* Creator Events - Only shown if not empty and not included in POPULAR CREATOR CONTENT section */}
        {currentCreatorEvents.length > 0 && !creatorTopMedia.length && (
          <section id="current-creator" className="mt-12">
            <div className="flex items-center gap-3 mb-6">
              <Trophy className="h-6 w-6 text-accent" />
              <h2 className="text-2xl font-bold text-accent">Creator Events</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {currentCreatorEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </section>
        )}

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

        {/* POPULAR CREATOR CONTENT Section */}
        {creatorTopMedia.length > 0 && (
          <section id="creator-content" className="bg-gradient-to-r from-accent/10 via-primary/10 to-accent/10 rounded-lg p-8 border border-accent/20">
            <div className="flex items-center gap-3 mb-8">
              <Star className="h-8 w-8 text-accent" />
              <h2 className="text-3xl font-bold bg-gradient-to-r from-accent to-primary bg-clip-text text-transparent">
                POPULAR CREATOR CONTENT
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {creatorTopMedia.map((item) => (
                <div
                  key={item.id}
                  className="group cursor-pointer"
                  onClick={() => setSelectedTopShot(item)}
                >
                  <div className="relative aspect-video overflow-hidden rounded-lg bg-black/40 border border-accent/20">
                    <img
                      src={item.thumbnail}
                      alt={item.caption || "Creator content"}
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      {item.caption && (
                        <p className="text-sm font-medium text-white line-clamp-2 mb-2">
                          {item.caption}
                        </p>
                      )}
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <Download className="h-4 w-4 text-accent" />
                          <span className="text-sm font-bold text-accent">
                            {item.downloadCount} Downloads
                          </span>
                        </div>
                        {item.photographer && (
                          <span className="text-xs text-white/80">
                            By: {item.photographer}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {currentCreatorEvents.length > 0 && (
              <div className="mt-8">
                <h3 className="text-xl font-bold mb-4 text-accent">Creator Events</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {currentCreatorEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

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
                  src={selectedTopShot.thumbnail}
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
                    <DropdownMenuItem onClick={() => handleDownload(selectedTopShot, 'high')}>
                      Download High-Res
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDownload(selectedTopShot, 'low')}>
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