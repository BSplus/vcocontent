import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Event } from "@shared/schema";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
        const res = await apiRequest("DELETE", `/api/events/${eventId}`);
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to delete event");
        }
        return res.json();
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
      setEventToDelete(null); // Reset the state after successful deletion
    },
    onError: (error: Error) => {
      console.error('Delete mutation error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete event",
        variant: "destructive",
      });
      setEventToDelete(null); // Reset the state even on error
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
      // Error is handled in mutation's onError callback
    }
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
                {sortedEvents.map((event) => (
                  <Card key={event.id} className="bg-black/40 border-primary/20">
                    <CardHeader>
                      <CardTitle className="text-xl font-[Orbitron] tracking-wider">
                        {event.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
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
                    </CardContent>
                  </Card>
                ))}
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