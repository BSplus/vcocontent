
import { useState, useEffect, useCallback } from 'react';
import Fuse from 'fuse.js';
import { MediaItem } from '@shared/schema';

export type SearchableItem = MediaItem;

interface UseSearchOptions {
  keys: string[];
  threshold?: number;
  distance?: number;
}

export function useSearch<T extends SearchableItem>(
  items: T[],
  options: UseSearchOptions
) {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [fuse, setFuse] = useState<Fuse<T> | null>(null);

  // Initialisieren der Fuse-Instanz mit verbesserten Einstellungen
  useEffect(() => {
    if (!items.length) return;
    
    const fuseOptions = {
      keys: options.keys,
      threshold: options.threshold || 0.3,
      distance: options.distance || 100,
      ignoreLocation: true,
      includeScore: true,
      useExtendedSearch: true,
      minMatchCharLength: 2,
      shouldSort: true,
      findAllMatches: true
    };
    
    setFuse(new Fuse(items, fuseOptions));
  }, [items, options.keys, options.threshold, options.distance]);

  // Suche durchführen und Ergebnisse filtern
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
      
      // Nur die Items extrahieren
      const filteredResults = searchResults.map(result => result.item);
      setResults(filteredResults);
    } catch (error) {
      console.error('Fehler bei der Suche:', error);
      setResults(items);
    }
  }, [fuse, items]);

  return {
    searchQuery,
    setSearchQuery: performSearch,
    results,
    resetSearch: () => {
      setSearchQuery('');
      setResults(items);
    }
  };
}
