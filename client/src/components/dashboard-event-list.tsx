import React, { useEffect, useState, type ReactNode } from "react";
import { Event, MediaItem } from "@shared/schema";
import { Image as ImageIcon, Film } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const EVENTS_PER_PAGE = 8;

export function getEventPage(events: Event[], search: string, page: number) {
  const query = search.trim().toLocaleLowerCase();
  const matches = events
    .filter(event => event.title.toLocaleLowerCase().includes(query))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.id - a.id);
  const pageCount = Math.max(1, Math.ceil(matches.length / EVENTS_PER_PAGE));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  return {
    matches,
    pageCount,
    currentPage,
    visible: matches.slice((currentPage - 1) * EVENTS_PER_PAGE, currentPage * EVENTS_PER_PAGE),
  };
}

interface DashboardEventListProps {
  title: string;
  events: Event[];
  mediaItems: MediaItem[];
  search: string;
  emptyMessage: string;
  showPremium?: boolean;
  actions: (event: Event) => ReactNode;
}

export default function DashboardEventList({
  title, events, mediaItems, search, emptyMessage, showPremium = false, actions,
}: DashboardEventListProps) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search]);
  const { matches, pageCount, currentPage, visible } = getEventPage(events, search, page);
  const counts = new Map<number, { photos: number; videos: number; premium: number; downloads: number }>();
  for (const item of mediaItems) {
    if (item.eventId === null) continue;
    const count = counts.get(item.eventId) ?? { photos: 0, videos: 0, premium: 0, downloads: 0 };
    if (item.type === "image") count.photos++;
    if (item.type === "video") count.videos++;
    if (item.isPremium) count.premium++;
    count.downloads += item.downloadCount || 0;
    counts.set(item.eventId, count);
  }

  return (
    <section aria-label={title} className="min-w-0">
      <h3 className="mb-3 text-lg font-semibold">{title} <span className="text-sm font-normal text-muted-foreground">({matches.length})</span></h3>
      {visible.length === 0 ? (
        <p className="rounded-md border border-border px-4 py-6 text-sm text-muted-foreground" role="status">
          {events.length === 0 ? emptyMessage : "No events match your search."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {visible.map(event => {
            const stats = counts.get(event.id) ?? { photos: 0, videos: 0, premium: 0, downloads: 0 };
            return (
              <li key={event.id} className="flex min-w-0 flex-col gap-2 px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-semibold leading-tight">{event.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <time dateTime={new Date(event.date).toISOString()}>{new Date(event.date).toLocaleDateString()}</time>
                    <Badge variant="secondary" className="gap-1"><ImageIcon className="h-3 w-3" />{stats.photos} Photos</Badge>
                    <Badge variant="secondary" className="gap-1"><Film className="h-3 w-3" />{stats.videos} Videos</Badge>
                    {showPremium && <span>{stats.premium} Premium</span>}
                    <span>{stats.downloads} Downloads</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">{actions(event)}</div>
              </li>
            );
          })}
        </ul>
      )}
      {matches.length > EVENTS_PER_PAGE && (
        <nav aria-label={`${title} pages`} className="mt-3 flex flex-wrap items-center justify-end gap-2 text-sm">
          <span className="mr-auto text-muted-foreground">Page {currentPage} of {pageCount}</span>
          <Button size="sm" variant="outline" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
        </nav>
      )}
    </section>
  );
}