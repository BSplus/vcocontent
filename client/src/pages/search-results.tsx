import { useState, useEffect } from "react";
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

  // Fetch all media items
  const { data: mediaItems = [], isLoading } = useQuery<MediaItem[]>({
    queryKey: ["/api/media"],
    staleTime: 30000, // Cache for 30 seconds
  });

  // Set initial filtered items if we have a search query
  useEffect(() => {
    if (mediaItems.length > 0 && initialQuery) {
      setFilteredMediaItems(mediaItems);
    }
  }, [mediaItems, initialQuery]);

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
          <h1 className="text-4xl font-bold">Media Search</h1>
          {initialQuery && (
            <p className="text-muted-foreground mt-2">
              Search results for: "{initialQuery}"
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
              {initialQuery ? 
                "No matching media found." : 
                "Use the search above to find media items."
              }
            </p>
          </div>
        ) : (
          <MediaGrid items={filteredMediaItems} />
        )}
      </main>
    </div>
  );
}