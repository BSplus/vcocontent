import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Event } from "@shared/schema";
import { Loader2, Calendar, ArrowLeft, Clock } from "lucide-react";

export default function UpcomingEventsPage() {
  const { data: events, isLoading } = useQuery<Event[]>({
    queryKey: ["/api/events"]
  });

  const today = new Date();
  
  // Filter and sort upcoming events
  const upcomingEvents = events?.filter(event => 
    new Date(event.date) > today
  ).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) || [];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <Button variant="ghost" asChild className="mb-8">
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Link>
        </Button>

        <div className="flex items-center gap-3 mb-8">
          <Calendar className="h-8 w-8 text-accent" />
          <h1 className="text-4xl font-bold text-accent">Upcoming Events</h1>
        </div>

        {isLoading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !upcomingEvents.length ? (
          <p className="text-center text-foreground/60 py-12">
            No upcoming events scheduled.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {upcomingEvents.map((event) => (
              <div
                key={event.id}
                className="group bg-black/20 rounded-lg p-4 hover:bg-black/30 transition-all hover:scale-[1.02]"
              >
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <h3 className="font-bold truncate group-hover:text-primary transition-colors">
                      {event.title}
                    </h3>
                    <p className="text-sm text-foreground/60">
                      {new Date(event.date).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </p>
                    <p className="text-sm text-foreground/40 line-clamp-2 mt-2">
                      {event.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
