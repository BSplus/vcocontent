import { useState, useEffect, useCallback } from "react";
import Fuse from "fuse.js";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MediaItem } from "@shared/schema";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  items: MediaItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function SearchInput({ items, value, onChange, className }: SearchInputProps) {
  const [open, setOpen] = useState(false);
  const [fuse, setFuse] = useState<Fuse<MediaItem>>();
  const [suggestions, setSuggestions] = useState<MediaItem[]>([]);

  // Initialize Fuse instance
  useEffect(() => {
    const fuseInstance = new Fuse(items, {
      keys: ['caption', 'photographer', 'tags'],
      threshold: 0.3,
      ignoreLocation: true,
      findAllMatches: true,
    });
    setFuse(fuseInstance);
  }, [items]);

  // Handle search and generate suggestions
  const handleSearch = useCallback((searchValue: string) => {
    onChange(searchValue);
    
    if (!searchValue.trim() || !fuse) {
      setSuggestions([]);
      return;
    }

    const results = fuse.search(searchValue);
    const uniqueResults = Array.from(
      new Set(results.map(result => result.item))
    ).slice(0, 5);
    
    setSuggestions(uniqueResults);
  }, [fuse, onChange]);

  // Generate a preview text for each suggestion
  const getSuggestionPreview = (item: MediaItem) => {
    if (item.caption) return item.caption;
    if (item.photographer) return `📸 ${item.photographer}`;
    if (item.tags?.length) return `🏷️ ${item.tags.join(', ')}`;
    return 'Media item';
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className={cn("relative", className)}>
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search media by caption, photographer, or tags..."
            value={value}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10"
            onFocus={() => setOpen(true)}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Command>
          <CommandInput
            value={value}
            onValueChange={handleSearch}
            placeholder="Type to search..."
            className="border-none focus:ring-0"
          />
          <CommandEmpty>No results found.</CommandEmpty>
          {suggestions.length > 0 && (
            <CommandGroup heading="Suggestions">
              {suggestions.map((item, index) => (
                <CommandItem
                  key={`${item.id}-${index}`}
                  onSelect={() => {
                    onChange(getSuggestionPreview(item));
                    setOpen(false);
                  }}
                  className="flex flex-col items-start"
                >
                  <span className="font-medium">{getSuggestionPreview(item)}</span>
                  {item.tags && item.tags.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Tags: {item.tags.slice(0, 3).join(', ')}
                      {item.tags.length > 3 && '...'}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
