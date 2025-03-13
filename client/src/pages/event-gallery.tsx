import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Event, MediaItem } from "@shared/schema";
import { Loader2, ArrowLeft } from "lucide-react";
import MediaGrid from "@/components/media-grid";
import { useAuth } from "@/hooks/use-auth";
import { AdvancedSearch } from "@/components/advanced-search";

export default function EventGallery() {
  const [, params] = useRoute<{ id: string }>("/events/:id");
  const eventId = parseInt(params?.id || "0");
  const [filteredMediaItems, setFilteredMediaItems] = useState<MediaItem[]>([]);
  const { user } = useAuth();

  // Fetch event data
  const { data: event, isLoading: eventLoading } = useQuery<Event>({
    queryKey: [`/api/events/${eventId}`],
    onSuccess: (data) => {
      console.log('Event loaded:', data);
    }
  });

  // Fetch media items
  const { 
    data: mediaItems = [], 
    isLoading: mediaLoading,
    refetch: refetchMedia
  } = useQuery<MediaItem[]>({
    queryKey: [`/api/events/${eventId}/media`],
    onSuccess: (data) => {
      console.log('Media items loaded:', data.length);
      setFilteredMediaItems(data);
    },
    onError: (error) => {
      console.error('Failed to load media items:', error);
    }
  });

  const handleMediaDelete = async (deletedItemIds: number[]) => {
    await refetchMedia();
  };

  const isLoading = eventLoading || mediaLoading;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1 className="text-2xl font-bold">Event not found</h1>
        <Button asChild>
          <Link href="/">Back to Home</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-primary/20">
        <div className="container mx-auto px-4 py-6">
          <Button variant="ghost" asChild className="mb-4">
            <Link href="/">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Link>
          </Button>
          <div className="space-y-4">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {event.title}
            </h1>
            {event.date && (
              <p className="text-muted-foreground font-[Rajdhani] text-lg">
                {new Date(event.date).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </p>
            )}
            {event.description && (
              <p className="max-w-2xl text-lg">{event.description}</p>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <AdvancedSearch
          items={mediaItems}
          onSearchResults={setFilteredMediaItems}
          className="mb-8"
        />

        {!filteredMediaItems.length ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-lg">
              {mediaItems.length ? "Keine passenden Medien gefunden." : "Noch keine Medien für dieses Event verfügbar."}
            </p>
          </div>
        ) : (
          <MediaGrid items={filteredMediaItems} onDelete={handleMediaDelete} />
        )}
      </main>
    </div>
  );
}