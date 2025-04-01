import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Event, MediaItem } from "@shared/schema";
import { Loader2, ArrowLeft, Calendar, Star } from "lucide-react";
import EventCard from "@/components/event-card";
import { useToast } from "@/hooks/use-toast";
import MediaGrid from "@/components/media-grid";

export default function CreatorProfile() {
  const [, params] = useRoute<{ id: string }>("/creator/:id");
  const creatorId = parseInt(params?.id || "0");
  const { toast } = useToast();
  
  // Fetch creator information
  const { data: creator, isLoading: creatorLoading } = useQuery<{username: string, id: number, isCreator: boolean, bio: string | null, profileImage: string | null}>({
    queryKey: [`/api/users/${creatorId}`],
    enabled: Boolean(creatorId && creatorId > 0),
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to load creator info: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Fetch all creator events
  const { data: creatorEvents = [], isLoading: eventsLoading } = useQuery<Event[]>({
    queryKey: [`/api/events/creator/${creatorId}`],
    enabled: Boolean(creatorId && creatorId > 0),
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to load creator events: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Fetch top media items from this creator
  const { data: topMediaItems = [], isLoading: mediaLoading } = useQuery<MediaItem[]>({
    queryKey: [`/api/media/top/creator/${creatorId}`],
    enabled: Boolean(creatorId && creatorId > 0),
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to load top media: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const isLoading = creatorLoading || eventsLoading || mediaLoading;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!creator) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1 className="text-2xl font-bold">Creator not found</h1>
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
              Back to Home
            </Link>
          </Button>
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            {creator.profileImage && (
              <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-primary">
                <img
                  src={creator.profileImage}
                  alt={creator.username}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                {creator.username}
              </h1>
              {creator.bio && (
                <p className="mt-2 text-muted-foreground max-w-2xl">
                  {creator.bio}
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Creator Events */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <Calendar className="h-6 w-6 text-accent" />
            <h2 className="text-2xl font-bold text-accent">Events by {creator.username}</h2>
          </div>
          
          {creatorEvents.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {creatorEvents.map(event => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-10">
              No events found for this creator.
            </p>
          )}
        </section>

        {/* Popular Media */}
        {topMediaItems.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-6">
              <Star className="h-6 w-6 text-accent" />
              <h2 className="text-2xl font-bold text-accent">Popular Media by {creator.username}</h2>
            </div>
            <MediaGrid items={topMediaItems} />
          </section>
        )}
      </main>
    </div>
  );
}