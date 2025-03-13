import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Event, type MediaItem } from "@shared/schema";
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

// Hauptkomponente des Admin-Dashboards
export default function AdminDashboard() {
  // Status-Verwaltung für verschiedene Modals und Auswahlen
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [mediaUploadModalOpen, setMediaUploadModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Laden aller Events aus der Datenbank
  const { 
    data: events = [], 
    isLoading: eventsLoading 
  } = useQuery<Event[]>({
    queryKey: ["/api/events"]
  });

  // Sortieren der Events nach Datum (neueste zuerst)
  const sortedEvents = [...(events || [])].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Funktion zum Löschen eines Events
  const deleteMutation = useMutation({
    mutationFn: async (eventId: number) => {
      const res = await apiRequest("DELETE", `/api/events/${eventId}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete event");
      }
      return eventId;
    },
    onSuccess: () => {
      // Aktualisieren der Daten nach erfolgreichem Löschen
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      toast({
        title: "Erfolg",
        description: "Event wurde erfolgreich gelöscht",
      });
      setEventToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Fehler",
        description: error.message || "Fehler beim Löschen des Events",
        variant: "destructive",
      });
      setEventToDelete(null);
    },
  });

  // Funktion zum Erstellen von Demo-Inhalten
  const handleCreateDemoContent = async () => {
    try {
      await createDemoContent();
      toast({
        title: "Erfolg",
        description: "Demo-Inhalte wurden erfolgreich erstellt",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Fehler beim Erstellen der Demo-Inhalte",
        variant: "destructive",
      });
    }
  };

  // Funktion zum Löschen eines Events
  const handleDeleteEvent = async (event: Event) => {
    if (!event?.id) return;
    await deleteMutation.mutateAsync(event.id);
  };

  // Laden aller Medienelemente
  const { 
    data: allMediaItems = [], 
    isLoading: mediaLoading 
  } = useQuery<MediaItem[]>({
    queryKey: ["/api/media"]
  });

  // Berechnung der Statistiken für jedes Event
  const getEventStats = (eventId: number) => {
    const eventMedia = (allMediaItems || []).filter(item => item.eventId === eventId);
    return {
      photos: eventMedia.filter(item => item.type === "image").length,
      videos: eventMedia.filter(item => item.type === "video").length,
      totalMedia: eventMedia.length,
      downloads: 0 // Wird später implementiert
    };
  };

  // Ladezustand überprüfen
  const isLoading = eventsLoading || mediaLoading;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Hauptansicht des Dashboards
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-primary/20">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Admin Dashboard
          </h1>
          <div className="flex gap-2 mt-4">
            <Button onClick={handleCreateDemoContent} variant="outline">
              Demo-Inhalte erstellen
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Zurück zur Startseite</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="events">
          <TabsList>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="series">Rennserien</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="mt-6">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold">Event-Verwaltung</h2>
              <Button
                onClick={() => setUploadModalOpen(true)}
                className="bg-primary text-black hover:bg-primary/90"
              >
                <Plus className="h-4 w-4 mr-2" />
                Event erstellen
              </Button>
            </div>

            {!sortedEvents.length ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-muted-foreground mb-4">
                    Noch keine Events erstellt.
                  </p>
                  <Button onClick={() => setUploadModalOpen(true)}>
                    Erstes Event erstellen
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
                              {stats.photos} Fotos
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
                              {event.date ? new Date(event.date).toLocaleDateString('de-DE', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                              }) : 'Datum nicht verfügbar'}
                            </p>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setSelectedEventId(event.id);
                                  setUploadModalOpen(true);
                                }}
                              >
                                Event bearbeiten
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setSelectedEventId(event.id);
                                  setMediaUploadModalOpen(true);
                                }}
                              >
                                Medien hochladen
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

      {/* Modals für Event-Verwaltung */}
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

      {/* Bestätigungsdialog für das Löschen */}
      <AlertDialog
        open={!!eventToDelete}
        onOpenChange={(open) => !open && setEventToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Event löschen</AlertDialogTitle>
            <AlertDialogDescription>
              Sind Sie sicher, dass Sie dieses Event löschen möchten? 
              Dies wird auch alle zugehörigen Medien löschen. 
              Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => eventToDelete && handleDeleteEvent(eventToDelete)}
            >
              {deleteMutation.isPending ? "Wird gelöscht..." : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}