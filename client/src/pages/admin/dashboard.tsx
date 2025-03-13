import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Event, MediaItem } from "@shared/schema";
import { Loader2, Plus, Trash2, Image as ImageIcon, Film } from "lucide-react";
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
import { Input } from "@/components/ui/input";


export default function AdminDashboard() {
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [mediaUploadModalOpen, setMediaUploadModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Load events
  const { data: events = [], isLoading: eventsLoading } = useQuery<Event[]>({
    queryKey: ["/api/events"]
  });

  // Load media items for statistics
  const { data: mediaItems = [], isLoading: mediaLoading } = useQuery<MediaItem[]>({
    queryKey: ["/api/media"],
    retry: false,
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to load media data",
        variant: "destructive",
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (eventId: number) => {
      await apiRequest("DELETE", `/api/events/${eventId}`);
    },
    onSuccess: () => {
      // Invalidate all related queries to trigger immediate updates
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      queryClient.invalidateQueries({ queryKey: ["/api/series"] });

      // Also invalidate any specific event media queries that might exist
      if (eventToDelete?.id) {
        queryClient.invalidateQueries({
          queryKey: [`/api/events/${eventToDelete.id}/media`]
        });
      }

      toast({
        title: "Success",
        description: "Event deleted successfully",
      });
      setEventToDelete(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete event",
        variant: "destructive",
      });
    },
  });

  const handleCreateDemoContent = async () => {
    try {
      await createDemoContent();
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
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
    if (!event?.id) return;
    await deleteMutation.mutateAsync(event.id);
  };

  const getEventStats = (eventId: number) => {
    try {
      const eventMedia = mediaItems.filter(item => item.eventId === eventId) || [];
      return {
        photos: eventMedia.filter(item => item.type === "image").length,
        videos: eventMedia.filter(item => item.type === "video").length
      };
    } catch (error) {
      console.error('Error calculating stats:', error);
      return { photos: 0, videos: 0 };
    }
  };

  const sortedEvents = [...events].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Add state for header image upload
  const [headerImageFile, setHeaderImageFile] = useState<File | null>(null);
  const [headerImagePreview, setHeaderImagePreview] = useState<string>("");

  const handleHeaderImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check image dimensions
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const aspectRatio = img.width / img.height;
      if (Math.abs(aspectRatio - (21 / 9)) > 0.1) { // Allow small deviation
        toast({
          title: "Invalid image dimensions",
          description: "Please upload an image with a 21:9 aspect ratio",
          variant: "destructive",
        });
        URL.revokeObjectURL(objectUrl);
        return;
      }

      setHeaderImageFile(file);
      setHeaderImagePreview(objectUrl);
    };

    img.src = objectUrl;
  };

  const handleHeaderImageUpload = async () => {
    if (!headerImageFile) return;

    try {
      // Convert to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        if (typeof reader.result === 'string') {
          try {
            const response = await apiRequest("POST", "/api/header-image", {
              url: reader.result
            });

            if (!response.ok) {
              throw new Error("Failed to upload header image");
            }

            const result = await response.json();
            queryClient.invalidateQueries({ queryKey: ["/api/header-image"] });

            toast({
              title: "Success",
              description: "Header image updated successfully",
            });
            setHeaderImageFile(null);
            setHeaderImagePreview("");
          } catch (error) {
            toast({
              title: "Error",
              description: "Failed to upload header image",
              variant: "destructive",
            });
          }
        }
      };
      reader.readAsDataURL(headerImageFile);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to upload header image",
        variant: "destructive",
      });
    }
  };


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
            <TabsTrigger value="header">Header Image</TabsTrigger>
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

          <TabsContent value="header" className="mt-6">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold">Header Image Management</h2>
            </div>

            <Card className="bg-black/40 border-primary/20">
              <CardHeader>
                <CardTitle>Upload Header Image</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={handleHeaderImageChange}
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      Please upload an image with a 21:9 aspect ratio for optimal display
                    </p>
                  </div>

                  {headerImagePreview && (
                    <div className="mt-4">
                      <p className="text-sm font-medium mb-2">Preview:</p>
                      <div className="w-full aspect-[21/9] rounded-lg overflow-hidden bg-black/20">
                        <img
                          src={headerImagePreview}
                          alt="Header preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={handleHeaderImageUpload}
                    disabled={!headerImageFile}
                    className="mt-4"
                  >
                    Upload Header Image
                  </Button>
                </div>
              </CardContent>
            </Card>
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