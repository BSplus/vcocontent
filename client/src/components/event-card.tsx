import { Link } from "wouter";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Event, MediaItem, Series, User } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { User as UserIcon } from "lucide-react";

interface EventCardProps {
  event: Event;
}

export default function EventCard({ event }: EventCardProps) {
  const eventDate = event.date ? new Date(event.date) : null;
  const isUpcoming = eventDate ? eventDate >= new Date() : false;
  const isCreatorEvent = !!event.creatorId;

  // Fetch media items for this event to use as fallback thumbnail
  const { data: mediaItems } = useQuery<MediaItem[]>({
    queryKey: [`/api/events/${event.id}/media`],
  });

  // Fetch series data if the event belongs to a series
  const { data: series } = useQuery<Series>({
    queryKey: [`/api/series/${event.seriesId}`],
    enabled: !!event.seriesId,
  });
  
  // Fetch creator data if this is a creator event
  const { data: creator } = useQuery<{username: string, id: number, isCreator: boolean}>({
    queryKey: [`/api/users/${event.creatorId}`],
    enabled: isCreatorEvent,
  });

  // Get thumbnail URL - custom thumbnail, first media item, or fallback
  const thumbnailUrl = event.customThumbnail || 
    (mediaItems?.find(item => item.type === "image")?.thumbnail) || 
    "/attached_assets/%2389_3.png";

  const cardContent = (
    <>
      <div className="relative aspect-video overflow-hidden">
        <img
          src={thumbnailUrl}
          alt={event.title}
          className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
        />
        <div className="absolute top-3 right-3 flex flex-col gap-2">
          {isUpcoming && (
            <Badge className="bg-primary text-black">
              Upcoming
            </Badge>
          )}
          {isCreatorEvent && creator && (
            <Badge className="bg-accent text-black flex items-center gap-1" variant="outline">
              <UserIcon className="h-3 w-3" />
              <span>By {creator.username}</span>
            </Badge>
          )}
        </div>
        {series?.logo && (
          <div className="absolute top-3 left-3 h-8">
            <img
              src={series.logo}
              alt={series.name}
              className="h-full w-auto object-contain"
              title={series.name}
            />
          </div>
        )}
      </div>
      <CardContent className="pt-6 flex-grow">
        <h3 className="text-xl font-semibold mb-2 line-clamp-1 group-hover:text-primary transition-colors">
          {event.title}
        </h3>
        <p className="text-sm text-foreground/60 mb-4">
          {eventDate ? eventDate.toLocaleDateString('en-US', { 
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }) : 'Date not available'}
        </p>
        <p className="line-clamp-2 text-sm text-foreground/80">
          {event.description}
        </p>
      </CardContent>
    </>
  );

  return (
    <Card className="overflow-hidden group hover:shadow-lg transition-shadow bg-black/40 border-primary/20 h-full flex flex-col">
      {!isUpcoming ? (
        <Link href={`/events/${event.id}`} className="flex-grow cursor-pointer">
          {cardContent}
        </Link>
      ) : (
        cardContent
      )}
      {!isUpcoming && (
        <CardFooter>
          <Button asChild className="w-full bg-primary text-black hover:bg-primary/90">
            <Link href={`/events/${event.id}`}>View Gallery</Link>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}