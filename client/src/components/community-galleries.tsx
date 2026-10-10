import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertCircle, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { CommunityGallery } from "@/types/creator-association";

interface CommunityGalleriesProps {
  officialEventId: number;
}

export default function CommunityGalleries({ officialEventId }: CommunityGalleriesProps) {
  const { data: galleries, isLoading, isError, refetch } = useQuery<CommunityGallery[]>({
    queryKey: [`/api/events/${officialEventId}/community-galleries`],
    enabled: officialEventId > 0,
    retry: false,
    staleTime: 30_000,
  });

  return (
    <section className="mt-12 border-t border-primary/20 pt-8" aria-labelledby="community-galleries-heading">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-widest text-primary">Creator community</p>
          <h2 id="community-galleries-heading" className="mt-2 text-xl font-semibold md:text-2xl">Community galleries</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Independent creator galleries associated with this official event.</p>
        </div>
        {!isLoading && !isError && !!galleries?.length && <Badge variant="outline">{galleries.length} {galleries.length === 1 ? "gallery" : "galleries"}</Badge>}
      </div>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2" role="status" aria-label="Loading community galleries">
          {[0, 1].map(item => <div key={item} className="h-24 animate-pulse border border-border bg-card" />)}
        </div>
      ) : isError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-destructive/30 bg-card p-4 text-sm" role="alert">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-destructive" />Community galleries could not be loaded.</span>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void refetch()}>Retry</Button>
        </div>
      ) : galleries?.length ? (
        <ul className="divide-y divide-border border-y border-border">
          {galleries.map(gallery => (
            <li key={gallery.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <Images className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0">
                  <Link href={`/events/${gallery.id}`} className="break-words font-semibold underline decoration-primary/50 underline-offset-4 hover:text-primary">
                    {gallery.title}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <time dateTime={new Date(gallery.date).toISOString()}>{formatDate(gallery.date)}</time>
                    {" · "}by{" "}
                    <Link href={`/creator/${gallery.creatorId}`} className="underline underline-offset-2 hover:text-primary">
                      {gallery.creatorName}
                    </Link>
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" className="min-h-11 shrink-0">
                <Link href={`/events/${gallery.id}`}>Open gallery</Link>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="border border-dashed border-border bg-card/50 px-5 py-7 text-sm text-muted-foreground">
          No creator galleries are linked to this event yet.
        </div>
      )}
    </section>
  );
}
