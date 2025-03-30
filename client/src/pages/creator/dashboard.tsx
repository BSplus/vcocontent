import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Event, MediaItem } from "@shared/schema";
import { ArrowLeft, Loader2, Plus, Image as ImageIcon, Film, CreditCard } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import UploadModal from "@/components/upload-modal";
import MediaUploadModal from "@/components/media-upload-modal";
import { useToast } from "@/hooks/use-toast";

export default function CreatorDashboard() {
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [mediaUploadModalOpen, setMediaUploadModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Load creator's events
  const { data: events = [], isLoading: eventsLoading } = useQuery<Event[]>({
    queryKey: ["/api/creator/events"],
    staleTime: 0,
  });

  // Load all media items to calculate stats
  const { data: mediaItems = [], isLoading: mediaLoading } = useQuery<MediaItem[]>({
    queryKey: ["/api/media"],
    staleTime: 0,
  });

  // Load creator earnings
  const { data: earnings = { totalCredits: 0, totalDownloads: 0 }, isLoading: earningsLoading } = useQuery({
    queryKey: ["/api/creator/earnings"],
    staleTime: 0,
  });

  const getEventStats = (eventId: number) => {
    const eventMedia = mediaItems.filter((item) => item.eventId === eventId);
    const photos = eventMedia.filter((item) => item.type === "image");
    const videos = eventMedia.filter((item) => item.type === "video");

    return {
      photos: photos.length,
      videos: videos.length,
      premiumCount: eventMedia.filter(item => item.isPremium).length,
      totalDownloads: eventMedia.reduce((sum, item) => sum + (item.downloadCount || 0), 0),
      totalEarnings: eventMedia.reduce((sum, item) => {
        if (item.isPremium && item.downloadCount && item.creditCost) {
          return sum + (item.downloadCount * item.creditCost * 0.7); // Creators get 70% of credits
        }
        return sum;
      }, 0)
    };
  };

  const sortedEvents = [...events].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  if (eventsLoading || mediaLoading || earningsLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-primary/20">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            CREATOR DASHBOARD
          </h1>
          <div className="flex gap-2 mt-4">
            <Button asChild variant="outline">
              <Link href="/">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Home
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="events">
          <TabsList>
            <TabsTrigger value="events">My Events</TabsTrigger>
            <TabsTrigger value="earnings">Earnings & Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="mt-6">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold">My Events</h2>
              <Button
                onClick={() => {
                  console.log("Create New Event button clicked");
                  console.log("Current uploadModalOpen state:", uploadModalOpen);
                  setUploadModalOpen(true);
                  console.log("New uploadModalOpen state should be true");
                }}
                className="bg-primary text-black hover:bg-primary/90"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create New Event
              </Button>
            </div>

            {!sortedEvents.length ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-muted-foreground mb-4">
                    No events created yet.
                  </p>
                  <Button onClick={() => setUploadModalOpen(true)}>
                    Create Your First Event
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-6">
                {sortedEvents.map((event) => {
                  const stats = getEventStats(event.id);
                  return (
                    <Card key={event.id} className="bg-black/40 border-primary/20">
                      <CardHeader>
                        <CardTitle className="text-xl font-[Orbitron] tracking-wider">
                          {event.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary" className="flex gap-2 items-center">
                              <ImageIcon className="h-3 w-3" />
                              {stats.photos} Photos
                            </Badge>
                            <Badge variant="secondary" className="flex gap-2 items-center">
                              <Film className="h-3 w-3" />
                              {stats.videos} Videos
                            </Badge>
                            <Badge variant="outline" className="flex gap-2 items-center">
                              {stats.premiumCount} Premium Items
                            </Badge>
                            <Badge variant="outline" className="flex gap-2 items-center">
                              {stats.totalDownloads} Downloads
                            </Badge>
                            <Badge variant="outline" className="flex gap-2 items-center">
                              <CreditCard className="h-3 w-3" />
                              {stats.totalEarnings} Credits Earned
                            </Badge>
                          </div>

                          <div className="flex justify-between items-center">
                            <p className="text-muted-foreground font-[Rajdhani]">
                              {new Date(event.date).toLocaleDateString()}
                            </p>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setSelectedEventId(event.id);
                                  setUploadModalOpen(true);
                                }}
                              >
                                Edit Event
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setSelectedEventId(event.id);
                                  setMediaUploadModalOpen(true);
                                }}
                              >
                                Upload Media
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="earnings" className="mt-6">
            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Total Earnings</CardTitle>
                  <CardDescription>Your earnings from premium content</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-4xl font-bold">
                    {earnings.totalCredits} Credits
                  </div>
                  <p className="text-muted-foreground mt-2">
                    From {earnings.totalDownloads} premium downloads
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Event Performance</CardTitle>
                  <CardDescription>Analytics for your events</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {sortedEvents.map(event => {
                      const stats = getEventStats(event.id);
                      return (
                        <div key={event.id} className="flex justify-between items-center pb-4 border-b border-border last:border-0">
                          <div>
                            <h3 className="font-medium">{event.title}</h3>
                            <p className="text-sm text-muted-foreground">
                              {new Date(event.date).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium">{stats.totalEarnings} Credits</p>
                            <p className="text-sm text-muted-foreground">
                              {stats.totalDownloads} Downloads
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <UploadModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        eventId={selectedEventId}
      />

      {selectedEventId && (
        <MediaUploadModal
          open={mediaUploadModalOpen}
          onOpenChange={setMediaUploadModalOpen}
          eventId={selectedEventId}
        />
      )}
    </div>
  );
}