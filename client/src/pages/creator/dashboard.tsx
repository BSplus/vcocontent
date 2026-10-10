import { formatDate } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Event, MediaItem } from "@shared/schema";
import { 
  ArrowLeft, Loader2, Plus, Edit, Eye, PenLine
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import UploadModal from "@/components/upload-modal";
import MediaUploadModal from "@/components/media-upload-modal";
import EditMediaModal from "@/components/edit-media-modal";
import EventTitle from "@/components/event-title";
import DashboardEventList from "@/components/dashboard-event-list";

export default function CreatorDashboard() {
  const queryClient = useQueryClient();
  const {user} = useAuth();
  const { toast } = useToast();
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [mediaUploadModalOpen, setMediaUploadModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [selectedMediaItem, setSelectedMediaItem] = useState<MediaItem | null>(null);
  const [editMediaModalOpen, setEditMediaModalOpen] = useState(false);
  const editMediaOpener = useRef<HTMLButtonElement | null>(null);
  const [activeTab, setActiveTab] = useState<"events" | "media" | "analytics">("events");
  const [eventSearch, setEventSearch] = useState("");

  // Load creator's events
  const { data: events = [], isLoading: eventsLoading, error: eventsError } = useQuery<Event[]>({
    queryKey: ["/api/creator/events"],
    staleTime: 0,
  });

  // Load all media items to calculate stats
  const { data: mediaItems = [], isLoading: mediaLoading, error: mediaError } = useQuery<MediaItem[]>({
    queryKey: ["/api/creator/media"],
    staleTime: 0,
  });
  const { data: usage, isLoading: usageLoading, error: usageError, refetch: retryUsage } = useQuery<{
    bytes: number; galleries: number; photos: number; unknown: number; pendingCleanup: number;
    limits: { bytes: number; galleries: number; photos: number; imageBytes: number };
    exception: boolean; adminExempt:boolean;
    eventStats: {eventId:number;photos:number;videos:number;downloads:number}[];
  }>({ queryKey: ["/api/creator/usage"] });
  const publishMutation = useMutation({
    mutationFn: async ({ id, published }: { id: number; published: boolean }) =>
      (await apiRequest("POST", `/api/events/${id}/publish`, { published })).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/creator/events"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Gallery updated", description: "Visibility changes have been saved." });
    },
    onError: (error: Error) => toast({ title: "Could not update gallery", description: error.message, variant: "destructive" }),
  });
  const safetyRetry = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/media/${id}/safety/retry`)).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/creator/media"] });
      toast({ title: "Safety status updated",description:"Photos remain private until their current safety check is approved." });
    },
    onError: (error: Error) => toast({ title: "Retry unavailable", description: error.message, variant: "destructive" }),
  });
  const [mediaPage, setMediaPage] = useState(1);
  useEffect(() => setMediaPage(1), [selectedEventId]);
  const { data: eventMediaItems = [] } = useQuery<MediaItem[]>({
    queryKey: [`/api/events/${selectedEventId}/media?page=${mediaPage}`],
    enabled: !!selectedEventId,
    refetchInterval:activeTab==="media"?5000:false,
  });

  const getEventStats = (eventId: number) => {
    const stats=usage?.eventStats?.find(row=>row.eventId===eventId);
    return {
      photos: stats?.photos??0,
      videos: stats?.videos??0,
      totalDownloads: stats?.downloads??"—",
    };
  };

  const sortedEvents = [...events].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  if (eventsLoading || mediaLoading || usageLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  if (eventsError || mediaError) {
    return <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p>Creator data could not be loaded.</p>
      <Button onClick={() => window.location.reload()}>Seite neu laden</Button>
    </div>;
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
        {!user?.emailVerifiedAt && (
          <Card className="mb-6"><CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
            <p className="text-sm">Verify your email before publishing new community photos or galleries. Existing content is unchanged.</p>
            <Button asChild variant="outline"><Link href="/creator/apply">Verify email</Link></Button>
          </CardContent></Card>
        )}
        <Card className="mb-6">
          <CardHeader><CardTitle>Public beta usage</CardTitle><CardDescription>Your community-photo allowance</CardDescription></CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
            <p>Storage <strong>{usage ? `${usage.unknown ? "At least " : ""}${(usage.bytes / 1000000).toFixed(1)} MB${usage.adminExempt?" (admin-managed)":` / ${(usage.limits.bytes / 1000000).toFixed(0)} MB`}` : "—"}</strong></p>
            <p>Galleries <strong>{usage ? `${usage.galleries}${usage.adminExempt?"":` / ${usage.limits.galleries}`}` : "—"}</strong></p>
            <p>Photos <strong>{usage ? `${usage.photos}${usage.adminExempt?"":` / ${usage.limits.photos}`}` : "—"}</strong></p>
            {!!usage?.unknown && <p role="alert" className="sm:col-span-3">Some file sizes are not yet confirmed. Wait for pending cleanup or ask an administrator to measure historical files. Existing content remains available.</p>}
            {!!usage?.pendingCleanup && <p role="status" className="sm:col-span-3">Files awaiting cleanup remain included in storage until their removal is confirmed.</p>}
            <p className="sm:col-span-3 text-muted-foreground">Photos only · up to {(usage?.limits.imageBytes ?? 5000000) / 1000000} MB per photo. Video uploads are unavailable in the public beta.</p>
            {usage?.exception && <p className="sm:col-span-3 rounded border border-primary/30 bg-primary/5 p-3 text-sm">A bounded 2× quota exception is enabled: up to 1 GB, 10 galleries and 2,000 photos. The 5 MB per-photo limit is unchanged; this is not unlimited storage.</p>}
            {usageError && <div role="alert" className="sm:col-span-3 flex flex-wrap items-center gap-2"><span>Usage details are temporarily unavailable.</span><Button size="sm" variant="outline" onClick={() => void retryUsage()}>Retry</Button></div>}
          </CardContent>
        </Card>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "events" | "media" | "analytics")}>
          <TabsList>
            <TabsTrigger value="events">My Events</TabsTrigger>
            <TabsTrigger value="media">My Media</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="mt-6">
             <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
              <h2 className="text-2xl font-bold">My Events</h2>
              <Button
                onClick={() => {
                  setSelectedEventId(null);
                  setUploadModalOpen(true);
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
               <>
                 <label htmlFor="creator-event-search" className="mb-2 block text-sm font-medium">Search events by title</label>
                 <Input id="creator-event-search" type="search" value={eventSearch} onChange={e => setEventSearch(e.target.value)} placeholder="Search events..." className="mb-6 max-w-md" />
                 <DashboardEventList title="My Events" events={sortedEvents} mediaItems={mediaItems} eventCounts={usage?.eventStats?new Map(usage.eventStats.map(row=>[row.eventId,row])):undefined} search={eventSearch} emptyMessage="No events created yet." actions={event => (
                   <>
                     <Button size="sm" variant="outline" onClick={() => { setSelectedEventId(event.id); setUploadModalOpen(true); }}><Edit className="mr-1 h-4 w-4" />Edit Event</Button>
                     <Button size="sm" variant="secondary" onClick={() => { setSelectedEventId(event.id); setMediaUploadModalOpen(true); }}><Plus className="mr-1 h-4 w-4" />Upload Media</Button>
                     <Button size="sm" variant="outline" onClick={() => { setSelectedEventId(event.id); setActiveTab("media"); }}><Eye className="mr-1 h-4 w-4" />Manage Media</Button>
                      <Button size="sm" variant="outline" disabled={publishMutation.isPending || (event as Event & { adminHidden?: boolean }).adminHidden}
                        onClick={() => publishMutation.mutate({ id: event.id, published: (event as Event & { visibility?: string }).visibility !== "published" })}>
                        {(event as Event & { visibility?: string }).visibility === "published" ? "Unpublish" : "Publish"}
                      </Button>
                   </>
                 )} />
               </>
             )}
          </TabsContent>

          <TabsContent value="media" className="mt-6">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-2xl font-bold">My Media</h2>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-end">
                {sortedEvents.length > 0 && (
                  <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium sm:w-64">
                    <span>Select event</span>
                    <select
                      className="h-11 w-full min-w-0 rounded border border-border bg-background px-3 text-foreground"
                      onChange={(e) => {
                        const id = parseInt(e.target.value);
                        if (!isNaN(id)) {
                          setSelectedEventId(id);
                        } else {
                          setSelectedEventId(null);
                        }
                      }}
                      value={selectedEventId || ""}
                    >
                      <option value="">Choose an event…</option>
                      {sortedEvents.map(event => (
                        <option key={event.id} value={event.id}>{event.title}</option>
                      ))}
                    </select>
                  </label>
                )}
                {selectedEventId && (
                  <Button
                    onClick={() => setMediaUploadModalOpen(true)}
                    className="min-h-11 shrink-0 bg-primary text-black hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Upload Media
                  </Button>
                )}
              </div>
            </div>
            
            {!selectedEventId ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-muted-foreground mb-4">
                    Please select an event to view its media
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Display media items for selected event */}
                {(() => {
                  const event = events.find(e => e.id === selectedEventId);
                  
                  if (eventMediaItems.length === 0) {
                    return (
                      <Card>
                        <CardContent className="flex flex-col items-center justify-center py-12">
                          <p className="text-muted-foreground mb-4">
                            No media uploaded for this event yet
                          </p>
                          <Button onClick={() => setMediaUploadModalOpen(true)}>
                            Upload Media
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  }
                  
                  return (
                    <div>
                      <h3 className="text-lg font-semibold mb-4">
                        Media for: {event?.title}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {eventMediaItems.map((item) => (
                          <Card key={item.id} className="overflow-hidden group">
                            <div className="relative aspect-video">
                              <img 
                                src={item.thumbnail} 
                                alt={item.caption || "Media thumbnail"} 
                                className="object-cover w-full h-full"
                              />
                            </div>
                            <CardContent className="p-3">
                              <p className="text-sm truncate">{item.caption || "No caption"}</p>
                              <p className="mt-1 text-xs text-muted-foreground">Safety: {item.safetyStatus==="legacy" ? "Historical — not reviewed" : (item.safetyStatus==="approved" || item.safetyStatus==="review") && (item as MediaItem & {safetyRetryAllowed?:boolean}).safetyRetryAllowed ? "New safety check required" : item.safetyStatus || "pending"}</p>
                              {item.safetyReason && <p className="mt-1 text-xs text-muted-foreground">{item.safetyReason}</p>}
                              {(item.safetyStatus === "error" || (item as MediaItem & {safetyRetryAllowed?:boolean}).safetyRetryAllowed) && <Button size="sm" variant="outline" className="mt-2" disabled={safetyRetry.isPending} onClick={() => safetyRetry.mutate(item.id)}>Retry safety check</Button>}
                              <div className="flex justify-between items-center mt-2">
                                <p className="text-xs text-muted-foreground">
                                  {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {item.downloadCount || 0} downloads
                                </p>
                              </div>
                              <div className="mt-3 border-t border-border pt-3">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="min-h-11 w-full justify-center focus-visible:ring-2"
                                  aria-label={`Edit media: ${item.caption || `Media ${item.id}`}`}
                                  onClick={(event) => {
                                    editMediaOpener.current = event.currentTarget;
                                    setSelectedMediaItem(item);
                                    setEditMediaModalOpen(true);
                                  }}
                                >
                                  <PenLine className="mr-2 h-4 w-4" />Edit media
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                      <div className="flex justify-center gap-3 mt-4">
                        <Button variant="outline" disabled={mediaPage === 1} onClick={() => setMediaPage(mediaPage - 1)}>Previous</Button>
                        <span className="self-center">Page {mediaPage}</span>
                        <Button variant="outline" disabled={eventMediaItems.length < 48} onClick={() => setMediaPage(mediaPage + 1)}>Next</Button>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </TabsContent>

          <TabsContent value="analytics" className="mt-6">
            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Event Performance</CardTitle>
                  <CardDescription>Media downloads during the public beta</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {sortedEvents.map(event => {
                      const stats = getEventStats(event.id);
                      return (
                        <div key={event.id} className="flex justify-between items-center pb-4 border-b border-border last:border-0">
                          <div>
                            <h3 className="font-medium"><EventTitle title={event.title} /></h3>
                            <p className="text-sm text-muted-foreground">
                              {formatDate(event.date)}
                            </p>
                          </div>
                          <div className="text-right">
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
      
      {selectedMediaItem && (
        <EditMediaModal
          open={editMediaModalOpen}
          onOpenChange={setEditMediaModalOpen}
          mediaItem={selectedMediaItem}
          onCloseAutoFocus={(event) => {
            if (editMediaOpener.current?.isConnected) {
              event.preventDefault();
              editMediaOpener.current.focus();
            }
          }}
        />
      )}
    </div>
  );
}
