import { useState, useEffect, useCallback } from 'react';
import Fuse from 'fuse.js';
import { MediaItem } from '@shared/schema';

export type SearchableItem = MediaItem;

interface UseSearchOptions<T> {
  includeScore?: boolean;
  shouldSort?: boolean;
  threshold?: number;
  location?: number;
  distance?: number;
  minMatchCharLength?: number;
  keys: {
    name: string;
    weight: number;
    getFn?: (item: T) => string;
  }[];
}

const DEFAULT_OPTIONS = {
  includeScore: true,
  shouldSort: true,
  threshold: 0.3,
  distance: 100,
  minMatchCharLength: 2,
};

export function useSearch<T extends SearchableItem>(
  items: T[],
  options: UseSearchOptions<T>,
  initialQuery = ''
) {
  const [searchQuery, setSearchQueryState] = useState(initialQuery);
  const [results, setResults] = useState<T[]>([]);
  const [fuse, setFuse] = useState<Fuse<T> | null>(null);

  // Initialize Fuse instance with optimized settings
  useEffect(() => {
    const fuseOptions = {
      ...DEFAULT_OPTIONS,
      ...options,
      keys: options.keys,
      ignoreLocation: true,
      useExtendedSearch: true,
      findAllMatches: true,
      includeMatches: true,
    };

    setFuse(new Fuse(items, fuseOptions));
  }, [items, options]);

  // Perform search with improved matching
  const performSearch = useCallback((query: string) => {
    setSearchQueryState(query);

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

  // Re-run the current query when the index or media list changes.
  useEffect(() => {
    performSearch(searchQuery);
  }, [performSearch]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setResults(items);
    }
  }, [items, searchQuery]);

  return {
    searchQuery,
    setSearchQuery: performSearch,
    results,
    resetSearch: useCallback(() => {
      setSearchQueryState('');
      setResults(items);
    }, [items])
  };
}