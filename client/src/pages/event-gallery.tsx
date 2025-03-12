import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Event, MediaItem } from "@shared/schema";
import { Loader2, ArrowLeft } from "lucide-react";
import MediaGrid from "@/components/media-grid";

export default function EventGallery() {
  const [, params] = useRoute<{ id: string }>("/events/:id");
  const eventId = parseInt(params?.id || "0");

  const { data: event, isLoading: eventLoading } = useQuery<Event>({
    queryKey: [`/api/events/${eventId}`],
  });

  const { data: mediaItems, isLoading: mediaLoading } = useQuery<MediaItem[]>({
    queryKey: [`/api/events/${eventId}/media`],
    enabled: !!eventId, // Only fetch media when we have an eventId
  });

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
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" asChild className="mb-4">
            <Link href="/">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Events
            </Link>
          </Button>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">{event.title}</h1>
            <p className="text-muted-foreground">
              {new Date(event.date).toLocaleDateString()}
            </p>
            <p className="max-w-2xl">{event.description}</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {!mediaItems?.length ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              No media items available for this event yet.
            </p>
          </div>
        ) : (
          <MediaGrid items={mediaItems} />
        )}
      </main>
    </div>
  );
}