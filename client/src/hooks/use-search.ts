import { useEffect, useState, SetStateAction } from 'react';
import { parseSearchParams, serializeSearchParams, SearchFilters } from '@/lib/search-params';

/** Draft input is never used to filter a loaded page. Apply it to the server search. */
export function useSearch(
  initialQuery: string,
  initialFilters: SearchFilters,
  onApply: (query: string, filters: SearchFilters, replace: boolean) => void,
  onPendingChange: (pending: boolean) => void,
) {
  const applied = serializeSearchParams(initialQuery, initialFilters);
  const [draft, setDraft] = useState(() => parseSearchParams(applied));
  const conditions = serializeSearchParams(draft.query, draft.filters);

  // Restore input and filters on direct navigation, including Back/Forward.
  useEffect(() => {
    setDraft(parseSearchParams(applied));
  }, [applied]);

  useEffect(() => {
    const pending = conditions !== applied;
    onPendingChange(pending);
    if (!pending) return;
    const timer = window.setTimeout(() => onApply(draft.query, draft.filters, true), 350);
    return () => window.clearTimeout(timer);
  }, [conditions, applied, onApply, onPendingChange]);

  return {
    searchQuery: draft.query,
    setSearchQuery: (query: string) => setDraft(prev => ({ ...prev, query })),
    filters: draft.filters,
    setFilters: (update: SetStateAction<SearchFilters>) => setDraft(prev => ({
      ...prev, filters: typeof update === 'function' ? update(prev.filters) : update,
    })),
    submit: () => onApply(draft.query, draft.filters, false),
  };
}
