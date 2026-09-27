import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
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
  onSearch?: (value: string) => void;
}

export function SearchInput({ items, value, onChange, onSearch, className }: SearchInputProps) {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [fuse, setFuse] = useState<Fuse<MediaItem>>();
  const [suggestions, setSuggestions] = useState<MediaItem[]>([]);

  useEffect(() => {
    const fuseInstance = new Fuse(items, {
      keys: [
        { name: 'caption', weight: 2 },
        { name: 'photographer', weight: 1 },
        { name: 'tags', weight: 1.5, getFn: (item) => item.tags?.join(' ') || '' },
        { name: 'title', weight: 2 }
      ],
      threshold: 0.4,
      distance: 100,
      ignoreLocation: true,
      includeScore: true,
      useExtendedSearch: true,
      minMatchCharLength: 2,
      shouldSort: true,
      findAllMatches: true
    });
    setFuse(fuseInstance);
  }, [items]);

  const handleSearch = useCallback((searchValue: string) => {
    onChange(searchValue);

    if (!searchValue.trim() || !fuse) {
      setSuggestions([]);
      return;
    }

    const results = fuse.search(searchValue);
    const uniqueResults = Array.from(
      new Map(results.map(result => [result.item.id, result.item]))
    ).slice(0, 5);

    setSuggestions(uniqueResults.map(([_, item]) => item));
  }, [fuse, onChange]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (value.trim()) {
      const searchParams = new URLSearchParams();
      searchParams.set('q', value);
      setLocation(`/search?${searchParams.toString()}`);
      onSearch?.(value);
      setOpen(false);
    }
  };

  const getSuggestionPreview = (item: MediaItem) => {
    const parts = [];
    if (item.caption) parts.push(item.caption);
    if (item.photographer) parts.push(`📸 ${item.photographer}`);
    if (item.tags?.length) parts.push(`🏷️ ${item.tags.join(', ')}`);
    return parts.length ? parts.join(' - ') : 'Media item';
  };

  return (
    <form onSubmit={handleSubmit} className={cn("relative", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search by description, photographer, or tags..."
              value={value}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-10"
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
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
                {suggestions.map((item) => (
                  <CommandItem
                    key={item.id}
                    onSelect={() => {
                      onChange(getSuggestionPreview(item));
                      setOpen(false);
                      handleSubmit();
                    }}
                    className="flex flex-col items-start gap-1"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.caption || 'Untitled'}</span>
                      {item.type === 'video' && <span className="text-xs bg-primary/20 px-1.5 py-0.5 rounded">Video</span>}
                    </div>
                    {(item.photographer || (item.tags?.length ?? 0) > 0) && (
                      <span className="text-xs text-muted-foreground">
                        {[
                          item.photographer && `📸 ${item.photographer}`,
                          item.tags?.length && `🏷️ ${item.tags.join(', ')}`
                        ].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </form>
  );
}