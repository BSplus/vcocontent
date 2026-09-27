import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MediaItem } from "@shared/schema";
import { motion } from "framer-motion";
import { Eye, PlayCircle, Download, Pencil, Trash2, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import EditMediaModal from "./edit-media-modal";
import { useAuth } from "@/hooks/use-auth";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ShareMenu } from "./share-menu";

interface MediaGridProps {
  items: MediaItem[];
  onDelete?: (deletedItemIds: number[]) => void;
}

export default function MediaGrid({ items, onDelete }: MediaGridProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [selectedItemIndex, setSelectedItemIndex] = useState<number>(-1);
  const [itemsToDelete, setItemsToDelete] = useState<MediaItem[]>([]);
  const [editItem, setEditItem] = useState<MediaItem | null>(null);
  const [hoveredItem, setHoveredItem] = useState<MediaItem | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // Navigation functions
  const navigateNext = () => {
    if (selectedItemIndex < items.length - 1) {
      const nextIndex = selectedItemIndex + 1;
      setSelectedItemIndex(nextIndex);
      setSelectedItem(items[nextIndex]);
    }
  };

  const navigatePrevious = () => {
    if (selectedItemIndex > 0) {
      const prevIndex = selectedItemIndex - 1;
      setSelectedItemIndex(prevIndex);
      setSelectedItem(items[prevIndex]);
    }
  };

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (selectedItem) {
        if (e.key === 'ArrowRight') {
          navigateNext();
        } else if (e.key === 'ArrowLeft') {
          navigatePrevious();
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [selectedItem, selectedItemIndex, items]);

  // Delete mutation implementation
  const deleteMutation = useMutation({
    mutationFn: async (mediaIds: number[]) => {
      const results = await Promise.all(
        mediaIds.map(async (id) => {
          const res = await fetch(`/api/media/${id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
          });

          if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || "Failed to delete media");
          }

          return id;
        })
      );
      return results;
    },
    onSuccess: (deletedIds) => {
      onDelete?.(deletedIds);
      setItemsToDelete([]);
      setSelectedItems(new Set());
      setIsSelectionMode(false);
      toast({
        title: "Success",
        description: `${deletedIds.length} item${deletedIds.length > 1 ? 's' : ''} deleted successfully`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete media items",
        variant: "destructive",
      });
      setItemsToDelete([]);
    },
  });

  const handleDownload = async (item: MediaItem, quality: 'high' | 'low') => {
    try {
      const authorization = await fetch(`/api/media/${item.id}/download`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!authorization.ok) {
        const message = await authorization.text();
        throw new Error(message || `Download authorization failed (${authorization.status})`);
      }

      const contentType = authorization.headers.get('content-type') || '';
      let blob: Blob;
      let filename = `media-${item.id}`;
      if (contentType.includes('application/json')) {
        const result = await authorization.json();
        if (typeof result.url !== 'string' || !result.url) {
          throw new Error('The server did not provide an authorized media download URL.');
        }
        filename = result.url.split('/').pop() || filename;
        const downloadUrl = quality === 'low' ? item.thumbnail : result.url;
        const response = await fetch(downloadUrl, { credentials: 'include' });
        if (!response.ok) throw new Error(`Media download failed (${response.status})`);
        blob = await response.blob();
      } else {
        // Some authorized endpoints stream the media directly instead of returning a URL.
        blob = await authorization.blob();
      }

      const extension = item.type === 'video' ? '.mp4' : '.jpg';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${filename}-${quality}${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href); // Clean up
    } catch (error) {
      console.error('Download failed:', error);
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Unable to download this media item.",
        variant: "destructive",
      });
    }
  };

  const toggleSelection = (item: MediaItem) => {
    const newSelectedItems = new Set(selectedItems);
    if (selectedItems.has(item.id)) {
      newSelectedItems.delete(item.id);
    } else {
      newSelectedItems.add(item.id);
    }
    setSelectedItems(newSelectedItems);
  };

  const handleBulkDelete = async () => {
    const itemsToDelete = Array.from(selectedItems).map(id => items.find(item => item.id === id));
    setItemsToDelete(itemsToDelete.filter(item => item !== undefined) as MediaItem[]);
    setIsSelectionMode(false);
  };

  const handleSingleDelete = (item:MediaItem) => {
    setItemsToDelete([item]);
  }

  return (
    <>
      {user?.isAdmin && selectedItems.size > 0 && (
        <div className="sticky top-20 z-40 mb-4 flex items-center justify-between bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-4 rounded-lg border">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5" />
            <span>{selectedItems.size} items selected</span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSelectedItems(new Set());
                setIsSelectionMode(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
            >
              Delete Selected
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((item, index) => (
          <motion.div
            key={item.id}
            className="relative aspect-square cursor-pointer overflow-hidden rounded-lg bg-black/20"
            onHoverStart={() => setHoveredItem(item)}
            onHoverEnd={() => setHoveredItem(null)}
            onClick={(e) => {
              if (isSelectionMode) {
                e.preventDefault();
                toggleSelection(item);
              } else {
                setSelectedItem(item);
                setSelectedItemIndex(index);
              }
            }}
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.2 }}
          >
            <img
              src={item.thumbnail}
              alt={item.caption || "Media item"}
              className="absolute inset-0 w-full h-full object-contain"
            />

            {user?.isAdmin && (isSelectionMode || hoveredItem?.id === item.id) && (
              <div className="absolute top-2 left-2 z-20">
                <Checkbox
                  checked={selectedItems.has(item.id)}
                  onCheckedChange={() => toggleSelection(item)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-5 w-5 border-2 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                />
              </div>
            )}

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: hoveredItem?.id === item.id ? 1 : 0 }}
              className="absolute inset-0 bg-black/60 flex flex-col justify-between p-4 text-white"
            >
              <div className="flex justify-between items-start">
                {/* Left side - empty unless there's a video icon */}
                <div className="flex-1">
                  {/* This space intentionally left empty for the checkbox that's rendered separately */}
                </div>

                {/* Right side - all action icons */}
                <div className="flex items-center gap-2">
                  {item.type === "video" && (
                    <PlayCircle className="h-6 w-6" />
                  )}
                  <Eye className="h-6 w-6" />
                  {user?.isAdmin && !isSelectionMode && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditItem(item);
                        }}
                      >
                        <Pencil className="h-6 w-6" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-white hover:text-red-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSingleDelete(item);
                        }}
                      >
                        <Trash2 className="h-6 w-6" />
                      </Button>
                    </>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-white">
                        <Download className="h-6 w-6" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(item, 'high');
                      }}>
                        Download High-Res
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(item, 'low');
                      }}>
                        Download Low-Res
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
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

      <Dialog open={!!selectedItem} onOpenChange={() => {
        setSelectedItem(null);
        setSelectedItemIndex(-1);
      }}>
        <DialogContent className="max-w-4xl sm:max-h-[90vh] max-h-[100vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedItem?.caption || "Media Preview"}
            </DialogTitle>
          </DialogHeader>

          <div className="relative aspect-video bg-black/20">
            {selectedItem?.type === "video" && user && selectedItem.url
              ? <video
                  key={selectedItem.id}
                  src={selectedItem.url}
                  poster={selectedItem.thumbnail}
                  controls
                  preload="none"
                  className="absolute inset-0 w-full h-full object-contain"
                />
              : <img
                  src={selectedItem?.thumbnail}
                  alt={selectedItem?.caption || "Media preview"}
                  className="absolute inset-0 w-full h-full object-contain"
                />}

            {/* Navigation buttons */}
            <div className="absolute inset-0 flex items-center justify-between p-2">
              <div className="flex-none">
                {selectedItemIndex > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="bg-black/60 hover:bg-black/80 h-12 w-12"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigatePrevious();
                    }}
                  >
                    <ChevronLeft className="h-8 w-8" />
                  </Button>
                )}
              </div>
              <div className="flex-none">
                {selectedItemIndex < items.length - 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="bg-black/60 hover:bg-black/80 h-12 w-12"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateNext();
                    }}
                  >
                    <ChevronRight className="h-8 w-8" />
                  </Button>
                )}
              </div>
            </div>

          </div>

          <div className="space-y-4 mt-4">
            <div className="flex justify-between items-center">
              <div>
                {selectedItem?.photographer && (
                  <p className="text-sm text-muted-foreground">
                    Photographer: {selectedItem.photographer}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {user?.isAdmin && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedItem(null);
                      selectedItem && setEditItem(selectedItem);
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                )}
                <ShareMenu 
                  url={window.location.href}
                  title={selectedItem?.caption || 'Media item'}
                  description={selectedItem?.photographer ? `Photo by ${selectedItem.photographer}` : undefined}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() =>
                      selectedItem && handleDownload(selectedItem, 'high')
                    }>
                      Download High-Res
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() =>
                      selectedItem && handleDownload(selectedItem, 'low')
                    }>
                      Download Low-Res
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

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
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={itemsToDelete.length > 0}
        onOpenChange={(open) => !open && setItemsToDelete([])}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Media {itemsToDelete.length > 1 ? 'Items' : 'Item'}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {itemsToDelete.length > 1 ? `these ${itemsToDelete.length} items` : 'this item'}? 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => deleteMutation.mutateAsync(itemsToDelete.map(item => item.id))}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {user?.isAdmin && editItem && (
        <EditMediaModal
          open={!!editItem}
          onOpenChange={(open) => !open && setEditItem(null)}
          mediaItem={editItem}
        />
      )}
    </>
  );
}