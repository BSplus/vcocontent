import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon } from "lucide-react";
import type { PageMetadata } from "@shared/pagination";
import PageStatus from "@/components/page-status";

type ThumbnailOption = { id: number; reference: string; preview: string; caption: string | null };
type ThumbnailPage = PageMetadata & { photos: ThumbnailOption[] };

export default function GalleryThumbnailSelector({ eventId, selectedReference, selectedPreview, onSelect }: {
  eventId: number;
  selectedReference: string | null;
  selectedPreview?: string;
  onSelect: (reference: string, preview: string) => void;
}) {
  const [pages, setPages] = useState<ThumbnailOption[][]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalPages, setTotalPages] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryPage, setRetryPage] = useState(1);
  const request = useRef<AbortController | null>(null);
  const photos = pages[page - 1] ?? [];
  const allPhotos = pages.flat();

  const loadPage = async (targetPage: number) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRetryPage(targetPage);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/thumbnail-options?page=${targetPage}`, {
        credentials: "include", signal: controller.signal,
      });
      if (!response.ok) throw new Error("Photos could not be loaded.");
      const result = await response.json() as ThumbnailPage;
      if (controller.signal.aborted) return;
      if (!Array.isArray(result.photos)) throw new Error("The photo list was not valid.");
      setPages(current => {
        const next = [...current];
        next[result.page - 1] = result.photos;
        return next;
      });
      setPage(result.page);
      setTotalPages(result.totalPages);
      setHasMore(result.hasMore);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Photos could not be loaded.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    setPages([]);
    setPage(1);
    setHasMore(true);
    setTotalPages(undefined);
    void loadPage(1);
    return () => request.current?.abort();
    // eventId controls the resource lifetime; loadPage intentionally reads the current id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const selected = allPhotos.find(photo => photo.reference === selectedReference);

  return <section aria-label="Choose a gallery photo" className="space-y-3 rounded-md border p-4">
    <div>
      <h3 className="font-medium">Choose from this gallery</h3>
      <p className="text-sm text-muted-foreground">Select an eligible photo to use as the event thumbnail.</p>
    </div>
    {selectedReference && <div className="flex items-center gap-3 rounded border bg-secondary/40 p-2" aria-live="polite">
      {selected?.preview || selectedPreview ? <img src={selected?.preview || selectedPreview} alt="" className="h-16 w-24 rounded object-cover" /> :
        <div className="flex h-16 w-24 items-center justify-center rounded bg-muted text-muted-foreground"><ImageIcon className="h-5 w-5" /></div>}
      <p className="min-w-0 break-words text-sm">{selected?.caption || "Selected gallery photo"}</p>
    </div>}
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
      <p>{error}</p><Button type="button" size="sm" variant="outline" onClick={() => void loadPage(retryPage)}>Retry</Button>
    </div>}
    {loading && photos.length === 0 && <div role="status" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => <div key={index} className="aspect-square animate-pulse rounded bg-muted" />)}
      <span className="sr-only">Loading gallery photos</span>
    </div>}
    {!loading && !error && photos.length === 0 && <div role="status" className="flex items-center gap-2 rounded border border-dashed p-4 text-sm text-muted-foreground">
      <ImageIcon className="h-5 w-5 shrink-0" aria-hidden="true" /><p>No eligible photos are available yet. Upload photos first; creator photos must pass their safety check before selection.</p>
    </div>}
    {photos.length > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {photos.map(photo => <button key={photo.id} type="button" aria-pressed={selectedReference === photo.reference}
        aria-label={`Select photo${photo.caption ? `: ${photo.caption}` : ` ${photo.id}`}`}
        onClick={() => onSelect(photo.reference, photo.preview)}
        className="group min-w-0 overflow-hidden rounded border border-border text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary">
        <img src={photo.preview} alt="" loading="lazy" className="aspect-square w-full object-cover" />
        <span className="block truncate px-2 py-1.5 text-xs">{photo.caption || `Photo ${photo.id}`}</span>
      </button>)}
    </div>}
    {photos.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2">
      <PageStatus page={page} totalPages={!loading && !error ? totalPages : undefined} />
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" disabled={loading || !!error || page === 1} onClick={() => void loadPage(page - 1)}>Previous photos</Button>
        <Button type="button" size="sm" variant="outline" disabled={loading || !!error || !hasMore} onClick={() => void loadPage(page + 1)}>More photos</Button>
      </div>
    </div>}
  </section>;
}
