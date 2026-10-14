import React, { useEffect, useState } from "react";
import type { Event } from "@shared/schema";
import { Image as ImageIcon } from "lucide-react";
import { isLegacyEventImage, OFFICIAL_EVENT_IMAGE_FALLBACK } from "@/lib/event-image";

function eventThumbnailSources(event: Event) {
  const sources: string[] = [];
  for (const field of ["customThumbnail", "coverImage"] as const) {
    const value = event[field];
    if (!value || event.isPremium || isLegacyEventImage(value)) continue;
    // Small cache-busting key, even for historical inline image values.
    let version = 0;
    for (let i = 0; i < value.length; i++) version = (version * 31 + value.charCodeAt(i)) | 0;
    sources.push(`/api/events/${event.id}/thumbnail?field=${field}&v=${version}`);
  }
  sources.push(OFFICIAL_EVENT_IMAGE_FALLBACK);
  return sources;
}

export default function SafeEventImage({ event, alt = "" }: { event: Event; alt?: string }) {
  const sources = eventThumbnailSources(event);
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [event.id, event.customThumbnail, event.coverImage]);
  const source = sources[sourceIndex];
  const isFallback = source === OFFICIAL_EVENT_IMAGE_FALLBACK;

  if (!source) return <div className="flex h-full w-full items-center justify-center text-muted-foreground" aria-label="No event image">
    <ImageIcon className="h-10 w-10" aria-hidden="true" />
  </div>;

  return <img src={source} alt={alt} loading="lazy" className={`h-full w-full ${isFallback ? "bg-[#17191b] p-6 object-contain" : "object-cover"}`}
    onError={() => setSourceIndex(index => Math.min(index + 1, sources.length))} />;
}
