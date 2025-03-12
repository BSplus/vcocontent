import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Event, MediaItem } from "@shared/schema";
import { Loader2, ArrowLeft, Search } from "lucide-react";
import MediaGrid from "@/components/media-grid";
import { useState } from "react";

export default function EventGallery() {
  const [, params] = useRoute<{ id: string }>("/events/:id");
  const eventId = parseInt(params?.id || "0");
  const [searchQuery, setSearchQuery] = useState("");
  const [mediaTypeFilter, setMediaTypeFilter] = useState<"all" | "image" | "video">("all");
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);

  // Fetch event data
  const { data: event, isLoading: eventLoading } = useQuery<Event>({
    queryKey: [`/api/events/${eventId}`],
    enabled: !!eventId,
  });

  // Fetch media items
  const { data: fetchedMediaItems, isLoading: mediaLoading } = useQuery<MediaItem[]>({
    queryKey: [`/api/events/${eventId}/media`],
    enabled: !!eventId,
    onSuccess: (data) => setMediaItems(data || []),
  });

  const handleMediaDelete = (deletedItemId: number) => {
    setMediaItems(current => current.filter(item => item.id !== deletedItemId));
  };

  const isLoading = eventLoading || mediaLoading;

  // Filter media items based on search query and type
  const filteredMediaItems = mediaItems?.filter(item => {
    const matchesSearch = !searchQuery || 
      (item.caption?.toLowerCase().includes(searchQuery.toLowerCase()) ||
       item.photographer?.toLowerCase().includes(searchQuery.toLowerCase()) ||
       item.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase())));

    const matchesType = mediaTypeFilter === "all" || item.type === mediaTypeFilter;

    return matchesSearch && matchesType;
  });

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
              Back to Events
            </Link>
          </Button>
          <div className="space-y-4">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {event.title}
            </h1>
            <p className="text-muted-foreground font-[Rajdhani] text-lg">
              {event.date ? new Date(event.date).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              }) : 'Date not available'}
            </p>
            <p className="max-w-2xl text-lg">{event.description}</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by caption, photographer, or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select
            value={mediaTypeFilter}
            onValueChange={(value) => setMediaTypeFilter(value as "all" | "image" | "video")}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Media</SelectItem>
              <SelectItem value="image">Photos Only</SelectItem>
              <SelectItem value="video">Videos Only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!filteredMediaItems?.length ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-lg">
              {mediaItems?.length ? "No matching media items found." : "No media items available for this event yet."}
            </p>
          </div>
        ) : (
          <MediaGrid items={filteredMediaItems} onDelete={handleMediaDelete} />
        )}
      </main>
    </div>
  );
}