import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Event, MediaItem, User } from "@shared/schema";
import { 
  Loader2, Plus, Trash2, Image as ImageIcon, Film, 
  UserCheck, UserX, Crown, PenLine, Eye, Edit
} from "lucide-react";
import UploadModal from "@/components/upload-modal";
import MediaUploadModal from "@/components/media-upload-modal";
import EditMediaModal from "@/components/edit-media-modal";
import { useToast } from "@/hooks/use-toast";
import SeriesManager from "@/components/series-manager";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export default function AdminDashboard() {
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [mediaUploadModalOpen, setMediaUploadModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const [selectedMediaItem, setSelectedMediaItem] = useState<MediaItem | null>(null);
  const [editMediaModalOpen, setEditMediaModalOpen] = useState(false);
  const [activeMediaEventId, setActiveMediaEventId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("events");
  const [mediaPage, setMediaPage] = useState(1);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Load events with better error handling
  const { data: events = [], isLoading: eventsLoading, error: eventsError, refetch: retryEvents } = useQuery<Event[]>({
    queryKey: ["/api/events"],
    staleTime: 0,
    retry: 1, // Only retry once on failure 
  });

  // Load media items for statistics
  const { data: mediaItems = [], isLoading: mediaLoading, error: mediaError, refetch: retryMedia } = useQuery<MediaItem[]>({
    queryKey: ["/api/media"],
    staleTime: 0,
    retry: 1, // Only retry once on failure
  });
  const { data: usage, error: usageError, refetch: retryUsage } = useQuery<{
    total: { bytes: string; count: string; legacy: string; legacyTextBytes: string };
    byEvent: { eventId: number; title: string; bytes: string; count: string; legacy: string }[];
    byCreator: { creatorId: number; bytes: string; count: string }[];
    cleanupCount: string;
    policy: { eventBytes: number; creatorBytes: number; eventCount: number; creatorCount: number };
    warningFraction: number;
  }>({ queryKey: ["/api/admin/media-usage"] });
  const { data: eventMediaItems = [] } = useQuery<MediaItem[]>({
    queryKey: [`/api/events/${activeMediaEventId}/media?page=${mediaPage}`],
    enabled: !!activeMediaEventId,
  });
  
  // Log any errors for debugging
  if (eventsError) console.error("Error loading events:", eventsError);
  if (mediaError) console.error("Error loading media items:", mediaError);

  // Explicit type for mediaItems array to fix TypeScript errors
  const mediaItemsArray: MediaItem[] = Array.isArray(mediaItems) ? mediaItems : [];

  // Delete event mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      console.log('Attempting to delete event:', id); 
      const response = await fetch(`/api/events/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", 
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error deleting event:', errorData); 
        throw new Error(errorData.error || 'Failed to delete event');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      toast({
        title: "Success",
        description: "Event deleted successfully",
      });
      setEventToDelete(null);
    },
    onError: (error: Error) => {
      console.error('Delete mutation error:', error); 
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getEventStats = (eventId: number) => {
    const eventMedia = mediaItemsArray.filter((item) => item.eventId === eventId);
    const photos = eventMedia.filter((item) => item.type === "image");
    const videos = eventMedia.filter((item) => item.type === "video");

    return {
      photos: photos.length,
      videos: videos.length,
      premiumCount: eventMedia.filter(item => item.isPremium).length,
      totalDownloads: eventMedia.reduce((sum, item) => sum + (item.downloadCount || 0), 0)
    };
  };

  // Explicit type for events array to fix TypeScript errors
  const eventsArray: Event[] = Array.isArray(events) ? events : [];
  
  const sortedEvents = [...eventsArray].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Separate VCO events from Creator events
  const vcoEvents = sortedEvents.filter(event => !event.creatorId);
  const creatorEvents = sortedEvents.filter(event => event.creatorId);

  if (eventsError || mediaError) {
    return <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p>Die Dashboard-Daten konnten nicht geladen werden.</p>
      <Button onClick={() => { if (eventsError) void retryEvents(); if (mediaError) void retryMedia(); }}>Erneut versuchen</Button>
    </div>;
  }
  if (eventsLoading || mediaLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Function to switch to the media tab
  const switchToMediaTab = (eventId: number) => {
    setActiveMediaEventId(eventId);
    setActiveTab("media");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-primary/20">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            ADMIN DASHBOARD
          </h1>
          <div className="flex gap-2 mt-4">
            <Button asChild variant="outline">
              <Link href="/">Back to Home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/users">User Management</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {usageError && (
          <div role="alert" className="mb-4 flex items-center gap-3">
            <p>Die Speicherübersicht konnte nicht geladen werden.</p>
            <Button variant="outline" onClick={() => void retryUsage()}>Erneut versuchen</Button>
          </div>
        )}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="media">Media Management</TabsTrigger>
            <TabsTrigger value="series">Race Series</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="mt-6">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold">Events Management</h2>
              <Button
                onClick={() => setUploadModalOpen(true)}
                className="bg-primary text-black hover:bg-primary/90"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create VCO Event
              </Button>
            </div>

            {/* VCO Events Section */}
            <div className="mb-8">
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Crown className="h-5 w-5 text-primary" />
                VCO Events
              </h3>
              <div className="grid gap-6">
                {vcoEvents.map((event) => {
                  const stats = getEventStats(event.id);
                  return (
                    <Card key={event.id} className="bg-black/40 border-primary/20">
                      <CardHeader>
                        <CardTitle className="text-xl font-[Orbitron] tracking-wider">
                          {event.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary" className="flex gap-2 items-center">
                              <ImageIcon className="h-3 w-3" />
                              {stats.photos} Photos
                            </Badge>
                            <Badge variant="secondary" className="flex gap-2 items-center">
                              <Film className="h-3 w-3" />
                              {stats.videos} Videos
                            </Badge>
                            <Badge variant="outline" className="flex gap-2 items-center">
                              {stats.totalDownloads} Downloads
                            </Badge>
                          </div>

                          <div className="flex justify-between items-center">
                            <p className="text-muted-foreground font-[Rajdhani]">
                              {new Date(event.date).toLocaleDateString()}
                            </p>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setSelectedEventId(event.id);
                                  setUploadModalOpen(true);
                                }}
                              >
                                <Edit className="h-4 w-4 mr-1" /> Edit Event
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setSelectedEventId(event.id);
                                  setMediaUploadModalOpen(true);
                                }}
                              >
                                <Plus className="h-4 w-4 mr-1" /> Upload Media
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => switchToMediaTab(event.id)}
                              >
                                <Eye className="h-4 w-4 mr-1" /> Manage Media
                              </Button>
                              <Button
                                variant="destructive"
                                size="icon"
                                onClick={() => setEventToDelete(event)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Creator Events Section */}
            <div className="mt-12">
              <h3 className="text-xl font-semibold mb-4">
                Creator Events
              </h3>
              <div className="grid gap-6">
                {creatorEvents.map((event) => {
                  const stats = getEventStats(event.id);
                  return (
                    <Card key={event.id} className="bg-black/40 border-primary/20">
                      <CardHeader>
                        <CardTitle className="text-xl font-[Orbitron] tracking-wider">
                          {event.title}
                        </CardTitle>
                        <CardDescription>
                          Creator Event
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary" className="flex gap-2 items-center">
                              <ImageIcon className="h-3 w-3" />
                              {stats.photos} Photos
                            </Badge>
                            <Badge variant="secondary" className="flex gap-2 items-center">
                              <Film className="h-3 w-3" />
                              {stats.videos} Videos
                            </Badge>
                            <Badge variant="outline" className="flex gap-2 items-center">
                              {stats.premiumCount} Premium Items
                            </Badge>
                            <Badge variant="outline" className="flex gap-2 items-center">
                              {stats.totalDownloads} Downloads
                            </Badge>
                          </div>

                          <div className="flex justify-between items-center">
                            <p className="text-muted-foreground font-[Rajdhani]">
                              {new Date(event.date).toLocaleDateString()}
                            </p>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                onClick={() => switchToMediaTab(event.id)}
                              >
                                <Eye className="h-4 w-4 mr-1" /> Manage Media
                              </Button>
                              <Button
                                variant="destructive"
                                size="icon"
                                onClick={() => setEventToDelete(event)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="media" className="mt-6">
            {usage && (
              <Card className="mb-6">
                <CardContent className="pt-5 space-y-3">
                  <h3 className="font-semibold">Storage usage</h3>
                  <p>{Number(usage.total.bytes).toLocaleString()} bytes in {usage.total.count} items;
                    {" "}{usage.total.legacy} older items have unknown object sizes (about {Number(usage.total.legacyTextBytes).toLocaleString()} bytes of database text).
                    {" "}{usage.cleanupCount} objects await cleanup.</p>
                  <p className="text-sm text-muted-foreground">Warning at {usage.warningFraction * 100}% of budget. Unmeasured older media is not included in byte totals.</p>
                  {usage.byCreator.map(row => (
                    <p key={row.creatorId} className={Number(row.bytes) >= usage.policy.creatorBytes * usage.warningFraction || Number(row.count) >= usage.policy.creatorCount * usage.warningFraction ? "text-amber-600" : ""}>
                      Creator {row.creatorId}: {(Number(row.bytes) / 1048576).toFixed(1)} / {(usage.policy.creatorBytes / 1048576).toFixed(0)} MiB, {row.count} / {usage.policy.creatorCount} items
                    </p>
                  ))}
                  <div className="max-h-48 overflow-y-auto">
                    {usage.byEvent.map(row => (
                      <p key={row.eventId} className={Number(row.bytes) >= usage.policy.eventBytes * usage.warningFraction || Number(row.count) >= usage.policy.eventCount * usage.warningFraction ? "text-amber-600" : ""}>
                        {row.title}: {(Number(row.bytes) / 1048576).toFixed(1)} / {(usage.policy.eventBytes / 1048576).toFixed(0)} MiB, {row.count} / {usage.policy.eventCount} items{Number(row.legacy) ? ` (${row.legacy} unmeasured)` : ""}
                      </p>
                    ))}
                  </div>
                  <Button variant="outline" onClick={async () => {
                    const response = await fetch("/api/admin/media-cleanup", { method: "POST", credentials: "include" });
                    if (!response.ok) { toast({ title: "Cleanup failed", variant: "destructive" }); return; }
                    queryClient.invalidateQueries({ queryKey: ["/api/admin/media-usage"] });
                  }}>Retry object cleanup</Button>
                </CardContent>
              </Card>
            )}
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold">Media Management</h2>
              <div className="flex gap-2">
                <select 
                  className="border rounded p-2 bg-background text-foreground"
                  onChange={(e) => {
                    const id = parseInt(e.target.value);
                    if (!isNaN(id)) {
                      setActiveMediaEventId(id);
                      setMediaPage(1);
                    } else {
                      setActiveMediaEventId(null);
                    }
                  }}
                  value={activeMediaEventId || ""}
                >
                  <option value="">Select Event...</option>
                  {sortedEvents.map(event => (
                    <option key={event.id} value={event.id}>{event.title}</option>
                  ))}
                </select>
                {activeMediaEventId && (
                  <Button
                    onClick={() => {
                      setSelectedEventId(activeMediaEventId);
                      setMediaUploadModalOpen(true);
                    }}
                    className="bg-primary text-black hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Upload Media
                  </Button>
                )}
              </div>
            </div>
            
            {!activeMediaEventId ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-muted-foreground mb-4">
                    Please select an event to view and manage its media
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Display media items for selected event */}
                {(() => {
                  const event = eventsArray.find(e => e.id === activeMediaEventId);
                  
                  if (eventMediaItems.length === 0) {
                    return (
                      <Card>
                        <CardContent className="flex flex-col items-center justify-center py-12">
                          <p className="text-muted-foreground mb-4">
                            No media uploaded for this event yet
                          </p>
                          <Button 
                            onClick={() => {
                              setSelectedEventId(activeMediaEventId);
                              setMediaUploadModalOpen(true);
                            }}
                          >
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
                              {item.isPremium && (
                                <Badge className="absolute top-2 right-2 bg-primary text-black">
                                  Premium
                                </Badge>
                              )}
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

          <TabsContent value="series" className="mt-6">
            <SeriesManager />
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

      <AlertDialog
        open={!!eventToDelete}
        onOpenChange={(open) => !open && setEventToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this event? This will also delete
              all associated media items. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (eventToDelete) {
                  deleteMutation.mutate(eventToDelete.id);
                }
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
