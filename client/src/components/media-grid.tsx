import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MediaItem } from "@shared/schema";

interface MediaGridProps {
  items: MediaItem[];
}

export default function MediaGrid({ items }: MediaGridProps) {
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="relative aspect-square cursor-pointer group"
            onClick={() => setSelectedItem(item)}
          >
            <img
              src={item.thumbnail}
              alt={item.caption || "Media item"}
              className="object-cover w-full h-full rounded-md"
            />
            {item.type === "video" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                <svg
                  className="w-12 h-12 text-white"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {selectedItem?.caption || "Media Preview"}
            </DialogTitle>
          </DialogHeader>
          <div className="relative aspect-video">
            {selectedItem?.type === "video" ? (
              <video
                src={selectedItem.url}
                controls
                className="w-full h-full object-contain"
              />
            ) : (
              <img
                src={selectedItem?.url}
                alt={selectedItem?.caption || "Media preview"}
                className="w-full h-full object-contain"
              />
            )}
          </div>
          {selectedItem?.photographer && (
            <p className="text-sm text-muted-foreground">
              Photographer: {selectedItem.photographer}
            </p>
          )}
          {selectedItem?.tags?.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {selectedItem.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 bg-secondary text-secondary-foreground text-sm rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
