import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { ArrowLeft, ArrowUpRight, CalendarDays, Globe2, Instagram, Mail, Star, Users, UserRound } from "lucide-react";
import type { Event, MediaItem } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { ShareMenu } from "@/components/share-menu";
import EventCard from "@/components/event-card";
import MediaGrid from "@/components/media-grid";
import MainNavigation from "@/components/main-navigation";
import type { PublicCreator } from "@/components/creator-identity";
import { useAuth } from "@/hooks/use-auth";
import MobileGalleryRow from "@/components/mobile-gallery-row";

type CreatorProfileData = PublicCreator & {
  bio: string | null;
  coverImage?: string | null;
  publicContactEmail?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
};

function ProfileSkeleton() {
  return <div className="min-h-[100dvh] bg-background"><div className="h-14 border-b border-border bg-card" /><div className="mx-auto max-w-7xl animate-pulse px-5 py-8">
    <div className="h-[30vh] min-h-52 bg-secondary" /><div className="mt-[-3rem] flex items-end gap-5"><div className="h-28 w-28 rounded-full border-4 border-background bg-muted" /><div className="h-10 w-64 max-w-[60vw] bg-secondary" /></div><div className="mt-8 h-4 w-2/3 bg-secondary" /><div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{[0,1,2].map(key=><div key={key} className="aspect-[16/10] bg-secondary" />)}</div>
  </div></div>;
}

export default function CreatorProfile() {
  const [, params] = useRoute<{ id: string }>("/creator/:id");
  const creatorId = Number(params?.id || "0");
  const { user } = useAuth();
  const { data: creator, isLoading: creatorLoading, isError: creatorError, refetch: retryCreator } = useQuery<CreatorProfileData>({
    queryKey: [`/api/users/${creatorId}`, user?.id ?? "signed-out"],
    enabled: creatorId > 0,
    retry: false,
  });
  const { data: creatorEvents = [], isLoading: eventsLoading, isError: eventsError, refetch: retryEvents } = useQuery<Event[]>({
    queryKey: [`/api/events/creator/${creatorId}`],
    enabled: creatorId > 0,
    retry: false,
  });
  const { data: topMediaItems = [], isLoading: mediaLoading, isError: mediaError } = useQuery<MediaItem[]>({
    queryKey: [`/api/media/top/creator/${creatorId}`],
    enabled: creatorId > 0,
    retry: false,
  });
  const displayName = creator?.displayName?.trim() || creator?.username || "";
  const websiteHref = creator?.websiteUrl && /^https:\/\/[^\s]+$/i.test(creator.websiteUrl) ? creator.websiteUrl : null;
  const instagramHref = creator?.instagramUrl && /^https:\/\/[^\s]+$/i.test(creator.instagramUrl) ? creator.instagramUrl : null;
  const isLoading = creatorLoading || eventsLoading || mediaLoading;

  if (isLoading) return <ProfileSkeleton />;
  if (!creator) return <div className="min-h-[100dvh] bg-background"><MainNavigation /><main className="mx-auto flex min-h-[65vh] max-w-3xl flex-col items-center justify-center gap-4 px-5 text-center">
    <p className="vco-kicker">Creator profile</p><h1 className="text-4xl">Profile unavailable</h1><p className="max-w-md text-foreground/70">{creatorError ? "We couldn’t load this creator right now." : "This creator profile could not be found."}</p>
    {creatorError && <Button variant="outline" onClick={() => void retryCreator()}>Try again</Button>}<Button asChild variant="outline"><Link href="/"><ArrowLeft className="mr-2 h-4 w-4" />Back to archive</Link></Button>
  </main></div>;

  return <div className="min-h-[100dvh] bg-background">
    <MainNavigation />
    <main className="mx-auto max-w-[1492px] px-5 pb-16 sm:px-7 lg:px-10">
      <div className="relative -mx-5 h-[32vh] min-h-56 max-h-[30rem] overflow-hidden bg-card sm:-mx-7 lg:-mx-10">
        {creator.coverImage ? <img src={creator.coverImage} alt="" className="h-full w-full object-cover" /> : <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_78%_34%,hsl(var(--primary)/.28),transparent_42%),linear-gradient(110deg,hsl(var(--card)),hsl(var(--secondary)))]" />}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/15 to-black/10" />
        <div className="absolute left-5 top-5 sm:left-7 lg:left-10"><Button variant="outline" asChild className="border-white/30 bg-black/35 text-white backdrop-blur hover:bg-black/60"><Link href="/"><ArrowLeft className="mr-2 h-4 w-4" />Archive</Link></Button></div>
        <div className="absolute bottom-5 right-5 sm:right-7 lg:right-10"><ShareMenu url={window.location.href} title={displayName} /></div>
      </div>
      <section className="relative -mt-12 flex flex-col gap-5 border-b border-border pb-8 sm:-mt-16 sm:flex-row sm:items-end sm:gap-7">
        <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-background bg-secondary text-primary shadow-xl sm:h-36 sm:w-36">
          {creator.profileImage ? <img src={creator.profileImage} alt={`${displayName} profile`} className="h-full w-full object-cover" /> : <UserRound className="h-11 w-11" />}
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <p className="vco-kicker">VCO creator · @{creator.username}</p>
          <h1 className="mt-2 break-words text-4xl font-bold tracking-tight sm:text-6xl">{displayName}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 pb-1">
          <span className="inline-flex min-h-11 items-center gap-2 border border-border bg-card px-4 text-sm font-semibold"><Users className="h-4 w-4 text-primary" />{creator.followerCount ?? 0} followers</span>
          <FollowControl creator={creator} />
        </div>
      </section>
      <section className="grid gap-8 border-b border-border py-8 md:grid-cols-[minmax(0,1fr)_minmax(14rem,.46fr)]">
        <div>{creator.bio ? <p className="max-w-3xl whitespace-pre-line text-lg leading-relaxed text-foreground/80">{creator.bio}</p> : <p className="text-foreground/55">No biography added yet.</p>}</div>
        <div className="flex flex-col gap-3 text-sm">
          {creator.publicContactEmail && <a href={`mailto:${creator.publicContactEmail}`} className="inline-flex min-h-10 items-center gap-2 break-all font-semibold text-primary underline underline-offset-4"><Mail className="h-4 w-4 shrink-0" />{creator.publicContactEmail}</a>}
          {websiteHref && <a href={websiteHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 break-all font-semibold text-foreground/80 hover:text-primary"><Globe2 className="h-4 w-4 shrink-0 text-primary" />Website<ArrowUpRight className="h-3.5 w-3.5" /></a>}
          {instagramHref && <a href={instagramHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 break-all font-semibold text-foreground/80 hover:text-primary"><Instagram className="h-4 w-4 shrink-0 text-primary" />Instagram<ArrowUpRight className="h-3.5 w-3.5" /></a>}
        </div>
      </section>
      <section className="pt-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="vco-kicker">On the circuit</p><h2 className="mt-2 text-3xl sm:text-4xl">Published galleries</h2></div><span className="text-sm text-muted-foreground">{creatorEvents.length} {creatorEvents.length === 1 ? "gallery" : "galleries"}</span></div>
        {eventsError ? <div role="alert" className="border border-destructive/30 bg-card p-7 text-center"><p>Published galleries are temporarily unavailable.</p><Button variant="outline" className="mt-4" onClick={() => void retryEvents()}>Try again</Button></div> : creatorEvents.length ? <MobileGalleryRow label="Published galleries" className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{creatorEvents.map(event=><EventCard key={event.id} event={event} />)}</MobileGalleryRow> : <div className="border border-dashed border-border bg-card/50 px-6 py-14 text-center"><CalendarDays className="mx-auto h-8 w-8 text-primary" /><h3 className="mt-4 text-xl">No public galleries yet</h3><p className="mt-2 text-sm text-muted-foreground">New work will appear here once it’s published.</p></div>}
      </section>
      {topMediaItems.length > 0 && <section className="mt-14 border-t border-border pt-10"><div className="mb-6 flex items-end gap-3"><Star className="mb-1 h-5 w-5 text-primary" /><div><p className="vco-kicker">Selected frames</p><h2 className="mt-2 text-3xl">Most popular work</h2></div></div><MediaGrid items={topMediaItems} /></section>}
      {mediaError && <p role="status" className="mt-8 text-sm text-muted-foreground">Popular media is temporarily unavailable.</p>}
    </main>
  </div>;
}

function FollowControl({ creator }: { creator: CreatorProfileData }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const name = creator.displayName?.trim() || creator.username;
  const key = [`/api/users/${creator.id}`, user?.id ?? "signed-out"];
  const { data } = useQuery<CreatorProfileData>({ queryKey: key, initialData: creator });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const toggle = async () => {
    if (!user || user.id === creator.id || pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/creators/${creator.id}/follow`, { method: data?.following ? "DELETE" : "PUT", credentials: "include", headers: { Accept: "application/json" } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not update follow status.");
      queryClient.setQueryData(key, (old: CreatorProfileData | undefined) => old ? { ...old, ...result } : old);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [`/api/users/${creator.id}`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/account/following"] }),
      ]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update follow status."); }
    finally { setPending(false); }
  };
  if (!user) return <Button asChild className="min-h-11 bg-primary text-primary-foreground"><Link href="/auth">Sign in to follow</Link></Button>;
  return <div className="flex flex-col items-end gap-1">
    <Button type="button" onClick={() => void toggle()} disabled={pending || user.id === creator.id} variant={data?.following ? "outline" : "default"} className="min-h-11 min-w-32">{user.id === creator.id ? "Your profile" : pending ? "Updating…" : data?.following ? "Following" : "Follow"}</Button>
    {error && <span role="alert" className="max-w-48 text-right text-xs text-destructive">{error}</span>}
  </div>;
}
