import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Event, MediaItem } from "@shared/schema";
import { Loader2, ArrowLeft, User as UserIcon } from "lucide-react";
import MediaGrid from "@/components/media-grid";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import MainNavigation from "@/components/main-navigation";
import Footer from "@/components/footer";

export default function EventGallery() {
  const [, params] = useRoute<{ id: string }>("/events/:id");
  const eventId = parseInt(params?.id || "0");
  const { user } = useAuth();

  // Fetch event data
  const { data: event, isLoading: eventLoading } = useQuery<Event>({
    queryKey: [`/api/events/${eventId}`],
    enabled: Boolean(eventId && eventId > 0),
  });
  
  // Fetch creator data if this is a creator event
  const { data: creator } = useQuery<{username: string, id: number, isCreator: boolean}>({
    queryKey: [`/api/users/${event?.creatorId}`],
    enabled: Boolean(event?.creatorId),
  });

  // Fetch media items
  const { 
    data: mediaItems = [], 
    isLoading: mediaLoading,
    refetch: refetchMedia
  } = useQuery<MediaItem[]>({
    queryKey: [`/api/events/${eventId}/media`],
    enabled: Boolean(eventId && eventId > 0),
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
      <MainNavigation />
      <header className="border-b border-primary/20">
        <div className="container mx-auto px-4 py-8">
          <Button variant="ghost" asChild className="mb-4">
            <Link href="/">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Link>
          </Button>
          <div className="space-y-4">
            <p className="text-sm uppercase tracking-widest text-primary">Event gallery</p>
            <h1 className="text-2xl md:text-4xl font-bold text-foreground break-words">
              {event.title}
            </h1>
            
            {event.creatorId && creator && (
              <Link href={`/creator/${creator.id}`} className="inline-block mt-2 mb-1">
                <Badge className="bg-accent text-black text-sm px-3 py-1 flex items-center gap-2 hover:bg-accent/80 transition-colors cursor-pointer">
                  <UserIcon className="h-3 w-3" />
                  <span>By {creator.username}</span>
                </Badge>
              </Link>
            )}
            
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
        <div className="mb-6">
          <h2 className="text-xl md:text-2xl font-semibold">Media <span className="text-foreground/70">({mediaItems.length})</span></h2>
          <p className="text-sm text-foreground/75 mt-2">Open a photo or video, use the arrow keys to browse, and choose an available download.</p>
        </div>
        {!mediaItems.length ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-lg">
              Noch keine Medien für dieses Event verfügbar.
            </p>
          </div>
        ) : (
          <MediaGrid items={mediaItems} onDelete={handleMediaDelete} />
        )}
      </main>
      <Footer />
    </div>
  );
}