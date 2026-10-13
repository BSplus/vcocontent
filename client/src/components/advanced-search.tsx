import React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSearch } from '@/hooks/use-search';
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
import { SearchField, MediaTypeFilter, SearchFilters } from '@/lib/search-params';

interface AdvancedSearchProps {
  onApply: (query: string, filters: SearchFilters, replace: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  className?: string;
  initialQuery?: string;
  initialType?: MediaTypeFilter;
  initialFields?: SearchField[];
}

export function AdvancedSearch({ 
  onApply,
  onPendingChange,
  className,
  initialQuery = '',
  initialType = 'all',
  initialFields = ['caption', 'photographer', 'tags', 'identification']
}: AdvancedSearchProps) {
  const { searchQuery, setSearchQuery, filters, setFilters, submit } = useSearch(
    initialQuery, { mediaType: initialType, fields: initialFields }, onApply, onPendingChange,
  );
  const toggleField = (field: SearchField, checked: boolean) => setFilters(prev => ({
    ...prev,
    fields: checked ? [...prev.fields, field] : prev.fields.filter(value => value !== field),
  }));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  return (
    <form onSubmit={handleSearch} className={`w-full ${className}`}>
      <label htmlFor="media-search" className="block text-sm font-semibold mb-2">Search media</label>
      <p id="media-search-help" className="text-sm text-foreground/75 mb-3">Search captions, photographers / videographers, tags or entry details. Use Filters to narrow the results.</p>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="media-search"
            type="search"
            aria-describedby="media-search-help"
            placeholder="Search media..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 min-h-11"
          />
        </div>

        <Sheet>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" className="min-h-11" aria-label="Open search filters">
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
                    checked={filters.fields.includes('caption')}
                    onCheckedChange={(checked) => 
                      toggleField('caption', checked === true)
                    }
                  />
                  <label htmlFor="caption" className="text-sm font-medium">
                    Captions
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="identification"
                    checked={filters.fields.includes('identification')}
                    onCheckedChange={(checked) =>
                      toggleField('identification', checked === true)
                    }
                  />
                  <label htmlFor="identification" className="text-sm font-medium">
                    Race number, team, drivers & vehicle
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="photographer" 
                    checked={filters.fields.includes('photographer')}
                    onCheckedChange={(checked) => 
                      toggleField('photographer', checked === true)
                    }
                  />
                  <label htmlFor="photographer" className="text-sm font-medium">
                    Photographers / Videographers
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="tags" 
                    checked={filters.fields.includes('tags')}
                    onCheckedChange={(checked) => 
                      toggleField('tags', checked === true)
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

          </SheetContent>
        </Sheet>

        <Button type="submit" className="min-h-11">
          Search media
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
