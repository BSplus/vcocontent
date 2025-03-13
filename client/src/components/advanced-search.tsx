
import React, { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

interface AdvancedSearchProps {
  items: MediaItem[];
  onSearchResults: (results: MediaItem[]) => void;
  className?: string;
}

export function AdvancedSearch({ items, onSearchResults, className }: AdvancedSearchProps) {
  const [filters, setFilters] = useState({
    includeCaption: true,
    includePhotographer: true,
    includeTags: true,
    mediaType: 'all',
  });

  // Suchfelder basierend auf Filtern generieren
  const getSearchKeys = () => {
    const keys = [];
    if (filters.includeCaption) keys.push({ name: 'caption', weight: 2 });
    if (filters.includePhotographer) keys.push({ name: 'photographer', weight: 1 });
    if (filters.includeTags) keys.push({ name: 'tags', weight: 1 });
    
    // Fallback, falls keine Schlüssel ausgewählt sind
    if (keys.length === 0) {
      keys.push({ name: 'caption', weight: 1 });
    }
    
    return keys;
  };

  const { searchQuery, setSearchQuery, results } = useSearch(items, {
    keys: getSearchKeys(),
    threshold: 0.3,
    distance: 100,
  });

  // Nach jeder Suche die Ergebnisse an die übergeordnete Komponente übergeben
  React.useEffect(() => {
    // Weitere Filterung basierend auf mediaType
    let filteredResults = [...results];
    
    if (filters.mediaType !== 'all') {
      filteredResults = filteredResults.filter(item => 
        item.type === filters.mediaType
      );
    }
    
    onSearchResults(filteredResults);
  }, [results, filters.mediaType, onSearchResults]);

  return (
    <div className={`w-full ${className}`}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Suche in Medien..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                console.log('Suche ausgeführt:', searchQuery);
              }
            }}
          />
        </div>
        
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Erweiterte Sucheinstellungen</SheetTitle>
              <SheetDescription>
                Passen Sie die Suchoptionen an Ihre Bedürfnisse an.
              </SheetDescription>
            </SheetHeader>
            
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Suchbereiche</Label>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="caption" 
                    checked={filters.includeCaption}
                    onCheckedChange={(checked) => 
                      setFilters(prev => ({ ...prev, includeCaption: checked === true }))
                    }
                  />
                  <label htmlFor="caption" className="text-sm font-medium">
                    Beschreibungen
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
                    Fotografen
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
                <Label>Medientyp</Label>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="all" 
                    checked={filters.mediaType === 'all'}
                    onCheckedChange={(checked) => {
                      if (checked) setFilters(prev => ({ ...prev, mediaType: 'all' }));
                    }}
                  />
                  <label htmlFor="all" className="text-sm font-medium">
                    Alle Medien
                  </label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="image" 
                    checked={filters.mediaType === 'image'}
                    onCheckedChange={(checked) => {
                      if (checked) setFilters(prev => ({ ...prev, mediaType: 'image' }));
                    }}
                  />
                  <label htmlFor="image" className="text-sm font-medium">
                    Nur Bilder
                  </label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="video" 
                    checked={filters.mediaType === 'video'}
                    onCheckedChange={(checked) => {
                      if (checked) setFilters(prev => ({ ...prev, mediaType: 'video' }));
                    }}
                  />
                  <label htmlFor="video" className="text-sm font-medium">
                    Nur Videos
                  </label>
                </div>
              </div>
            </div>
            
            {searchQuery && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground">
                  {results.length} Ergebnisse gefunden für "{searchQuery}"
                </p>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
      
      {searchQuery && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="outline" className="flex items-center gap-1">
            Suchbegriff: {searchQuery}
            <button 
              onClick={() => setSearchQuery('')}
              className="ml-1 h-4 w-4 rounded-full hover:bg-muted flex items-center justify-center"
            >
              ×
            </button>
          </Badge>
          
          {filters.mediaType !== 'all' && (
            <Badge variant="outline">
              Typ: {filters.mediaType === 'image' ? 'Nur Bilder' : 'Nur Videos'}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
