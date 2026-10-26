import { useEffect, useState, type ReactNode } from "react";
import type { Event, MediaItem } from "@shared/schema";
import { getEventPage } from "./dashboard-event-list";
import { formatDate, pluralize } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import SafeEventImage from "@/components/safe-event-image";
import PageStatus from "@/components/page-status";

export default function CreatorGalleryCards({events,mediaItems,eventCounts,search,actions}:{
  title:string;events:Event[];mediaItems:MediaItem[];
  eventCounts?:Map<number,{photos:number;videos:number;downloads:number}>;
  search:string;emptyMessage:string;actions:(event:Event)=>ReactNode;
}) {
  const [page,setPage]=useState(1);
  useEffect(()=>setPage(1),[search]);
  const {visible,pageCount,currentPage}=getEventPage(events,search,page);
  useEffect(()=>setPage(currentPage),[currentPage]);
  return <section aria-label="My Galleries">
    {!visible.length && <p role="status" className="border border-dashed p-8">No galleries match your search.</p>}
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {visible.map(event=>{
        const ownMedia=mediaItems.filter(item=>item.eventId===event.id);
        const stats=eventCounts?.get(event.id);
         const photos = stats?.photos ?? ownMedia.filter(m=>m.type==="image").length;
         const downloads = stats?.downloads ?? ownMedia.reduce((sum,m)=>sum+m.downloadCount,0);
        return <article key={event.id} className="overflow-hidden border border-border bg-card">
          <div className="relative aspect-[4/3] bg-secondary">
            <SafeEventImage event={event} />
            <Badge className="absolute bottom-3 left-3 bg-background text-foreground">{event.visibility==="published"?"Published":"Draft"}</Badge>
          </div>
          <div className="p-5">
            <h3 className="break-words text-2xl">{event.title}</h3>
            <time className="mt-2 block text-sm text-muted-foreground" dateTime={new Date(event.date).toISOString()}>{formatDate(event.date)}</time>
            <p className="mt-2 text-sm">{photos} {pluralize(photos, "photo", "photos")} · {downloads} {pluralize(downloads, "download", "downloads")}</p>
            {event.adminHidden && <p className="mt-2 text-sm text-destructive">Hidden by administrator</p>}
            {["blocked","review","error"].includes(event.safetyStatus) && <p className="mt-2 text-sm text-muted-foreground">Safety: {event.safetyStatus}</p>}
            <div className="mt-4 flex flex-wrap gap-2">{actions(event)}</div>
          </div>
        </article>;
      })}
    </div>
    {pageCount>1 && <nav aria-label="Gallery pages" className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <Button variant="outline" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Previous</Button>
      <PageStatus page={currentPage} totalPages={pageCount} />
      <Button variant="outline" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}>Next</Button>
    </nav>}
  </section>;
}
