import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Event, MediaItem } from "@shared/schema";
import { 
  ArrowLeft, Loader2, Plus, Edit, Eye, PenLine
} from "lucide-react";
import UploadModal from "@/components/upload-modal";
import MediaUploadModal from "@/components/media-upload-modal";
import EditMediaModal from "@/components/edit-media-modal";
import DashboardEventList from "@/components/dashboard-event-list";

export default function CreatorDashboard() {
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [mediaUploadModalOpen, setMediaUploadModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [selectedMediaItem, setSelectedMediaItem] = useState<MediaItem | null>(null);
  const [editMediaModalOpen, setEditMediaModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"events" | "media" | "analytics">("events");
  const [eventSearch, setEventSearch] = useState("");

  // Load creator's events
  const { data: events = [], isLoading: eventsLoading, error: eventsError } = useQuery<Event[]>({
    queryKey: ["/api/creator/events"],
    staleTime: 0,
  });

  // Load all media items to calculate stats
  const { data: mediaItems = [], isLoading: mediaLoading, error: mediaError } = useQuery<MediaItem[]>({
    queryKey: ["/api/media"],
    staleTime: 0,
  });
  const [mediaPage, setMediaPage] = useState(1);
  useEffect(() => setMediaPage(1), [selectedEventId]);
  const { data: eventMediaItems = [] } = useQuery<MediaItem[]>({
    queryKey: [`/api/events/${selectedEventId}/media?page=${mediaPage}`],
    enabled: !!selectedEventId,
  });

  const getEventStats = (eventId: number) => {
    const eventMedia = mediaItems.filter((item) => item.eventId === eventId);
    const photos = eventMedia.filter((item) => item.type === "image");
    const videos = eventMedia.filter((item) => item.type === "video");

    return {
      photos: photos.length,
      videos: videos.length,
      totalDownloads: eventMedia.reduce((sum, item) => sum + (item.downloadCount || 0), 0),
    };
  };

  const sortedEvents = [...events].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  if (eventsLoading || mediaLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (eventsError || mediaError) {
    return <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p>Die Creator-Daten konnten nicht geladen werden.</p>
      <Button onClick={() => window.location.reload()}>Seite neu laden</Button>
    </div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-primary/20">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            CREATOR DASHBOARD
          </h1>
          <div className="flex gap-2 mt-4">
            <Button asChild variant="outline">
              <Link href="/">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Home
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "events" | "media" | "analytics")}>
          <TabsList>
            <TabsTrigger value="events">My Events</TabsTrigger>
            <TabsTrigger value="media">My Media</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="mt-6">
             <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
              <h2 className="text-2xl font-bold">My Events</h2>
              <Button
                onClick={() => {
                  setSelectedEventId(null);
                  setUploadModalOpen(true);
                }}
                className="bg-primary text-black hover:bg-primary/90"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create New Event
              </Button>
            </div>

             {!sortedEvents.length ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-muted-foreground mb-4">
                    No events created yet.
                  </p>
                  <Button onClick={() => setUploadModalOpen(true)}>
                    Create Your First Event
                  </Button>
                </CardContent>
              </Card>
             ) : (
               <>
                 <label htmlFor="creator-event-search" className="mb-2 block text-sm font-medium">Search events by title</label>
                 <Input id="creator-event-search" type="search" value={eventSearch} onChange={e => setEventSearch(e.target.value)} placeholder="Search events..." className="mb-6 max-w-md" />
                 <DashboardEventList title="My Events" events={sortedEvents} mediaItems={mediaItems} search={eventSearch} emptyMessage="No events created yet." actions={event => (
                   <>
                     <Button size="sm" variant="outline" onClick={() => { setSelectedEventId(event.id); setUploadModalOpen(true); }}><Edit className="mr-1 h-4 w-4" />Edit Event</Button>
                     <Button size="sm" variant="secondary" onClick={() => { setSelectedEventId(event.id); setMediaUploadModalOpen(true); }}><Plus className="mr-1 h-4 w-4" />Upload Media</Button>
                     <Button size="sm" variant="outline" onClick={() => { setSelectedEventId(event.id); setActiveTab("media"); }}><Eye className="mr-1 h-4 w-4" />Manage Media</Button>
                   </>
                 )} />
               </>
             )}
          </TabsContent>

          <TabsContent value="media" className="mt-6">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold">My Media</h2>
              <div className="flex gap-2">
                {sortedEvents.length > 0 && (
                  <select 
                    className="border rounded p-2 bg-background text-foreground"
                    onChange={(e) => {
                      const id = parseInt(e.target.value);
                      if (!isNaN(id)) {
                        setSelectedEventId(id);
                      } else {
                        setSelectedEventId(null);
                      }
                    }}
                    value={selectedEventId || ""}
                  >
                    <option value="">Select Event...</option>
                    {sortedEvents.map(event => (
                      <option key={event.id} value={event.id}>{event.title}</option>
                    ))}
                  </select>
                )}
                {selectedEventId && (
                  <Button
                    onClick={() => setMediaUploadModalOpen(true)}
                    className="bg-primary text-black hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Upload Media
                  </Button>
                )}
              </div>
            </div>
            
            {!selectedEventId ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-muted-foreground mb-4">
                    Please select an event to view its media
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Display media items for selected event */}
                {(() => {
                  const event = events.find(e => e.id === selectedEventId);
                  
                  if (eventMediaItems.length === 0) {
                    return (
                      <Card>
                        <CardContent className="flex flex-col items-center justify-center py-12">
                          <p className="text-muted-foreground mb-4">
                            No media uploaded for this event yet
                          </p>
                          <Button onClick={() => setMediaUploadModalOpen(true)}>
                            Upload Media
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  }
                  
                  return (
                    <div>
                      <h3 className="text-lg font-semibold mb-4">
                        Media for: {event?.title}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {eventMediaItems.map((item) => (
                          <Card key={item.id} className="overflow-hidden group">
                            <div className="aspect-video relative">
                              <img 
                                src={item.thumbnail} 
                                alt={item.caption || "Media thumbnail"} 
                                className="object-cover w-full h-full"
                              />
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedMediaItem(item);
                                    setEditMediaModalOpen(true);
                                  }}
                                >
                                  <PenLine className="h-4 w-4 mr-1" /> Edit
                                </Button>
                              </div>
                            </div>
                            <CardContent className="p-3">
                              <p className="text-sm truncate">{item.caption || "No caption"}</p>
                              <div className="flex justify-between items-center mt-2">
                                <p className="text-xs text-muted-foreground">
                                  {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {item.downloadCount || 0} downloads
                                </p>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                      <div className="flex justify-center gap-3 mt-4">
                        <Button variant="outline" disabled={mediaPage === 1} onClick={() => setMediaPage(mediaPage - 1)}>Previous</Button>
                        <span className="self-center">Page {mediaPage}</span>
                        <Button variant="outline" disabled={eventMediaItems.length < 48} onClick={() => setMediaPage(mediaPage + 1)}>Next</Button>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </TabsContent>

          <TabsContent value="analytics" className="mt-6">
            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Event Performance</CardTitle>
                  <CardDescription>Media downloads during the public beta</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {sortedEvents.map(event => {
                      const stats = getEventStats(event.id);
                      return (
                        <div key={event.id} className="flex justify-between items-center pb-4 border-b border-border last:border-0">
                          <div>
                            <h3 className="font-medium">{event.title}</h3>
                            <p className="text-sm text-muted-foreground">
                              {new Date(event.date).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-muted-foreground">
                              {stats.totalDownloads} Downloads
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <UploadModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        eventId={selectedEventId}
      />

      {selectedEventId && (
        <MediaUploadModal
          open={mediaUploadModalOpen}
          onOpenChange={setMediaUploadModalOpen}
          eventId={selectedEventId}
        />
      )}
      
      {selectedMediaItem && (
        <EditMediaModal
          open={editMediaModalOpen}
          onOpenChange={setEditMediaModalOpen}
          mediaItem={selectedMediaItem}
        />
      )}
    </div>
  );
}
