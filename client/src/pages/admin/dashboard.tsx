import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Event, MediaItem } from "@shared/schema";
import { Loader2, Plus, Trash2, Image as ImageIcon, Film, Download } from "lucide-react";
import UploadModal from "@/components/upload-modal";
import MediaUploadModal from "@/components/media-upload-modal";
import { createDemoContent } from "@/lib/demo-data";
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
import { apiRequest } from "@/lib/queryClient";

export default function AdminDashboard() {
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [mediaUploadModalOpen, setMediaUploadModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: events, isLoading, refetch } = useQuery<Event[]>({
    queryKey: ["/api/events"],
  });

  // Sort events by date (newest first)
  const sortedEvents = events?.sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  ) || [];

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (eventId: number) => {
      try {
        // Use simple DELETE request without body
        const res = await fetch(`/api/events/${eventId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to delete event");
        }

        return eventId; // Just return the ID on success
      } catch (error) {
        console.error('Delete event error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
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
        description: error.message || "Failed to delete event",
        variant: "destructive",
      });
      setEventToDelete(null);
    },
  });

  const handleCreateDemoContent = async () => {
    try {
      await createDemoContent();
      await refetch();
      toast({
        title: "Success",
        description: "Demo content created successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create demo content",
        variant: "destructive",
      });
    }
  };

  const handleDeleteEvent = async (event: Event) => {
    try {
      await deleteMutation.mutateAsync(event.id);
    } catch (error) {
      console.error('Handle delete event error:', error);
    }
  };

  // Fetch media items for all events
  const { data: allMediaItems = [] } = useQuery<MediaItem[]>({
    queryKey: ["/api/media"],
  });

  // Calculate stats for each event
  const getEventStats = (eventId: number) => {
    const eventMedia = allMediaItems.filter(item => item.eventId === eventId);
    return {
      photos: eventMedia.filter(item => item.type === "image").length,
      videos: eventMedia.filter(item => item.type === "video").length,
      totalMedia: eventMedia.length,
      downloads: 0 // Placeholder, needs backend implementation
    };
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-primary/20">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Admin Dashboard
          </h1>
          <div className="flex gap-2 mt-4">
            <Button onClick={handleCreateDemoContent} variant="outline">
              Create Demo Content
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Back to Home</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="events">
          <TabsList>
            <TabsTrigger value="events">Events</TabsTrigger>
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
                Create Event
              </Button>
            </div>

            {isLoading ? (
              <div className="flex justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : !sortedEvents.length ? (
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
                          <div className="flex flex-wrap gap-4">
                            <Badge variant="secondary" className="flex gap-2 items-center">
                              <ImageIcon className="h-3 w-3" />
                              {stats.photos} Photos
                            </Badge>
                            <Badge variant="secondary" className="flex gap-2 items-center">
                              <Film className="h-3 w-3" />
                              {stats.videos} Videos
                            </Badge>
                            <Badge variant="outline" className="flex gap-2 items-center">
                              <Download className="h-3 w-3" />
                              {stats.downloads} Downloads
                            </Badge>
                          </div>

                          <div className="flex justify-between items-center">
                            <p className="text-muted-foreground font-[Rajdhani]">
                              {event.date ? new Date(event.date).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                              }) : 'Date not available'}
                            </p>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setSelectedEventId(event.id);
                                  setUploadModalOpen(true);
                                }}
                              >
                                Edit Event
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setSelectedEventId(event.id);
                                  setMediaUploadModalOpen(true);
                                }}
                              >
                                Upload Media
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

      {/* Delete Confirmation Dialog */}
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
              className="bg-red-500 hover:bg-red-600"
              onClick={() => eventToDelete && handleDeleteEvent(eventToDelete)}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}