import { useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Event, MediaItem, InsertEvent } from "@shared/schema";
import { 
  ArrowLeft, Loader2, Plus, Image as ImageIcon, Film, 
  Edit, Eye, Trash2, PenLine
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import UploadModal from "@/components/upload-modal";
import MediaUploadModal from "@/components/media-upload-modal";
import SimpleModal from "@/components/simple-modal";
import EditMediaModal from "@/components/edit-media-modal";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function CreatorDashboard() {
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [mediaUploadModalOpen, setMediaUploadModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [selectedMediaItem, setSelectedMediaItem] = useState<MediaItem | null>(null);
  const [editMediaModalOpen, setEditMediaModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"events" | "media" | "analytics">("events");
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    date: new Date().toISOString().split('T')[0],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Laden eines vorhandenen Events in den Formular-State
  useEffect(() => {
    if (selectedEventId && events) {
      const event = events.find(e => e.id === selectedEventId);
      if (event) {
        setFormData({
          title: event.title,
          description: event.description || "",
          date: new Date(event.date).toISOString().split('T')[0],
        });
      }
    } else {
      // Reset auf leere Werte beim Öffnen eines neuen Formulars
      setFormData({
        title: "",
        description: "",
        date: new Date().toISOString().split('T')[0],
      });
    }
  }, [selectedEventId, uploadModalOpen]);
  
  // Event erstellen Mutation
  const createEventMutation = useMutation({
    mutationFn: async (data: InsertEvent) => {
      console.log("Creating event with data:", data);
      const response = await apiRequest("POST", "/api/creator/events", data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/creator/events"] });
      toast({
        title: "Success!",
        description: selectedEventId ? "Event updated" : "Event created",
      });
      setUploadModalOpen(false);
    },
    onError: (error: Error) => {
      console.error("Error creating event:", error);
      toast({
        title: "Error",
        description: `Error ${selectedEventId ? "updating" : "creating"} event: ${error.message}`,
        variant: "destructive",
      });
    }
  });
  
  // Event update mutation
  const updateEventMutation = useMutation({
    mutationFn: async (data: { id: number, event: Partial<InsertEvent> }) => {
      console.log("Updating event with data:", data);
      const response = await apiRequest("PATCH", `/api/creator/events/${data.id}`, data.event);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/creator/events"] });
      toast({
        title: "Success!",
        description: "Event updated",
      });
      setUploadModalOpen(false);
    },
    onError: (error: Error) => {
      console.error("Error updating event:", error);
      toast({
        title: "Error",
        description: `Error updating event: ${error.message}`,
        variant: "destructive",
      });
    }
  });
  
  // Submit form
  const handleSubmit = () => {
    setIsSubmitting(true);
    
    // Form validation
    if (!formData.title || !formData.date) {
      toast({
        title: "Error",
        description: "Please fill in all required fields (Title and Date)",
        variant: "destructive",
      });
      setIsSubmitting(false);
      return;
    }
    
    // Create InsertEvent object with all required fields
    const eventData = {
      title: formData.title,
      description: formData.description,
      date: formData.date,
      isPremium: false,
    } as any; // Using any to avoid TypeScript errors
    
    try {
      if (selectedEventId) {
        // Update existing event
        updateEventMutation.mutate({ id: selectedEventId, event: eventData });
      } else {
        // Create new event
        createEventMutation.mutate(eventData);
      }
    } catch (error) {
      console.error("Error submitting event:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Load creator's events
  const { data: events = [], isLoading: eventsLoading } = useQuery<Event[]>({
    queryKey: ["/api/creator/events"],
    staleTime: 0,
  });

  // Load all media items to calculate stats
  const { data: mediaItems = [], isLoading: mediaLoading } = useQuery<MediaItem[]>({
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
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold">My Events</h2>
              <Button
                onClick={() => {
                  console.log("Create New Event button clicked");
                  console.log("Current uploadModalOpen state:", uploadModalOpen);
                  setUploadModalOpen(true);
                  console.log("New uploadModalOpen state should be true");
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
              <div className="grid gap-6">
                {sortedEvents.map((event) => {
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
                                onClick={() => {
                                  setSelectedEventId(event.id);
                                  setActiveTab("media");
                                }}
                              >
                                <Eye className="h-4 w-4 mr-1" /> Manage Media
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
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

      {/* Original modals (hidden) */}
      <div style={{ display: 'none' }}>
        <UploadModal
          open={false}
          onOpenChange={setUploadModalOpen}
          eventId={selectedEventId}
        />
      </div>

      {/* SimpleModal for Event Creation */}
      <SimpleModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title={selectedEventId ? "Edit Event" : "Create New Event"}
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="title" className="block text-sm font-medium mb-1">Title</label>
            <input 
              type="text" 
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              placeholder="Event title" 
              className="w-full border rounded p-2"
            />
          </div>
          
          <div>
            <label htmlFor="desc" className="block text-sm font-medium mb-1">Description</label>
            <textarea 
              id="desc" 
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              placeholder="Event description" 
              className="w-full border rounded p-2 min-h-[100px]"
            />
          </div>
          
          <div>
            <label htmlFor="date" className="block text-sm font-medium mb-1">Date</label>
            <input 
              type="date" 
              id="date"
              value={formData.date}
              onChange={(e) => setFormData({...formData, date: e.target.value})}
              className="w-full border rounded p-2"
            />
          </div>
          
          <div className="flex justify-end gap-2 pt-4">
            <button 
              type="button" 
              onClick={() => setUploadModalOpen(false)}
              className="px-4 py-2 border rounded hover:bg-gray-100"
            >
              Cancel
            </button>
            <button 
              type="button" 
              disabled={isSubmitting}
              className={`px-4 py-2 bg-primary text-black rounded ${isSubmitting ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary/90'}`}
              onClick={handleSubmit}
            >
              {isSubmitting ? (
                <span className="flex items-center">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading...
                </span>
              ) : selectedEventId ? "Update Event" : "Create Event"}
            </button>
          </div>
        </div>
      </SimpleModal>

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