import { Link } from "wouter";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Event, MediaItem } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

interface EventCardProps {
  event: Event;
}

export default function EventCard({ event }: EventCardProps) {
  const eventDate = new Date(event.date);
  const isUpcoming = eventDate >= new Date();

  // Fetch media items for this event to use as fallback thumbnail
  const { data: mediaItems } = useQuery<MediaItem[]>({
    queryKey: [`/api/events/${event.id}/media`],
    enabled: !event.customThumbnail, // Only fetch if no custom thumbnail
  });

  // Get the thumbnail to display
  const thumbnailToShow = event.customThumbnail || 
    (mediaItems && mediaItems.length > 0 ? mediaItems[0].thumbnail : "/attached_assets/%2389_3.png");

  return (
    <Card className="overflow-hidden group hover:shadow-lg transition-shadow bg-black/40 border-primary/20">
      <div className="relative aspect-video overflow-hidden">
        <img
          src={thumbnailToShow}
          alt={event.title}
          className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
        />
        <div className="absolute top-3 right-3">
          <Badge variant={isUpcoming ? "default" : "secondary"} className={isUpcoming ? "bg-primary text-black" : "bg-foreground/10"}>
            {isUpcoming ? "Upcoming" : "Past"}
          </Badge>
        </div>
      </div>
      <CardContent className="pt-6">
        <h3 className="text-xl font-semibold mb-2 line-clamp-2 group-hover:text-primary transition-colors">
          {event.title}
        </h3>
        <p className="text-sm text-foreground/60 mb-4">
          {eventDate.toLocaleDateString(undefined, { 
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}
        </p>
        <p className="line-clamp-2 text-sm text-foreground/80">
          {event.description}
        </p>
      </CardContent>
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