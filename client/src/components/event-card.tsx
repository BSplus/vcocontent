import { Link } from "wouter";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Event, MediaItem, Series } from "@shared/schema";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";

interface EventCardProps {
  event: Event;
}

export default function EventCard({ event }: EventCardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const eventDate = new Date(event.date);
  const isUpcoming = eventDate >= new Date();

  // Fetch media items for this event to use as fallback thumbnail
  const { data: mediaItems } = useQuery<MediaItem[]>({
    queryKey: [`/api/events/${event.id}/media`],
  });

  // Fetch series data if the event belongs to a series
  const { data: series } = useQuery<Series>({
    queryKey: [`/api/series/${event.seriesId}`],
    enabled: !!event.seriesId,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (eventId: number) => {
      const res = await apiRequest("DELETE", `/api/events/${eventId}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to delete event');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({
        title: "Success",
        description: "Event deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Get the thumbnail to display
  const thumbnailToShow = event.customThumbnail || 
    (mediaItems && mediaItems.length > 0 ? mediaItems[0].thumbnail : "/attached_assets/%2389_3.png");

  return (
    <>
      <Card className="overflow-hidden group hover:shadow-lg transition-shadow bg-black/40 border-primary/20 h-full flex flex-col">
        <div className="relative aspect-video overflow-hidden">
          <img
            src={thumbnailToShow}
            alt={event.title}
            className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
          />
          <div className="absolute top-3 right-3 flex gap-2">
            {user?.isAdmin && (
              <Button
                variant="destructive"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.preventDefault();
                  setShowDeleteDialog(true);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Badge variant={isUpcoming ? "default" : "secondary"} className={isUpcoming ? "bg-primary text-black" : "bg-foreground/10"}>
              {isUpcoming ? "Upcoming" : "Past"}
            </Badge>
          </div>
          {series && (
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
            {eventDate.toLocaleDateString('en-US', { 
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this event? This will also delete all associated media items. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => {
                deleteMutation.mutateAsync(event.id);
                setShowDeleteDialog(false);
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}