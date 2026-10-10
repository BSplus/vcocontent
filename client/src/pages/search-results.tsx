import { useState, useCallback, useEffect } from "react";
import { useSearch, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { MediaItem } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import MediaGrid from "@/components/media-grid";
import { AdvancedSearch } from "@/components/advanced-search";
import MainNavigation from "@/components/main-navigation";
import { parseSearchParams } from "@/lib/search-params";

export default function SearchResults() {
  const search = useSearch();
  const [filteredMediaItems, setFilteredMediaItems] = useState<MediaItem[]>([]);
  const [activeQuery, setActiveQuery] = useState("");
  const [page, setPage] = useState(1);
  const handleResults = useCallback((results: MediaItem[], query: string) => {
    setFilteredMediaItems(results);
    setActiveQuery(query);
  }, []);

  // Get search parameters from URL
  const { query: initialQuery, filters } = parseSearchParams(search);
  useEffect(() => setPage(1), [search]);

  // Search is filtered in PostgreSQL before pagination, not in an unbounded list.
  const { data: mediaItems = [], isLoading } = useQuery<MediaItem[]>({
    queryKey: [`/api/media?page=${page}&q=${encodeURIComponent(initialQuery)}&type=${filters.mediaType}&fields=${filters.fields.join(",")}`],
    staleTime: 30000, // Cache for 30 seconds
  });

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <MainNavigation />

      <div className="container mx-auto px-4 py-8">
        <Button variant="ghost" asChild className="mb-4">
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Link>
        </Button>
        <h1 className="text-2xl md:text-4xl font-bold">Search media</h1>
        {initialQuery && (
          <p className="text-muted-foreground mt-2">
            Search results for: "{initialQuery}"
          </p>
        )}

        <div className="mt-8">
          <AdvancedSearch
            key={search}
            items={mediaItems}
            onSearchResults={handleResults}
            className="mb-8"
            initialQuery={initialQuery}
            initialType={filters.mediaType}
            initialFields={filters.fields}
          />

          <p className="text-sm text-foreground/75 mb-5" role="status" aria-live="polite">
            {activeQuery.trim() ? `${filteredMediaItems.length} matching media items` : "Search by caption, photographer or tag."}
          </p>
          {!filteredMediaItems.length ? (
            <div className="rounded-lg border border-border bg-card text-center py-12 px-4">
              <p className="text-foreground/80 text-lg">
                {activeQuery.trim() ? "No matching media. Try another search term or change the filters." : "Enter a search term above to find media."}
              </p>
            </div>
          ) : (
            <MediaGrid items={filteredMediaItems} />
          )}
          <div className="flex justify-center gap-3 mt-8">
            <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="self-center">Page {page}</span>
            <Button variant="outline" disabled={mediaItems.length < 48} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
