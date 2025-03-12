import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import EventCard from "@/components/event-card";
import { Event } from "@shared/schema";
import { Loader2, Calendar } from "lucide-react";

export default function HomePage() {
  const { user, logoutMutation } = useAuth();
  const { data: events, isLoading } = useQuery<Event[]>({ 
    queryKey: ["/api/events"]
  });

  const today = new Date();
  const upcomingEvents = events?.filter(event => new Date(event.date) >= today) || [];
  const pastEvents = events?.filter(event => new Date(event.date) < today) || [];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-8">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-transparent bg-clip-text">
              VCO Media Database
            </h1>
            <nav className="hidden md:flex gap-6">
              <Link href="/" className="text-sm font-medium hover:text-blue-600 transition-colors">
                Home
              </Link>
              <Link href="#upcoming" className="text-sm font-medium hover:text-blue-600 transition-colors">
                Upcoming Events
              </Link>
              <Link href="#past" className="text-sm font-medium hover:text-blue-600 transition-colors">
                Past Events
              </Link>
            </nav>
          </div>
          <div className="flex gap-4 items-center">
            {user?.isAdmin && (
              <Button variant="outline" asChild>
                <Link href="/admin">Admin Dashboard</Link>
              </Button>
            )}
            {user ? (
              <Button 
                variant="secondary" 
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                {logoutMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Logout'
                )}
              </Button>
            ) : (
              <Button asChild>
                <Link href="/auth">Login</Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-12">
        {isLoading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <>
            <section id="upcoming">
              <div className="flex items-center gap-3 mb-6">
                <Calendar className="h-6 w-6 text-blue-600" />
                <h2 className="text-2xl font-bold">Upcoming Events</h2>
              </div>
              {!upcomingEvents.length ? (
                <p className="text-center text-muted-foreground py-12">
                  No upcoming events scheduled.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {upcomingEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              )}
            </section>

            <section id="past">
              <div className="flex items-center gap-3 mb-6">
                <Calendar className="h-6 w-6 text-gray-600" />
                <h2 className="text-2xl font-bold">Past Events</h2>
              </div>
              {!pastEvents.length ? (
                <p className="text-center text-muted-foreground py-12">
                  No past events available.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {pastEvents.map((event) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}