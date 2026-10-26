import { useState, useCallback, useEffect } from "react";
import { useSearch, useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { MediaItem } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import MediaGrid from "@/components/media-grid";
import { AdvancedSearch } from "@/components/advanced-search";
import MainNavigation from "@/components/main-navigation";
import { parseSearchParams, parseSearchPage, serializeSearchParams, SearchFilters } from "@/lib/search-params";
import type { PageEnvelope } from "@shared/pagination";
import PageStatus from "@/components/page-status";
import { pluralize } from "@/lib/utils";

export default function SearchResults() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [pendingInput, setPendingInput] = useState(false);
  const { query, filters } = parseSearchParams(search);
  const page = parseSearchPage(search);

  const navigate = useCallback((query: string, filters: SearchFilters, replace: boolean, page = 1) => {
    const params = new URLSearchParams(serializeSearchParams(query, filters));
    if (page > 1) params.set("page", String(page));
    setLocation(params.size ? `/search?${params}` : "/search", { replace });
  }, [setLocation]);

  // The URL is the applied search, including its page. A new search always drops page.
  // Query keys isolate responses; consuming the query signal cancels obsolete requests.
  const { data, isFetching, isPending, isError, refetch } = useQuery<PageEnvelope<MediaItem>>({
    queryKey: [`/api/media?page=${page}&q=${encodeURIComponent(query)}&type=${filters.mediaType}&fields=${filters.fields.join(",")}&pagination=true`],
    staleTime: 30000,
    retry: false,
  });
  const busy = pendingInput || isFetching || isPending;
  const mediaItems = data?.items ?? [];
  useEffect(() => {
    if (!busy && !isError && data && data.page !== page) {
      // Correct only the page, retaining all filters and unknown URL parameters.
      const params = new URLSearchParams(search);
      if (data.page === 1) params.delete("page"); else params.set("page", String(data.page));
      setLocation(params.size ? `/search?${params}` : "/search", { replace: true });
    }
  }, [data, busy, isError, page, search, setLocation]);

  return (
    <div className="min-h-screen bg-background">
      <MainNavigation />
      <div className="container mx-auto px-4 py-8">
        <Button variant="ghost" asChild className="mb-4">
          <Link href="/"><ArrowLeft className="h-4 w-4 mr-2" />Back to Home</Link>
        </Button>
        <h1 className="text-2xl md:text-4xl font-bold">Search media</h1>
        {query && <p className="text-muted-foreground mt-2">Search results for: "{query}"</p>}
        <div className="mt-8">
          <AdvancedSearch
            onApply={navigate}
            onPendingChange={setPendingInput}
            className="mb-8"
            initialQuery={query}
            initialType={filters.mediaType}
            initialFields={filters.fields}
          />
          <section aria-label="Search results" aria-busy={busy}>
            {busy ? (
              <p role="status" className="flex items-center gap-2 py-8">
                <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />Searching media…
              </p>
            ) : isError ? (
              <div role="alert" className="rounded-lg border border-border bg-card p-6">
                <p>Could not load search results. Please try again.</p>
                <Button variant="outline" className="mt-4" onClick={() => refetch()}>Try again</Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-foreground/75 mb-5" role="status" aria-live="polite">
                  {mediaItems.length} media {pluralize(mediaItems.length, "item", "items")} · <PageStatus page={data!.page} totalPages={data!.totalPages} />
                </p>
                {mediaItems.length ? <MediaGrid key={search} items={mediaItems} /> : (
                  <div className="rounded-lg border border-border bg-card text-center py-12 px-4">
                    <p className="text-foreground/80 text-lg">
                      {page > 1 ? "No more media on this page. Go back to the previous page."
                        : "No matching media. Try another search term or change the filters."}
                    </p>
                  </div>
                )}
              </>
            )}
            <nav aria-label="Search result pages" className="flex justify-center gap-3 mt-8">
              <Button variant="outline" disabled={busy || isError || !data || data.page === 1} onClick={() => navigate(query, filters, false, page - 1)}>Previous</Button>
              <PageStatus className="self-center" page={data?.page ?? page} totalPages={!busy && !isError ? data?.totalPages : undefined} />
              <Button variant="outline" disabled={busy || isError || !data?.hasMore} onClick={() => navigate(query, filters, false, page + 1)}>Next</Button>
            </nav>
          </section>
        </div>
      </div>
    </div>
  );
}
