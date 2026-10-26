import { useState, useEffect } from "react";
import type { PageEnvelope } from "@shared/pagination";
import PageStatus from "@/components/page-status";
import { usePageState } from "@/hooks/use-page-state";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Event, MediaItem, User } from "@shared/schema";
import { 
  Loader2, Plus, Trash2, PenLine, Eye, Edit
} from "lucide-react";
import UploadModal from "@/components/upload-modal";
import MediaUploadModal from "@/components/media-upload-modal";
import EditMediaModal from "@/components/edit-media-modal";
import { useToast } from "@/hooks/use-toast";
import SeriesManager from "@/components/series-manager";
import MainNavigation from "@/components/main-navigation";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import DashboardEventList from "@/components/dashboard-event-list";
import { apiRequest } from "@/lib/queryClient";
import { ShieldCheck, ShieldAlert, EyeOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import AssignNumberAction from "@/components/assign-number-dialog";
import { creditLabel } from "@shared/media-credit";
import NativeUploadDiagnostics from "@/components/admin/native-upload-diagnostics";
import { pluralize } from "@/lib/utils";

export default function AdminDashboard() {
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [mediaUploadModalOpen, setMediaUploadModalOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const [selectedMediaItem, setSelectedMediaItem] = useState<MediaItem | null>(null);
  const [editMediaModalOpen, setEditMediaModalOpen] = useState(false);
  const [activeMediaEventId, setActiveMediaEventId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("events");
  const [mediaPage, setMediaPage] = usePageState(activeMediaEventId ?? "none");
  const [eventSearch, setEventSearch] = useState("");
  const [reviewSelection, setReviewSelection] = useState<{
    kind: "media" | "events";
    id: number;
    decision: "approve" | "block";
    version: number | string;
    policy: unknown;
  } | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const safetyQuery = useQuery<{ media: MediaItem[]; events: Event[] }>({ queryKey: ["/api/admin/safety"] });
  const visibilityMutation = useMutation({
    mutationFn: async ({ id, hidden }: { id: number; hidden: boolean }) =>
      (await apiRequest("PATCH", `/api/admin/events/${id}/visibility`, { hidden })).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      toast({ title: "Event visibility updated" });
    },
    onError: (error: Error) => toast({ title: "Visibility update failed", description: error.message, variant: "destructive" }),
  });
  const reviewSafety = async (selection: NonNullable<typeof reviewSelection>) => {
    if (!reviewReason.trim()) return;
    try {
      await apiRequest("POST", `/api/admin/safety/${selection.kind}/${selection.id}/review`, {
        decision: selection.decision,
        reason: reviewReason.trim(),
        version: selection.version,
        policy: selection.policy,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/safety"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      setReviewSelection(null);
      setReviewReason("");
      toast({ title: selection.decision === "approve" ? "Item approved" : "Item blocked" });
    } catch (error) {
      toast({ title: "Review failed", description: error instanceof Error ? error.message : "Could not save review.", variant: "destructive" });
    }
  };
  const retryEventSafety = useMutation({
    mutationFn: async (id: number) =>
      (await apiRequest("POST", `/api/events/${id}/publish`, { published: true })).json(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/safety"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      toast({ title: "Event safety check retried", description: "The event was submitted through the publish workflow." });
    },
    onError: (error: Error) => toast({ title: "Event retry failed", description: error.message, variant: "destructive" }),
  });

  // Load events with better error handling
  const { data: events = [], isLoading: eventsLoading, error: eventsError, refetch: retryEvents } = useQuery<Event[]>({
    queryKey: ["/api/admin/events"],
    staleTime: 0,
    retry: 1, // Only retry once on failure 
  });

  // Load media items for statistics
  const { data: mediaItems = [], isLoading: mediaLoading, error: mediaError, refetch: retryMedia } = useQuery<MediaItem[]>({
    queryKey: ["/api/media"],
    staleTime: 0,
    retry: 1, // Only retry once on failure
  });
  const { data: usage, error: usageError, refetch: retryUsage } = useQuery<{
    total: { bytes: string; count: string; legacy: string; legacyTextBytes: string };
    byEvent: { eventId: number; title: string; bytes: string; count: string; legacy: string }[];
    byCreator: { creatorId: number; bytes: string; count: string }[];
    cleanupCount: string;
    officialStorage?: {bytes:number;retainedBytes:number;reservedBytes:number;unknown:number};
    policy: { eventBytes: number; creatorBytes: number; eventCount: number; creatorCount: number };
    warningFraction: number;
  }>({ queryKey: ["/api/admin/media-usage"] });
  const { data: eventMediaData, isFetching: eventMediaBusy, isError: eventMediaError, refetch: refetchEventMedia } = useQuery<PageEnvelope<MediaItem>>({
    queryKey: [`/api/events/${activeMediaEventId}/media?page=${mediaPage}&pagination=true`],
    enabled: !!activeMediaEventId,
  });
  const eventMediaItems = eventMediaData?.items ?? [];
  useEffect(() => {
    if (!eventMediaBusy && !eventMediaError && eventMediaData) setMediaPage(eventMediaData.page);
  }, [eventMediaData, eventMediaBusy, eventMediaError, setMediaPage]);
  
  // Log any errors for debugging
  if (eventsError) console.error("Error loading events:", eventsError);
  if (mediaError) console.error("Error loading media items:", mediaError);

  // Explicit type for mediaItems array to fix TypeScript errors
  const mediaItemsArray: MediaItem[] = Array.isArray(mediaItems) ? mediaItems : [];

  // Delete event mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      console.log('Attempting to delete event:', id); 
      const response = await fetch(`/api/events/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include", 
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error deleting event:', errorData); 
        throw new Error(errorData.error || 'Failed to delete event');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      toast({
        title: "Success",
        description: "Event deleted successfully",
      });
      setEventToDelete(null);
    },
    onError: (error: Error) => {
      console.error('Delete mutation error:', error); 
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getEventStats = (eventId: number) => {
    const eventMedia = mediaItemsArray.filter((item) => item.eventId === eventId);
    const photos = eventMedia.filter((item) => item.type === "image");
    const videos = eventMedia.filter((item) => item.type === "video");

    return {
      photos: photos.length,
      videos: videos.length,
      totalDownloads: eventMedia.reduce((sum, item) => sum + (item.downloadCount || 0), 0)
    };
  };

  // Explicit type for events array to fix TypeScript errors
  const eventsArray: Event[] = Array.isArray(events) ? events : [];
  
  const sortedEvents = [...eventsArray].sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Separate VCO events from Creator events
  const vcoEvents = sortedEvents.filter(event => !event.creatorId);
  const creatorEvents = sortedEvents.filter(event => event.creatorId);

  if (eventsError || mediaError) {
    return <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p>Dashboard data could not be loaded.</p>
      <Button onClick={() => { if (eventsError) void retryEvents(); if (mediaError) void retryMedia(); }}>Try again</Button>
    </div>;
  }
  if (eventsLoading || mediaLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Function to switch to the media tab
  const switchToMediaTab = (eventId: number) => {
    setActiveMediaEventId(eventId);
    setMediaPage(1);
    setActiveTab("media");
  };

  return (
    <div className="min-h-screen bg-background">
      <MainNavigation />
      <header className="border-b border-primary/20">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            ADMIN DASHBOARD
          </h1>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button asChild variant="outline">
              <Link href="/">Back to Home</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/users">User Management</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {usageError && (
          <div role="alert" className="mb-4 flex flex-wrap items-center gap-3">
            <p>The storage overview could not be loaded.</p>
            <Button variant="outline" onClick={() => void retryUsage()}>Try again</Button>
          </div>
        )}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid h-auto w-full grid-cols-1 gap-1 sm:inline-flex sm:w-auto sm:grid-cols-none">
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="media">Media Management</TabsTrigger>
            <TabsTrigger value="series">Race Series</TabsTrigger>
            <TabsTrigger value="safety">Safety review</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="mt-6">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-8">
              <h2 className="text-2xl font-bold">Events Management</h2>
              <Button
                onClick={() => { setSelectedEventId(null); setUploadModalOpen(true); }}
                className="bg-primary text-black hover:bg-primary/90"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create VCO Event
              </Button>
            </div>

            <label htmlFor="admin-event-search" className="mb-2 block text-sm font-medium">Search events by title</label>
            <Input id="admin-event-search" type="search" value={eventSearch} onChange={e => setEventSearch(e.target.value)} placeholder="Search events..." className="mb-6 max-w-md" />
            <div className="space-y-8">
              <DashboardEventList title="VCO Events" events={vcoEvents} mediaItems={mediaItemsArray} search={eventSearch} emptyMessage="No VCO events created yet." actions={event => (
                <>
                  <Button size="sm" variant="outline" onClick={() => { setSelectedEventId(event.id); setUploadModalOpen(true); }}><Edit className="mr-1 h-4 w-4" />Edit Event</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setSelectedEventId(event.id); setMediaUploadModalOpen(true); }}><Plus className="mr-1 h-4 w-4" />Upload Media</Button>
                  <Button size="sm" variant="outline" onClick={() => switchToMediaTab(event.id)}><Eye className="mr-1 h-4 w-4" />Manage Media</Button>
                  <Button size="sm" variant="outline" disabled={visibilityMutation.isPending}
                    onClick={() => visibilityMutation.mutate({ id: event.id, hidden: !(event as Event & { adminHidden?: boolean }).adminHidden })}>
                    <EyeOff className="mr-1 h-4 w-4" />{(event as Event & { adminHidden?: boolean }).adminHidden ? "Unhide" : "Hide"}
                  </Button>
                  <Button size="sm" variant="destructive" aria-label={`Delete event ${event.title}`} onClick={() => setEventToDelete(event)}><Trash2 className="mr-1 h-4 w-4" />Delete Event</Button>
                </>
              )} />
              <DashboardEventList title="Creator Events" events={creatorEvents} mediaItems={mediaItemsArray} search={eventSearch} emptyMessage="No creator events yet."
                onEditEvent={event => { setSelectedEventId(event.id); setUploadModalOpen(true); }} actions={event => (
                <>
                  <Button size="sm" variant="outline" onClick={() => switchToMediaTab(event.id)}><Eye className="mr-1 h-4 w-4" />Manage Media</Button>
                  <Button size="sm" variant="outline" disabled={visibilityMutation.isPending}
                    onClick={() => visibilityMutation.mutate({ id: event.id, hidden: !(event as Event & { adminHidden?: boolean }).adminHidden })}>
                    <EyeOff className="mr-1 h-4 w-4" />{(event as Event & { adminHidden?: boolean }).adminHidden ? "Unhide" : "Hide"}
                  </Button>
                  <Button size="sm" variant="destructive" aria-label={`Delete event ${event.title}`} onClick={() => setEventToDelete(event)}><Trash2 className="mr-1 h-4 w-4" />Delete Event</Button>
                </>
              )} />
            </div>
          </TabsContent>

          <TabsContent value="media" className="mt-6">
            <div className="mb-6">
              <NativeUploadDiagnostics enabled={activeTab === "media"} />
            </div>
            {usage && (
              <Card className="mb-6">
                <CardContent className="pt-5 space-y-3 break-words">
                  <h3 className="font-semibold">Storage usage</h3>
                  {usage.officialStorage && <p>
                    Official VCO storage: {(usage.officialStorage.bytes / 1000000).toFixed(1)} MB
                    {usage.officialStorage.unknown ? " (some sizes unconfirmed)" : ""}
                    {" "}· {(usage.officialStorage.reservedBytes / 1000000).toFixed(1)} MB reserved.
                    {" "}Measured separately from Creator allowances.
                  </p>}
                  <p className="text-xs text-muted-foreground">The media-row summary below excludes separate asset variants, profile images and reference documents. Creator Studio shows the full Creator storage breakdown.</p>
                  <p>{(Number(usage.total.bytes) / 1048576).toFixed(1)} MiB across {usage.total.count} measured {pluralize(usage.total.count, "item", "items")};
                    {" "}{usage.cleanupCount} {pluralize(usage.cleanupCount, "object awaits", "objects await")} cleanup.</p>
                  {Number(usage.total.legacy) > 0 && (
                    <p role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                      {usage.total.legacy} older media item{Number(usage.total.legacy) === 1 ? " has" : "s have"} unknown stored file size. Check object storage before relying on the byte totals.
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">Warning at {usage.warningFraction * 100}% of budget. Unmeasured older media is not included in byte totals.</p>
                  {usage.byCreator.map(row => (
                    <p key={row.creatorId} className={Number(row.bytes) >= usage.policy.creatorBytes * usage.warningFraction || Number(row.count) >= usage.policy.creatorCount * usage.warningFraction ? "text-amber-600" : ""}>
                      Creator {row.creatorId}: {(Number(row.bytes) / 1048576).toFixed(1)} / {(usage.policy.creatorBytes / 1048576).toFixed(0)} MiB, {row.count} / {usage.policy.creatorCount} items
                    </p>
                  ))}
                  <div className="max-h-48 overflow-y-auto">
                    {usage.byEvent.map(row => (
                      <p key={row.eventId} className={Number(row.bytes) >= usage.policy.eventBytes * usage.warningFraction || Number(row.count) >= usage.policy.eventCount * usage.warningFraction ? "text-amber-600" : ""}>
                        {row.title}: {(Number(row.bytes) / 1048576).toFixed(1)} / {(usage.policy.eventBytes / 1048576).toFixed(0)} MiB, {row.count} / {usage.policy.eventCount} items{Number(row.legacy) ? ` (${row.legacy} unmeasured)` : ""}
                      </p>
                    ))}
                  </div>
                  <Button variant="outline" onClick={async () => {
                    const response = await fetch("/api/admin/media-cleanup", { method: "POST", credentials: "include" });
                    if (!response.ok) { toast({ title: "Cleanup failed", variant: "destructive" }); return; }
                    queryClient.invalidateQueries({ queryKey: ["/api/admin/media-usage"] });
                  }}>Retry object cleanup</Button>
                </CardContent>
              </Card>
            )}
             <div className="flex flex-wrap justify-between items-center gap-3 mb-8">
              <h2 className="text-2xl font-bold">Media Management</h2>
               <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                <select 
                   aria-label="Select event for media management"
                   className="min-w-0 w-full max-w-full border rounded p-2 bg-background text-foreground sm:w-56"
                  onChange={(e) => {
                    const id = parseInt(e.target.value);
                    if (!isNaN(id)) {
                      setActiveMediaEventId(id);
                      setMediaPage(1);
                    } else {
                      setActiveMediaEventId(null);
                    }
                  }}
                  value={activeMediaEventId || ""}
                >
                  <option value="">Select Event...</option>
                  {sortedEvents.map(event => (
                    <option key={event.id} value={event.id}>{event.title}</option>
                  ))}
                </select>
                {activeMediaEventId && (
                  <Button
                    onClick={() => {
                      setSelectedEventId(activeMediaEventId);
                      setMediaUploadModalOpen(true);
                    }}
                    className="bg-primary text-black hover:bg-primary/90"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Upload Media
                  </Button>
                )}
              </div>
            </div>
            
            {!activeMediaEventId ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-muted-foreground mb-4">
                    Please select an event to view and manage its media
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Display media items for selected event */}
                {(() => {
                  const event = eventsArray.find(e => e.id === activeMediaEventId);
                  if (eventMediaError) return <div role="alert"><p>Could not load event media.</p><Button onClick={() => void refetchEventMedia()}>Try again</Button></div>;
                  if (eventMediaBusy && !eventMediaData) return <p role="status">Loading event media…</p>;
                  
                  if (eventMediaItems.length === 0) {
                    return (
                      <Card>
                        <CardContent className="flex flex-col items-center justify-center py-12">
                          <p className="text-muted-foreground mb-4">
                            No media uploaded for this event yet
                          </p>
                          <Button 
                            onClick={() => {
                              setSelectedEventId(activeMediaEventId);
                              setMediaUploadModalOpen(true);
                            }}
                          >
                            Upload Media
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  }
                  
                  return (
                    <div>
                       <h3 className="text-lg font-semibold mb-4 break-words">
                        Media for: {event?.title}
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {eventMediaItems.map((item) => (
                           <Card key={item.id} className="min-w-0 overflow-hidden">
                            <div className="aspect-video relative">
                              <img 
                                src={item.thumbnail} 
                                alt={item.caption || "Media thumbnail"} 
                                className="object-cover w-full h-full"
                              />
                            </div>
                            <CardContent className="p-3">
                              <p className="text-sm truncate">{item.caption || "No caption"}</p>
                               <Button
                                 size="sm"
                                 variant="outline"
                                 className="mt-2"
                                 onClick={() => {
                                   setSelectedMediaItem(item);
                                   setEditMediaModalOpen(true);
                                 }}
                               >
                                 <PenLine className="h-4 w-4 mr-1" /> Edit Media
                               </Button>
                              <div className="mt-2">
                                <AssignNumberAction mediaItem={item} />
                              </div>
                              <div className="flex justify-between items-center mt-2">
                                <p className="text-xs text-muted-foreground">
                                  {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {item.downloadCount || 0} {pluralize(item.downloadCount, "download", "downloads")}
                                </p>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                       <div className="flex flex-wrap justify-center gap-3 mt-4">
                        <Button variant="outline" disabled={eventMediaBusy || eventMediaData?.page === 1} onClick={() => setMediaPage(mediaPage - 1)}>Previous</Button>
                        <PageStatus className="self-center" page={eventMediaData?.page ?? mediaPage} totalPages={!eventMediaBusy ? eventMediaData?.totalPages : undefined} />
                        <Button variant="outline" disabled={eventMediaBusy || !eventMediaData?.hasMore} onClick={() => setMediaPage(mediaPage + 1)}>Next</Button>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </TabsContent>

          <TabsContent value="series" className="mt-6">
            <SeriesManager />
          </TabsContent>
          <TabsContent value="safety" className="mt-6 space-y-6">
            {safetyQuery.isLoading ? <Card><CardContent className="py-8">Loading pending safety reviews…</CardContent></Card> :
              safetyQuery.isError ? <Card><CardContent className="flex flex-wrap items-center gap-3 py-6"><p role="alert">Safety queue could not be loaded.</p><Button variant="outline" onClick={() => void safetyQuery.refetch()}>Retry</Button></CardContent></Card> :
                <>
                  <Card>
                    <CardContent className="pt-5">
                      <h2 className="mb-4 text-lg font-semibold"><ShieldAlert className="mr-2 inline h-5 w-5" />Media awaiting review ({safetyQuery.data?.media.length || 0})</h2>
                      {!safetyQuery.data?.media.length && <p className="text-sm text-muted-foreground">No media requires review.</p>}
                      <div className="space-y-4">{safetyQuery.data?.media.map(item => {
                        const media = item as MediaItem & {
                          safetyStatus?: string;
                          photographer?: string | null;
                          contentVersion: number | string;
                          safetyPolicy: unknown;
                        };
                        const tags = Array.isArray(item.tags) ? item.tags : [];
                        return (
                          <article key={item.id} className="grid min-w-0 gap-4 rounded border border-border p-3 sm:grid-cols-[minmax(180px,280px)_minmax(0,1fr)] sm:p-4">
                            <div className="overflow-hidden rounded border border-border bg-black/20">
                              <img
                                src={item.thumbnail || item.url}
                                alt={item.caption || `Safety review preview for media ${item.id}`}
                                loading="lazy"
                                className="aspect-video h-full max-h-64 w-full object-contain"
                              />
                            </div>
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <h3 className="font-semibold">{item.caption || "Untitled media"}</h3>
                                <span className="text-xs text-muted-foreground">Media #{item.id} · Event #{item.eventId ?? "unassigned"}</span>
                                <span className="text-xs text-muted-foreground">Safety: {media.safetyStatus || "unknown"}</span>
                              </div>
                              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
                                <dt className="text-muted-foreground">{creditLabel(item.type)}</dt><dd className="break-words">{media.photographer || "Not provided"}</dd>
                                <dt className="text-muted-foreground">Tags</dt><dd className="break-words">{tags.length ? tags.join(", ") : "No tags"}</dd>
                                <dt className="text-muted-foreground">Type</dt><dd>{item.type}</dd>
                              </dl>
                              {media.safetyStatus === "review" && (
                                <div className="flex flex-wrap gap-2 pt-1">
                                  <Button size="sm" onClick={() => { setReviewReason(""); setReviewSelection({ kind: "media", id: item.id, decision: "approve", version: media.contentVersion, policy: media.safetyPolicy }); }}><ShieldCheck className="mr-1 h-4 w-4" />Approve</Button>
                                  <Button size="sm" variant="destructive" onClick={() => { setReviewReason(""); setReviewSelection({ kind: "media", id: item.id, decision: "block", version: media.contentVersion, policy: media.safetyPolicy }); }}>Block</Button>
                                </div>
                              )}
                            </div>
                          </article>
                        );
                      })}</div>
                    </CardContent>
                  </Card>
                  <Card><CardContent className="pt-5">
                    <h2 className="mb-4 text-lg font-semibold"><ShieldAlert className="mr-2 inline h-5 w-5" />Events awaiting review ({safetyQuery.data?.events.length || 0})</h2>
                    {!safetyQuery.data?.events.length && <p className="text-sm text-muted-foreground">No events require review.</p>}
                    <div className="space-y-3">{safetyQuery.data?.events.map(event => {
                      const details = event as Event & {
                        safetyStatus?: string;
                        round?: string | number | null;
                        track?: string | null;
                        contentVersion: number | string;
                        safetyPolicy: unknown;
                      };
                      return (
                        <article key={event.id} className="space-y-3 rounded border border-border p-3 sm:p-4">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h3 className="font-semibold">{event.title}</h3>
                            <p className="text-xs text-muted-foreground">Event #{event.id} · Safety: {details.safetyStatus || "unknown"}</p>
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{event.description || "No description provided."}</p>
                          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                            <div className="flex gap-2"><dt className="text-muted-foreground">Round</dt><dd>{details.round || "—"}</dd></div>
                            <div className="flex gap-2"><dt className="text-muted-foreground">Track</dt><dd>{details.track || "—"}</dd></div>
                          </dl>
                          <div className="flex flex-wrap gap-2">
                            {details.safetyStatus === "review" && <>
                              <Button size="sm" onClick={() => { setReviewReason(""); setReviewSelection({ kind: "events", id: event.id, decision: "approve", version: details.contentVersion, policy: details.safetyPolicy }); }}><ShieldCheck className="mr-1 h-4 w-4" />Approve</Button>
                              <Button size="sm" variant="destructive" onClick={() => { setReviewReason(""); setReviewSelection({ kind: "events", id: event.id, decision: "block", version: details.contentVersion, policy: details.safetyPolicy }); }}>Block</Button>
                            </>}
                            {details.safetyStatus === "error" && <Button size="sm" variant="outline" disabled={retryEventSafety.isPending} onClick={() => retryEventSafety.mutate(event.id)}>Retry event safety check</Button>}
                          </div>
                        </article>
                      );
                    })}</div>
                  </CardContent></Card>
                </>}
          </TabsContent>
        </Tabs>
        <Dialog open={!!reviewSelection} onOpenChange={(open) => { if (!open) setReviewSelection(null); }}>
          <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{reviewSelection?.decision === "block" ? "Block this item" : "Approve this item"}</DialogTitle>
              <DialogDescription>Record the reason for this safety decision. The item will leave the pending review queue after it is saved.</DialogDescription>
            </DialogHeader>
            <label htmlFor="safety-review-reason" className="text-sm font-medium">Review reason</label>
            <Textarea id="safety-review-reason" value={reviewReason} onChange={event => setReviewReason(event.target.value)} maxLength={2000} className="min-h-28" />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setReviewSelection(null)}>Cancel</Button>
              <Button
                variant={reviewSelection?.decision === "block" ? "destructive" : "default"}
                disabled={!reviewSelection || !reviewReason.trim()}
                onClick={() => reviewSelection && void reviewSafety(reviewSelection)}
              >
                {reviewSelection?.decision === "block" ? "Save block decision" : "Save approval"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
        />
      )}

      <AlertDialog
        open={!!eventToDelete}
        onOpenChange={(open) => !open && setEventToDelete(null)}
      >
         <AlertDialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Event</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this event? This will also delete
              all associated media items. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (eventToDelete) {
                  deleteMutation.mutate(eventToDelete.id);
                }
              }}
              className="bg-destructive hover:bg-destructive/90"
            >
               Delete Event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
