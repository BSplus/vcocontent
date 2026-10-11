export const SEARCH_FIELDS = ['caption', 'photographer', 'tags', 'identification'] as const;

export type SearchField = typeof SEARCH_FIELDS[number];
export type MediaTypeFilter = 'all' | 'image' | 'video';

export interface SearchFilters {
  mediaType: MediaTypeFilter;
  fields: SearchField[];
}

export function parseSearchPage(search: string): number {
  const value = new URLSearchParams(search).get('page');
  const page = Number(value);
  return value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(page) ? page : 1;
}

export function parseSearchParams(search: string): { query: string; filters: SearchFilters } {
  const params = new URLSearchParams(search);
  const type = params.get('type');
  const selected = params.get('fields')?.split(',');

  return {
    query: params.get('q') || '',
    filters: {
      mediaType: type === 'image' || type === 'video' ? type : 'all',
      // Links without fields search across all available media metadata.
      fields: selected === undefined
        ? [...SEARCH_FIELDS]
        : SEARCH_FIELDS.filter(field => selected.includes(field)),
    },
  };
}

export function serializeSearchParams(query: string, filters: SearchFilters): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (filters.mediaType !== 'all') params.set('type', filters.mediaType);
  if (SEARCH_FIELDS.some(field => !filters.fields.includes(field))) {
    params.set('fields', SEARCH_FIELDS.filter(field => filters.fields.includes(field)).join(','));
  }
  return params.toString();
}