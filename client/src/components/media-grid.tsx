import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MediaItem } from "@shared/schema";
import { motion } from "framer-motion";
import { Eye, PlayCircle } from "lucide-react";

interface MediaGridProps {
  items: MediaItem[];
}

export default function MediaGrid({ items }: MediaGridProps) {
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [hoveredItem, setHoveredItem] = useState<MediaItem | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((item) => (
          <motion.div
            key={item.id}
            className="relative aspect-square cursor-pointer overflow-hidden rounded-lg bg-black/20"
            onHoverStart={() => setHoveredItem(item)}
            onHoverEnd={() => setHoveredItem(null)}
            onClick={() => setSelectedItem(item)}
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.2 }}
          >
            <img
              src={item.thumbnail}
              alt={item.caption || "Media item"}
              className="absolute inset-0 w-full h-full object-contain"
            />

            {/* Hover Preview Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: hoveredItem?.id === item.id ? 1 : 0 }}
              className="absolute inset-0 bg-black/60 flex flex-col justify-between p-4 text-white"
            >
              <div className="flex justify-between items-start">
                {item.type === "video" && (
                  <PlayCircle className="h-8 w-8" />
                )}
                <Eye className="h-6 w-6" />
              </div>

              <div className="space-y-2">
                {item.caption && (
                  <p className="text-sm font-medium line-clamp-2">
                    {item.caption}
                  </p>
                )}
                {item.photographer && (
                  <p className="text-xs text-gray-300">
                    📸 {item.photographer}
                  </p>
                )}
                {item.tags && item.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {item.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 bg-white/20 rounded-full text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                    {item.tags.length > 3 && (
                      <span className="text-xs text-gray-300">
                        +{item.tags.length - 3} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        ))}
      </div>

      {/* Full Preview Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {selectedItem?.caption || "Media Preview"}
            </DialogTitle>
          </DialogHeader>
          <div className="relative aspect-video bg-black/20">
            {selectedItem?.type === "video" ? (
              <video
                src={selectedItem.url}
                controls
                className="absolute inset-0 w-full h-full object-contain"
              />
            ) : (
              <img
                src={selectedItem?.url}
                alt={selectedItem?.caption || "Media preview"}
                className="absolute inset-0 w-full h-full object-contain"
              />
            )}
          </div>
          {selectedItem?.photographer && (
            <p className="text-sm text-muted-foreground">
              Photographer: {selectedItem.photographer}
            </p>
          )}
          {selectedItem?.tags && selectedItem.tags.length > 0 && (
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