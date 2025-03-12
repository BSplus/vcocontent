import { Link } from "wouter";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Event } from "@shared/schema";

interface EventCardProps {
  event: Event;
}

export default function EventCard({ event }: EventCardProps) {
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video">
        <img
          src={event.coverImage || "/attached_assets/%2389_3.png"}
          alt={event.title}
          className="object-cover w-full h-full"
        />
      </div>
      <CardContent className="pt-6">
        <h3 className="text-xl font-semibold mb-2">{event.title}</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {new Date(event.date).toLocaleDateString()}
        </p>
        <p className="line-clamp-2 text-sm">{event.description}</p>
      </CardContent>
      <CardFooter>
        <Button asChild className="w-full">
          <Link href={`/events/${event.id}`}>View Gallery</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}