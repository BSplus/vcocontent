import { useState, useEffect, useRef } from "react";
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
import { Eye, PlayCircle, Download, Pencil, Trash2, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import EditMediaModal from "./edit-media-modal";
import { useAuth } from "@/hooks/use-auth";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ShareMenu } from "./share-menu";
import { downloadMedia, downloadOptionLabel } from "@/lib/media-download";
import { Link } from "wouter";

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
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const openItem = (item: MediaItem, index: number, opener: HTMLElement) => {
    openerRef.current = opener;
    setSelectedItem(item);
    setSelectedItemIndex(index);
  };

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
        if (e.target instanceof HTMLElement && (e.target.closest('[role="menu"]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))) return;
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateNext();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
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
      await downloadMedia(item, quality);
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {items.map((item, index) => (
          <article
            key={item.id}
            className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"
          >
            <div className="relative">
              <button
                type="button"
                className="block w-full aspect-[4/3] bg-black/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                aria-label={`Open ${item.type === 'video' ? 'video' : 'photo'}: ${item.caption || `Media ${item.id}`}`}
                onClick={(event) => {
                  if (isSelectionMode) { toggleSelection(item); return; }
                  openItem(item, index, event.currentTarget);
                }}
              >
                <img src={item.thumbnail} alt={item.caption || (item.type === 'video' ? 'Video preview' : 'Photo preview')} loading="lazy" className="h-full w-full object-contain" />
                <span className="absolute bottom-3 right-3 rounded bg-black/80 px-2 py-1 text-sm text-white flex items-center gap-2">
                  {item.type === 'video' ? <PlayCircle className="h-4 w-4" /> : <Eye className="h-4 w-4" />} Open
                </span>
              </button>
              {user?.isAdmin && (
              <div className="absolute top-2 left-2 z-20 rounded bg-black/80 p-2">
                <Checkbox
                  aria-label={`Select ${item.caption || `media ${item.id}`}`}
                  checked={selectedItems.has(item.id)}
                  onCheckedChange={() => toggleSelection(item)}
                  className="h-6 w-6 border-2 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                />
              </div>
              )}
            </div>
            <div className="p-4 space-y-2">
              <p className="text-sm font-medium line-clamp-2 min-h-5">{item.caption || (item.type === 'video' ? 'Video' : 'Photo')}</p>
              {item.photographer && <p className="text-sm text-foreground/75">By {item.photographer}</p>}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button variant="outline" size="sm" className="min-h-11" onClick={(event) => openItem(item, index, event.currentTarget)}>View</Button>
                <Link href={`/media/${item.id}`} className="rounded border border-border px-3 py-2 text-sm underline">Details</Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="min-h-11" aria-label={`Download ${item.caption || 'media'}`}><Download className="h-4 w-4" /> Download</Button></DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => handleDownload(item, 'high')}>{downloadOptionLabel(item, "high")}{!user && " · Sign in required"}</DropdownMenuItem>
                    {item.type === "image" && <DropdownMenuItem onSelect={() => handleDownload(item, 'low')}>{downloadOptionLabel(item, "low")}</DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>
                {user?.isAdmin && <><Button variant="outline" size="icon" className="h-11 w-11" aria-label="Edit media" onClick={() => setEditItem(item)}><Pencil /></Button><Button variant="outline" size="icon" className="h-11 w-11" aria-label="Delete media" onClick={() => handleSingleDelete(item)}><Trash2 /></Button></>}
              </div>
            </div>
          </article>
        ))}
      </div>

      <Dialog open={!!selectedItem} onOpenChange={(open) => { if (open) return;
        setSelectedItem(null);
        setSelectedItemIndex(-1);
      }}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-4xl max-h-[95dvh] overflow-y-auto" onCloseAutoFocus={(event) => {
          if (openerRef.current?.isConnected) {
            event.preventDefault();
            openerRef.current.focus();
          }
        }}>
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
            {selectedItem?.type === "video" && !user && (
              <p className="absolute bottom-2 left-2 right-2 rounded bg-black/85 px-3 py-2 text-sm text-white">Sign in to play this video. The preview is still available.</p>
            )}

            {/* Navigation buttons */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-between p-2">
              <div className="flex-none">
                {selectedItemIndex > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="pointer-events-auto bg-black/80 hover:bg-black h-12 w-12"
                    aria-label="Previous media item"
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
                    className="pointer-events-auto bg-black/80 hover:bg-black h-12 w-12"
                    aria-label="Next media item"
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
            <p className="text-sm text-foreground/75" aria-live="polite">{selectedItemIndex + 1} of {items.length} · Use arrow keys to browse</p>
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                {selectedItem?.photographer && (
                  <p className="text-sm text-muted-foreground">
                    Photographer: {selectedItem.photographer}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
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
                  url={`${window.location.origin}/media/${selectedItem?.id}`}
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
                      {selectedItem && downloadOptionLabel(selectedItem, "high")}{!user && " · Sign in required"}
                    </DropdownMenuItem>
                    {selectedItem?.type === "image" && <DropdownMenuItem onClick={() =>
                      selectedItem && handleDownload(selectedItem, 'low')
                    }>
                      {downloadOptionLabel(selectedItem, "low")}
                    </DropdownMenuItem>}
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