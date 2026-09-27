import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSearch } from '@/hooks/use-search';
import { MediaItem } from '@shared/schema';
import { Badge } from '@/components/ui/badge';
import { 
  Sheet, 
  SheetContent, 
  SheetDescription, 
  SheetHeader, 
  SheetTitle,
  SheetTrigger 
} from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';

interface AdvancedSearchProps {
  items: MediaItem[];
  onSearchResults: (results: MediaItem[], query: string) => void;
  className?: string;
  initialQuery?: string;
  initialType?: 'all' | 'image' | 'video';
}

export function AdvancedSearch({ 
  items, 
  onSearchResults, 
  className,
  initialQuery = '',
  initialType = 'all'
}: AdvancedSearchProps) {
  const [, setLocation] = useLocation();
  const [filters, setFilters] = useState({
    includeCaption: true,
    includePhotographer: true,
    includeTags: true,
    mediaType: initialType,
  });

  const searchKeys = useMemo(() => {
    const keys = [];
    if (filters.includeCaption) {
      keys.push({ name: 'caption', weight: 2 });
    }
    if (filters.includePhotographer) {
      keys.push({ name: 'photographer', weight: 1 });
    }
    if (filters.includeTags) {
      keys.push({ 
        name: 'tags', 
        weight: 1.5,
        getFn: (item: MediaItem) => item.tags?.join(' ') || '' 
      });
    }
    return keys;
  }, [filters.includeCaption, filters.includePhotographer, filters.includeTags]);

  const searchOptions = useMemo(() => ({
    keys: searchKeys,
    threshold: 0.3,
    distance: 100,
  }), [searchKeys]);

  const { searchQuery, setSearchQuery, results } = useSearch(items, searchOptions);

  // Initialize search query from URL if provided
  useEffect(() => {
    setSearchQuery(initialQuery);
  }, [initialQuery, setSearchQuery]);

  useEffect(() => {
    setFilters(prev => prev.mediaType === initialType ? prev : { ...prev, mediaType: initialType });
  }, [initialType]);

  // Update results whenever search parameters change
  useEffect(() => {
    let filteredResults = searchQuery.trim() ? [...results] : [];

    if (filters.mediaType !== 'all') {
      filteredResults = filteredResults.filter(item => 
        item.type === filters.mediaType
      );
    }

    onSearchResults(filteredResults, searchQuery);
  }, [results, filters.mediaType, onSearchResults, searchQuery]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const searchParams = new URLSearchParams();
    if (searchQuery) searchParams.set('q', searchQuery);
    if (filters.mediaType !== 'all') searchParams.set('type', filters.mediaType);

    // Navigate to search results page with parameters
    setLocation(`/search?${searchParams.toString()}`);
  };

  return (
    <form onSubmit={handleSearch} className={`w-full ${className}`}>
      <label htmlFor="media-search" className="block text-sm font-semibold mb-2">Search media</label>
      <p id="media-search-help" className="text-sm text-foreground/75 mb-3">Search captions, photographers or tags. Use Filters to narrow the results.</p>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="media-search"
            type="search"
            aria-describedby="media-search-help"
            placeholder="Search in media..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 min-h-11"
          />
        </div>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" className="min-h-11" aria-label="Open search filters">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              <span className="ml-2">Filters</span>
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Search Settings</SheetTitle>
              <SheetDescription>
                Adjust search parameters
              </SheetDescription>
            </SheetHeader>

            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <p className="text-sm font-semibold">Search fields</p>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="caption" 
                    checked={filters.includeCaption}
                    onCheckedChange={(checked) => 
                      setFilters(prev => ({ ...prev, includeCaption: checked === true }))
                    }
                  />
                  <label htmlFor="caption" className="text-sm font-medium">
                    Captions
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="photographer" 
                    checked={filters.includePhotographer}
                    onCheckedChange={(checked) => 
                      setFilters(prev => ({ ...prev, includePhotographer: checked === true }))
                    }
                  />
                  <label htmlFor="photographer" className="text-sm font-medium">
                    Photographers
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="tags" 
                    checked={filters.includeTags}
                    onCheckedChange={(checked) => 
                      setFilters(prev => ({ ...prev, includeTags: checked === true }))
                    }
                  />
                  <label htmlFor="tags" className="text-sm font-medium">
                    Tags
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Media type (choose one)</p>
                <div className="flex items-center space-x-2">
                  <input type="radio" name="media-type" id="all" value="all" checked={filters.mediaType === 'all'} onChange={() => setFilters(prev => ({ ...prev, mediaType: 'all' }))} className="h-5 w-5 accent-primary" />
                  <label htmlFor="all" className="text-sm font-medium">
                    All Media
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <input type="radio" name="media-type" id="image" value="image" checked={filters.mediaType === 'image'} onChange={() => setFilters(prev => ({ ...prev, mediaType: 'image' }))} className="h-5 w-5 accent-primary" />
                  <label htmlFor="image" className="text-sm font-medium">
                    Images Only
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <input type="radio" name="media-type" id="video" value="video" checked={filters.mediaType === 'video'} onChange={() => setFilters(prev => ({ ...prev, mediaType: 'video' }))} className="h-5 w-5 accent-primary" />
                  <label htmlFor="video" className="text-sm font-medium">
                    Videos Only
                  </label>
                </div>
              </div>
            </div>

            {searchQuery && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground">
                  {results.length} results found for "{searchQuery}"
                </p>
              </div>
            )}
          </SheetContent>
        </Sheet>

        <Button type="submit" className="min-h-11">
          Search
        </Button>
      </div>

      {searchQuery && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="outline" className="flex items-center gap-1">
            Search term: {searchQuery}
            <button type="button" aria-label="Clear search term"
              onClick={() => setSearchQuery('')}
              className="ml-1 h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center"
            >
              ×
            </button>
          </Badge>

          {filters.mediaType !== 'all' && (
            <Badge variant="outline">
              Type: {filters.mediaType === 'image' ? 'Images Only' : 'Videos Only'}
            </Badge>
          )}
        </div>
      )}
    </form>
  );
}