import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Event } from "@shared/schema";
import { Loader2, Trophy, ArrowLeft } from "lucide-react";
import EventCard from "@/components/event-card";
import Footer from "@/components/footer"; // Import Footer component

export default function CurrentEventsPage() {
  const { data: events, isLoading } = useQuery<Event[]>({
    queryKey: ["/api/events"]
  });

  const today = new Date();
  const fourWeeksAgo = new Date(today.getTime() - (28 * 24 * 60 * 60 * 1000));

  // Filter current events (last 4 weeks)
  const currentEvents = events?.filter(event => {
    const eventDate = new Date(event.date);
    return eventDate >= fourWeeksAgo && eventDate <= today;
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) || [];

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-4 py-8"> {/* Added main tag */}
        <Button variant="ghost" asChild className="mb-8">
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Link>
        </Button>

        <div className="flex items-center gap-3 mb-8">
          <Trophy className="h-8 w-8 text-primary" />
          <h1 className="text-4xl font-bold text-primary">Current Events</h1>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : currentEvents.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {currentEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <h2 className="text-2xl font-bold mb-4">No current events</h2>
            <p className="text-muted-foreground">
              Check back soon for upcoming events.
            </p>
          </div>
        )}
      </main>
      <Footer />
    </div>

        {isLoading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !currentEvents.length ? (
          <p className="text-center text-foreground/60 py-12">
            No current events.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {currentEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </main>
      <Footer /> {/* Added Footer component */}
    </div>
  );
}