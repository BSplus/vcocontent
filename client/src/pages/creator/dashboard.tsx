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
  ArrowLeft, Plus, Edit, Eye, PenLine, Images, UserRound, BarChart3, ArrowUpRight, Image as ImageIcon
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import UploadModal from "@/components/upload-modal";
import LegalLinks from "@/components/legal-links";
import Footer from "@/components/footer";
import MediaUploadModal from "@/components/media-upload-modal";
import EditMediaModal from "@/components/edit-media-modal";
import EventTitle from "@/components/event-title";
import DashboardEventList from "@/components/creator-gallery-cards";
import CreatorGalleryAssociation, {
  creatorAssociationsKey,
  creatorOfficialEventsKey,
  invalidateCommunityGalleryQueries,
} from "@/components/creator-gallery-association";
import { Badge } from "@/components/ui/badge";
import ProfileSettings from "@/components/profile-settings";
import AssignNumberAction from "@/components/assign-number-dialog";
import type { PageEnvelope } from "@shared/pagination";
import PageStatus from "@/components/page-status";
import { usePageState } from "@/hooks/use-page-state";

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
  const [section, setSection] = useState<"studio" | "galleries" | "account">("studio");
  const [eventSearch, setEventSearch] = useState("");

  // Load creator's events
  const { data: events = [], isLoading: eventsLoading, error: eventsError } = useQuery<Event[]>({
    queryKey: ["/api/creator/events", user?.id ?? "signed-out"],
    staleTime: 0,
  });

  // Reuse the same owned metadata for cover cards, recent photos and the editor.
  const { data: mediaItems = [], isLoading: mediaLoading, error: mediaError } = useQuery<MediaItem[]>({
    queryKey: ["/api/creator/media", user?.id ?? "signed-out"],
    staleTime: 0,
  });
  const { data: usage, isLoading: usageLoading, error: usageError, refetch: retryUsage } = useQuery<{
    bytes: number; galleries: number; photos: number; unknown: number; pendingCleanup: number;
    limits: { bytes: number; galleries: number; photos: number; imageBytes: number };
    exception: boolean; adminExempt:boolean;
    eventStats: {eventId:number;photos:number;videos:number;downloads:number}[];
  }>({ queryKey: ["/api/creator/usage", user?.id ?? "signed-out"] });
  const recentMedia = [...mediaItems].sort((a,b)=>b.id-a.id).slice(0,12);
  const publishMutation = useMutation({
    mutationFn: async ({ id, published }: { id: number; published: boolean }) =>
      (await apiRequest("POST", `/api/events/${id}/publish`, { published })).json(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/creator/events"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      void queryClient.invalidateQueries({ queryKey: creatorOfficialEventsKey });
      void queryClient.invalidateQueries({ queryKey: creatorAssociationsKey });
      void invalidateCommunityGalleryQueries(queryClient);
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
  const [mediaPage, setMediaPage] = usePageState(`${user?.id}:${selectedEventId}`);
  const { data: eventMediaData, isFetching: eventMediaBusy, isError: eventMediaError, refetch: refetchEventMedia } = useQuery<PageEnvelope<MediaItem>>({
    queryKey: [`/api/events/${selectedEventId}/media?page=${mediaPage}&pagination=true`, user?.id ?? "signed-out"],
    enabled: !!selectedEventId,
    refetchInterval:activeTab==="media"?5000:false,
  });
  const eventMediaItems = eventMediaData?.items ?? [];
  useEffect(() => {
    if (!eventMediaBusy && !eventMediaError && eventMediaData) setMediaPage(eventMediaData.page);
  }, [eventMediaData, eventMediaBusy, eventMediaError, setMediaPage]);

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
      <div className="min-h-[100dvh] bg-background px-5 py-8 sm:px-8" role="status" aria-label="Loading Creator Studio">
        <div className="mx-auto max-w-6xl animate-pulse space-y-8">
          <div className="h-3 w-40 bg-secondary" />
          <div className="h-12 w-72 max-w-full bg-secondary" />
          <div className="flex gap-3 border-b border-border pb-4"><div className="h-10 w-28 bg-secondary" /><div className="h-10 w-36 bg-secondary" /><div className="h-10 w-24 bg-secondary" /></div>
          <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map(item => <div key={item} className="h-28 border border-border bg-card" />)}</div>
          <div className="h-56 border border-border bg-card" />
          <span className="sr-only">Loading creator events and usage</span>
        </div>
      </div>
    );
  }
  if (eventsError || mediaError) {
    return <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p>Creator data could not be loaded.</p>
      <Button onClick={() => window.location.reload()}>Reload page</Button>
    </div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-primary/20">
        <div className="container mx-auto px-4 py-6">
          <p className="vco-kicker">VCO · Creator workspace</p>
          <h1 className="mt-3 text-4xl font-bold sm:text-5xl">
            Creator Studio
          </h1>
          <LegalLinks />
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
        <nav aria-label="Creator Studio sections" className="mb-7 flex flex-wrap gap-2 border-b border-border pb-3">
          {([
            ["studio", "Studio", BarChart3],
            ["galleries", "My Galleries", Images],
            ["account", "Account", UserRound],
          ] as const).map(([value, label, Icon]) => <button key={value} type="button" onClick={() => setSection(value)} aria-current={section === value ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-bold uppercase tracking-wider transition-colors ${section === value ? "border-primary text-primary" : "border-transparent text-foreground/65 hover:text-foreground"}`}>
            <Icon className="h-4 w-4" />{label}
          </button>)}
        </nav>

        {section === "studio" && <section className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="border border-border bg-card p-5"><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Galleries</p><p className="mt-3 text-4xl font-bold text-foreground">{usage?.galleries ?? "—"}<span className="ml-2 text-sm font-normal text-muted-foreground">{usage && !usage.adminExempt ? `/ ${usage.limits.galleries}` : ""}</span></p></div>
            <div className="border border-border bg-card p-5"><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Photos</p><p className="mt-3 text-4xl font-bold text-foreground">{usage?.photos ?? "—"}<span className="ml-2 text-sm font-normal text-muted-foreground">{usage && !usage.adminExempt ? `/ ${usage.limits.photos}` : ""}</span></p></div>
            <div className="border border-border bg-card p-5"><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Storage in use</p><p className="mt-3 text-4xl font-bold text-foreground">{usage ? `${(usage.bytes / 1000000).toFixed(1)} MB` : "—"}</p><p className="mt-1 text-xs text-muted-foreground">{usage?.adminExempt ? "Admin-managed storage" : usage ? `of ${(usage.limits.bytes / 1000000).toFixed(0)} MB` : "Usage details unavailable"}</p></div>
          </div>
          {usageError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border border-destructive/35 bg-card px-4 py-3 text-sm"><span>Usage details could not be loaded.</span><Button size="sm" variant="outline" className="min-h-11" onClick={() => void retryUsage()}>Retry usage</Button></div>}
          <div className="flex flex-wrap items-center justify-between gap-4 border border-primary/25 bg-primary/[0.045] p-5 sm:p-7">
            <div><p className="vco-kicker">Your latest work</p><h2 className="mt-3 text-3xl">Keep the archive moving.</h2><p className="mt-2 max-w-xl text-foreground/70">Publish a new event gallery or add photos to one already in progress.</p></div>
            <div className="flex flex-wrap gap-2">
              <Button className="vco-button min-h-11 bg-primary text-primary-foreground" onClick={() => { setSelectedEventId(null); setUploadModalOpen(true); }}><Plus className="mr-2 h-4 w-4" />Create gallery</Button>
              <Button variant="outline" className="min-h-11" onClick={() => setSection("galleries")}>Manage galleries<ArrowUpRight className="ml-2 h-4 w-4" /></Button>
            </div>
          </div>
          <div className="grid gap-8 lg:grid-cols-[1.3fr_.7fr]">
            <section aria-labelledby="recent-photos-heading">
              <div className="mb-4 flex items-end justify-between gap-3"><div><p className="vco-kicker">Recently uploaded</p><h2 id="recent-photos-heading" className="mt-2 text-2xl">Your latest photos</h2></div><button type="button" className="min-h-11 text-sm text-primary underline underline-offset-4" onClick={() => { setSection("galleries"); setActiveTab("media"); }}>All media</button></div>
              {recentMedia.filter(item => item.type === "image").length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{recentMedia.filter(item => item.type === "image").slice(0, 6).map(item => <button key={item.id} type="button" onClick={() => { setSelectedEventId(item.eventId); setSection("galleries"); setActiveTab("media"); }} className="group relative aspect-[4/3] overflow-hidden border border-border bg-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <img src={item.thumbnail} alt={item.caption || "Recent photo"} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-3 py-2 text-sm">{item.caption || "Untitled photo"}</span>
                </button>)}</div>
                : <div className="flex min-h-48 flex-col items-center justify-center border border-dashed border-border bg-card/50 p-6 text-center"><ImageIcon className="h-8 w-8 text-primary/70" /><p className="mt-3 font-semibold">No photos yet</p><p className="mt-1 text-sm text-muted-foreground">Your newest uploads will appear here.</p><Button variant="outline" className="mt-4 min-h-11" onClick={() => setSection("galleries")}>Choose a gallery</Button></div>}
            </section>
            <aside className="border-l border-border pl-0 lg:pl-7">
              <p className="vco-kicker">Recent galleries</p><h2 className="mt-2 text-2xl">At a glance</h2>
              {sortedEvents.length ? <div className="mt-4 divide-y divide-border border-y border-border">{sortedEvents.slice(0, 4).map(event => {
                const stats = getEventStats(event.id);
                const visibility = (event as Event & { visibility?: string }).visibility;
                return <button key={event.id} type="button" onClick={() => { setSelectedEventId(event.id); setSection("galleries"); setActiveTab("media"); }} className="flex min-h-16 w-full items-center justify-between gap-3 py-3 text-left">
                  <span className="min-w-0"><span className="block truncate font-semibold">{event.title}</span><span className="mt-1 block text-xs text-muted-foreground">{stats.photos} photos · {stats.totalDownloads} downloads</span></span>
                  <Badge variant="outline">{visibility === "published" ? "Live" : "Draft"}</Badge>
                </button>;
              })}</div> : <p className="mt-4 border border-dashed border-border p-5 text-sm text-muted-foreground">Your galleries will be listed here.</p>}
              <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Creator earnings features are not active in this public beta. No payout or revenue tools are available.</p>
            </aside>
          </div>
        </section>}

        {section === "account" && <section className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
          <div className="space-y-6">
            {user && <ProfileSettings user={user} />}
            <Card><CardHeader><CardTitle>Account & public profile</CardTitle><CardDescription>Creator identity and personal community activity</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4 border-b border-border pb-5"><div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-xl font-bold text-primary">{user?.username?.slice(0,1).toUpperCase()}</div><div><p className="font-semibold">{user?.username}</p><p className="text-sm text-muted-foreground">{user?.email}</p></div></div>
                <p className="text-sm leading-relaxed text-foreground/75">Public creator information and galleries remain subject to the existing moderation and visibility checks.</p>
                <div className="flex flex-wrap gap-3"><Button asChild variant="outline" className="min-h-11"><Link href={`/creator/${user?.id}`}>View public profile<ArrowUpRight className="ml-2 h-4 w-4" /></Link></Button><Button asChild className="min-h-11 bg-primary text-primary-foreground"><Link href="/account">My downloads & favorites</Link></Button></div>
              </CardContent>
            </Card>
          </div>
          <Card className="self-start"><CardHeader><CardTitle>Studio statistics</CardTitle><CardDescription>Live beta usage for your galleries</CardDescription></CardHeader><CardContent className="space-y-3 text-sm">
            <p className="flex justify-between gap-4 border-b border-border pb-3"><span>Photos</span><strong>{usage?.photos ?? "—"}</strong></p>
            <p className="flex justify-between gap-4 border-b border-border pb-3"><span>Galleries</span><strong>{usage?.galleries ?? "—"}</strong></p>
            <p className="flex justify-between gap-4 border-b border-border pb-3"><span>Downloads</span><strong>{usage?.eventStats?.reduce((total, row) => total + row.downloads, 0) ?? "—"}</strong></p>
            <p className="pt-1 text-xs leading-relaxed text-muted-foreground">These are completed beta download counts. Earnings and payout tools are not enabled.</p>
          </CardContent></Card>
        </section>}

        {section === "galleries" && <>
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
            <TabsTrigger value="events">Galleries</TabsTrigger>
            <TabsTrigger value="media">Manage Media</TabsTrigger>
            <TabsTrigger value="analytics">Performance</TabsTrigger>
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
                      <CreatorGalleryAssociation galleryId={event.id} />
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
                  if (eventMediaError) return <div role="alert"><p>Could not load event media.</p><Button onClick={() => void refetchEventMedia()}>Try again</Button></div>;
                  if (eventMediaBusy && !eventMediaData) return <p role="status">Loading event media…</p>;
                  
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
                                <div className="mt-2">
                                  <AssignNumberAction mediaItem={item} />
                                </div>
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
        </>}
      </main>
      <Footer />

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
