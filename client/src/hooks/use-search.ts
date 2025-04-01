import { useState, useEffect, useCallback } from 'react';
import Fuse from 'fuse.js';
import { MediaItem } from '@shared/schema';

export type SearchableItem = MediaItem | any;

interface UseSearchOptions {
  includeScore?: boolean;
  shouldSort?: boolean;
  threshold?: number;
  location?: number;
  distance?: number;
  minMatchCharLength?: number;
  keys: {
    name: string;
    weight: number;
  }[];
}

const DEFAULT_OPTIONS: Partial<UseSearchOptions> = {
  includeScore: true,
  shouldSort: true,
  threshold: 0.3,
  distance: 100,
  minMatchCharLength: 2,
};

export function useSearch<T extends SearchableItem>(
  items: T[],
  searchQuery: string,
  options: UseSearchOptions
) {
  const [internalSearchQuery, setInternalSearchQuery] = useState(searchQuery);
  const [results, setResults] = useState<T[]>([]);
  const [fuse, setFuse] = useState<Fuse<T> | null>(null);

  // Initialize Fuse instance with optimized settings
  useEffect(() => {
    if (!items.length) return;

    const fuseOptions = {
      ...DEFAULT_OPTIONS,
      ...options,
      keys: options.keys,
      ignoreLocation: true,
      useExtendedSearch: true,
      findAllMatches: true,
      includeMatches: true,
      sortFn: (a: Fuse.FuseResult<T>, b: Fuse.FuseResult<T>) => {
        // Custom sorting: prioritize exact matches, then by score
        const aExact = a.matches?.some(match => match.value === searchQuery);
        const bExact = b.matches?.some(match => match.value === searchQuery);
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return (a.score || 1) - (b.score || 1);
      }
    };

    setFuse(new Fuse(items, fuseOptions));
  }, [items, options, searchQuery]);

  // Perform search with improved matching
  const performSearch = useCallback((query: string) => {
    setSearchQuery(query);

    if (!query.trim() || !fuse) {
      setResults(items);
      return;
    }

    try {
      console.log(`Searching for: "${query}" in ${items.length} items`);
      const searchResults = fuse.search(query);
      console.log(`Found ${searchResults.length} results`);

      // Extract and deduplicate items
      const uniqueResults = Array.from(
        new Map(searchResults.map(result => [result.item.id, result.item]))
      ).map(([, item]) => item);

      setResults(uniqueResults);
    } catch (error) {
      console.error('Search error:', error);
      setResults(items);
    }
  }, [fuse, items]);

  return {
    searchQuery,
    setSearchQuery: performSearch,
    results,
    resetSearch: useCallback(() => {
      setSearchQuery('');
      setResults(items);
    }, [items])
  };
}