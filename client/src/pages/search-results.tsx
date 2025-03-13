import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { MediaItem } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import MediaGrid from "@/components/media-grid";
import { AdvancedSearch } from "@/components/advanced-search";

export default function SearchResults() {
  const [location] = useLocation();
  const [filteredMediaItems, setFilteredMediaItems] = useState<MediaItem[]>([]);

  // Get search parameters from URL
  const params = new URLSearchParams(location.split('?')[1]);
  const initialQuery = params.get('q') || '';
  const initialType = (params.get('type') || 'all') as 'all' | 'image' | 'video';
  const seriesId = params.get('seriesId');

  // Fetch all media items
  const { data: mediaItems = [], isLoading } = useQuery<MediaItem[]>({
    queryKey: ["/api/media"],
    onSuccess: (data) => {
      // Initial filtering based on URL parameters
      let filtered = [...data];

      // Filter by type if specified
      if (initialType !== 'all') {
        filtered = filtered.filter(item => item.type === initialType);
      }

      // Filter by series if specified
      if (seriesId) {
        filtered = filtered.filter(item => {
          // Find items that belong to events of the selected series
          return item.eventId && item.eventId > 0;
          // Note: We'll need to add series filtering once the API supports it
        });
      }

      setFilteredMediaItems(filtered);
    }
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
      <header className="border-b border-primary/20">
        <div className="container mx-auto px-4 py-6">
          <Button variant="ghost" asChild className="mb-4">
            <Link href="/">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Home
            </Link>
          </Button>
          <h1 className="text-4xl font-bold">Search Results</h1>
          {initialQuery && (
            <p className="text-muted-foreground mt-2">
              Search for: "{initialQuery}"
            </p>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <AdvancedSearch
          items={mediaItems}
          onSearchResults={setFilteredMediaItems}
          className="mb-8"
          initialQuery={initialQuery}
          initialType={initialType}
        />

        {!filteredMediaItems.length ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-lg">
              No matching media found.
            </p>
          </div>
        ) : (
          <MediaGrid items={filteredMediaItems} />
        )}
      </main>
    </div>
  );
}