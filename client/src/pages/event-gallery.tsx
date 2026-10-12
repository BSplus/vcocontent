import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Event, MediaItem } from "@shared/schema";
import { Loader2, ArrowLeft } from "lucide-react";
import MediaGrid from "@/components/media-grid";
import { useAuth } from "@/hooks/use-auth";
import MainNavigation from "@/components/main-navigation";
import Footer from "@/components/footer";
import EventTitle from "@/components/event-title";
import { formatDate } from "@/lib/utils";
import CommunityActions from "@/components/community-actions";
import { ShareMenu } from "@/components/share-menu";
import CommunityGalleries from "@/components/community-galleries";
import CreatorIdentity, { type PublicCreator } from "@/components/creator-identity";
import type { PageEnvelope } from "@shared/pagination";
import PageStatus from "@/components/page-status";
import { usePageState } from "@/hooks/use-page-state";

export default function EventGallery() {
  const [, params] = useRoute<{ id: string }>("/events/:id");
  const eventId = parseInt(params?.id || "0");
  const { user } = useAuth();
  const [page, setPage] = usePageState(`${user?.id}:${eventId}`);

  // Fetch event data
  const { data: event, isLoading: eventLoading } = useQuery<Event>({
    queryKey: [`/api/events/${eventId}`],
    enabled: Boolean(eventId && eventId > 0),
  });
  
  // Fetch creator data if this is a creator event
  const { data: creator } = useQuery<PublicCreator>({
    queryKey: [`/api/users/${event?.creatorId}`, user?.id ?? "signed-out"],
    enabled: Boolean(event?.creatorId),
  });

  // Fetch media items
  const { 
    data: mediaData,
    isLoading: mediaLoading,
    isFetching: mediaFetching,
    isError: mediaError,
    refetch: refetchMedia
  } = useQuery<PageEnvelope<MediaItem>>({
    queryKey: [`/api/events/${eventId}/media?page=${page}&pagination=true`, user?.id ?? "signed-out"],
    enabled: Boolean(eventId && eventId > 0),
  });
  const mediaItems = mediaData?.items ?? [];
  useEffect(() => {
    if (!mediaFetching && !mediaError && mediaData) setPage(mediaData.page);
  }, [mediaData, mediaFetching, mediaError, setPage]);

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
              <EventTitle title={event.title} />
            </h1>
            
            {event.creatorId && creator && (
              <div className="mt-2 inline-flex min-h-10 items-center border border-accent/40 bg-accent/10 px-3 text-sm font-semibold text-accent"><span className="mr-1">By</span><CreatorIdentity creator={creator} /></div>
            )}
            
            {event.date && (
              <p className="text-muted-foreground text-lg">
                {formatDate(event.date)}
              </p>
            )}
            {event.description && (
              <p className="max-w-2xl text-lg">{event.description}</p>
            )}
            <CommunityActions kind="event" id={event.id} title={event.title} />
            <ShareMenu url={`${window.location.origin}/events/${event.id}`} title={event.title} />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h2 className="text-xl md:text-2xl font-semibold">Media <PageStatus page={mediaData?.page ?? page} totalPages={!mediaFetching && !mediaError ? mediaData?.totalPages : undefined} /></h2>
          <p className="text-sm text-foreground/75 mt-2">Open a photo or video, use the arrow keys to browse, and choose an available download.</p>
        </div>
        {mediaError ? <div role="alert"><p>Could not load event media.</p><Button variant="outline" onClick={() => void refetchMedia()}>Try again</Button></div> : !mediaItems.length ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-lg">
              No media available for this event yet.
            </p>
          </div>
        ) : (
          <>
            <MediaGrid items={mediaItems} onDelete={handleMediaDelete} />
             <div className="flex flex-wrap justify-center gap-3 mt-8">
               <Button variant="outline" disabled={mediaFetching || mediaData?.page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
               <PageStatus className="self-center" page={mediaData?.page ?? page} totalPages={!mediaFetching ? mediaData?.totalPages : undefined} />
               <Button variant="outline" disabled={mediaFetching || !mediaData?.hasMore} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </>
        )}
        {!event.creatorId && <CommunityGalleries officialEventId={event.id} />}
      </main>
      <Footer />
    </div>
  );
}