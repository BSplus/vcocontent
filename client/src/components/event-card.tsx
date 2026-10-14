import { Link } from "wouter";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type Event, type Series } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CalendarDays, ImagePlus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import EventTitle from "@/components/event-title";
import { formatDate } from "@/lib/utils";
import CommunityActions from "@/components/community-actions";
import CreatorIdentity, { type PublicCreator } from "@/components/creator-identity";
import { useState } from "react";
import VisibleThumbnail from "./visible-thumbnail";

const DEFAULT_EVENT_IMAGE = "/attached_assets/%2389_3.png";

interface EventCardProps {
  event: Event & { galleryThumbnail?: string | null };
}

export default function EventCard({ event }: EventCardProps) {
  const { user } = useAuth();
  const eventDate = event.date ? new Date(event.date) : null;
  const isUpcoming = eventDate ? eventDate >= new Date() : false;
  const isCreatorEvent = !!event.creatorId;
  const canManageMedia = user?.isAdmin || (user?.isCreator && user.id === event.creatorId);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const chosenImages = [event.customThumbnail, event.coverImage !== DEFAULT_EVENT_IMAGE ? event.coverImage : null]
    .filter((url): url is string => !!url);
  const { data: preview } = useQuery<{ galleryThumbnail: string | null }>({
    queryKey: [`/api/events/${event.id}/card-preview`],
    enabled: event.galleryThumbnail === undefined && !event.isPremium && !chosenImages.some(url => !failedImages.includes(url)),
  });
  const { data: series } = useQuery<Series>({
    queryKey: [`/api/series/${event.seriesId}`],
    enabled: !!event.seriesId,
  });
  const { data: creator } = useQuery<PublicCreator>({
    queryKey: [`/api/users/${event.creatorId}`, user?.id ?? "signed-out"],
    enabled: isCreatorEvent,
  });
  const thumbnailUrl = [...chosenImages,
    !event.isPremium ? event.galleryThumbnail ?? preview?.galleryThumbnail : null,
    DEFAULT_EVENT_IMAGE].find(url => !!url && !failedImages.includes(url));
  const imageError = () => {
    if (thumbnailUrl) setFailedImages(failed => failed.includes(thumbnailUrl) ? failed : [...failed, thumbnailUrl]);
  };
  const galleryUrl = `/events/${event.id}`;

  return (
    <Card className={`flex h-full flex-col overflow-hidden rounded-none border-border bg-card ${isUpcoming ? "" : "group transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/65 motion-reduce:transform-none"}`}>
      <div className="relative aspect-[16/10] overflow-hidden bg-black/30">
        {isUpcoming ? (
          thumbnailUrl && <VisibleThumbnail src={thumbnailUrl} onError={imageError} alt="" className="h-full w-full object-cover" />
        ) : (
          <Link href={galleryUrl} aria-label={`Open ${event.title} gallery`} className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
            {thumbnailUrl && <VisibleThumbnail src={thumbnailUrl} onError={imageError} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.035] motion-reduce:transform-none" />}
          </Link>
        )}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 pointer-events-none">
          <div className="max-w-[55%]">
            {series?.logo && <img src={series.logo} alt={series.name} title={series.name} className="h-8 max-w-full object-contain object-left drop-shadow-md" />}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {isUpcoming && <Badge className="border-0 bg-primary font-bold text-primary-foreground">Upcoming</Badge>}
            {isCreatorEvent && creator && (
              <span className="pointer-events-auto inline-flex items-center rounded-sm bg-background/90 px-2 py-1 text-xs font-semibold text-foreground shadow-sm"><CreatorIdentity creator={creator} /></span>
            )}
          </div>
        </div>
      </div>

      <CardContent className="flex flex-grow flex-col p-4 sm:p-5">
        <div className="mb-2 flex items-start justify-between gap-3">
          {isUpcoming ? (
            <h3 className="line-clamp-2 text-lg font-bold leading-snug tracking-wide text-foreground"><EventTitle title={event.title} /></h3>
          ) : (
            <Link href={galleryUrl} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <h3 className="line-clamp-2 text-lg font-bold leading-snug tracking-wide text-foreground transition-colors hover:text-primary"><EventTitle title={event.title} /></h3>
            </Link>
          )}
          {!isUpcoming && <ArrowUpRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-foreground/50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />}
        </div>
        <p className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground/75">
          <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
          <time dateTime={eventDate?.toISOString()}>
            {eventDate ? formatDate(eventDate) : "Date not available"}
          </time>
        </p>
        {event.description && <p className="line-clamp-2 text-sm leading-relaxed text-foreground/75">{event.description}</p>}
        {isUpcoming && <p className="mt-3 text-xs text-foreground/70">Calendar information only · No gallery available yet.</p>}
      </CardContent>

      {!isUpcoming && (
        <CardFooter className="flex flex-col gap-2 border-t border-foreground/10 p-4 pt-3 sm:p-5 sm:pt-3">
          <div className="w-full"><CommunityActions kind="event" id={event.id} title={event.title} /></div>
          <Button asChild className="vco-button min-h-11 w-full bg-primary text-primary-foreground hover:bg-primary/90">
            <Link href={galleryUrl}>View gallery <ArrowUpRight className="ml-2 h-4 w-4" /></Link>
          </Button>
          {canManageMedia && (
            <Button asChild variant="outline" className="min-h-10 w-full border-accent/60 text-accent hover:bg-accent/10 hover:text-accent">
              <Link href={`${galleryUrl}?tab=media`}><ImagePlus className="mr-2 h-4 w-4" />Manage media</Link>
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}