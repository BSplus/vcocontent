import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Event } from "@shared/schema";
import EventCard from "@/components/event-card";
import { SearchInput } from "@/components/search-input";
import { useSearch } from "@/hooks/use-search";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Calendar, CalendarSearch } from "lucide-react";

export default function CreatorEventsPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  
  // Fetch all events
  const { data: allEvents = [], isLoading } = useQuery<Event[]>({
    queryKey: ["/api/events"],
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to load events: ${error.message}`,
        variant: "destructive",
      });
    },
  });
  
  // Filter to only include creator events
  const creatorEvents = allEvents.filter(event => event.creatorId !== null);
  
  // Setup search
  const { results: filteredEvents } = useSearch(creatorEvents, searchQuery, {
    keys: [
      { name: "title", weight: 2 },
      { name: "description", weight: 1 },
    ],
    threshold: 0.3,
  });

  // Separate events into current and past
  const currentDate = new Date();
  const currentEvents = filteredEvents.filter(
    (event) => new Date(event.date) <= currentDate
  ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Upcoming events (future dates)
  const upcomingEvents = filteredEvents.filter(
    (event) => new Date(event.date) > currentDate
  ).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="container py-6 min-h-screen">
      <h1 className="text-3xl font-bold mb-8 text-center">Creator Events</h1>
      
      <div className="max-w-lg mx-auto mb-8">
        <SearchInput
          items={creatorEvents}
          value={searchQuery}
          onChange={setSearchQuery}
          className="w-full"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="sr-only">Loading events...</span>
        </div>
      ) : (
        <>
          {currentEvents.length > 0 ? (
            <section id="current-events" className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <Calendar className="h-6 w-6 text-accent" />
                <h2 className="text-2xl font-bold text-accent">Current Events</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {currentEvents.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
            </section>
          ) : searchQuery ? (
            <p className="text-center text-lg text-muted-foreground mt-8">
              No matching events found
            </p>
          ) : (
            <p className="text-center text-lg text-muted-foreground mt-8">
              No current events available
            </p>
          )}

          {upcomingEvents.length > 0 && (
            <section id="upcoming-events" className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <CalendarSearch className="h-6 w-6 text-accent" />
                <h2 className="text-2xl font-bold text-accent">Upcoming Events</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {upcomingEvents.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
            </section>
          )}

          {currentEvents.length === 0 && upcomingEvents.length === 0 && !searchQuery && (
            <div className="text-center py-16">
              <p className="text-xl text-muted-foreground">
                No creator events found
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}