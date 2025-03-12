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
import { motion } from "framer-motion";
import { Eye, PlayCircle, Download, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import EditMediaModal from "./edit-media-modal";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface MediaGridProps {
  items: MediaItem[];
}

export default function MediaGrid({ items }: MediaGridProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<MediaItem | null>(null);
  const [editItem, setEditItem] = useState<MediaItem | null>(null);
  const [hoveredItem, setHoveredItem] = useState<MediaItem | null>(null);
  const [videoStills, setVideoStills] = useState<{ [key: number]: string[] }>({});
  const [currentStillIndex, setCurrentStillIndex] = useState<{ [key: number]: number }>({});
  const stillIntervalRef = useRef<{ [key: number]: NodeJS.Timeout }>({});

  // Update the deleteMutation implementation
  const deleteMutation = useMutation({
    mutationFn: async (mediaId: number) => {
      try {
        const res = await fetch(`/api/media/${mediaId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.message || "Failed to delete media");
        }

        return mediaId;
      } catch (error) {
        console.error('Delete media error:', error);
        throw error;
      }
    },
    onSuccess: (_, mediaId) => {
      // Invalidate both the global media query and the event-specific media query
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      if (itemToDelete?.eventId) {
        queryClient.invalidateQueries({ 
          queryKey: [`/api/events/${itemToDelete.eventId}/media`] 
        });
      }
      setItemToDelete(null);
      toast({
        title: "Success",
        description: "Media item deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete media item",
        variant: "destructive",
      });
      setItemToDelete(null);
    },
  });

  // Function to generate video stills
  const generateVideoStills = async (video: HTMLVideoElement, itemId: number) => {
    const stills: string[] = [];
    const duration = video.duration;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Generate 5 stills at different timestamps
    for (let i = 0; i < 5; i++) {
      video.currentTime = (duration * (i + 1)) / 6;
      await new Promise(resolve => {
        video.onseeked = resolve;
      });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      stills.push(canvas.toDataURL('image/jpeg'));
    }

    setVideoStills(prev => ({ ...prev, [itemId]: stills }));
  };

  // Handle video hover
  useEffect(() => {
    if (hoveredItem?.type === 'video' && !videoStills[hoveredItem.id]) {
      const video = document.createElement('video');
      video.src = hoveredItem.url;
      video.onloadedmetadata = () => generateVideoStills(video, hoveredItem.id);
    }

    if (hoveredItem?.type === 'video' && videoStills[hoveredItem.id]) {
      // Start cycling through stills
      setCurrentStillIndex(prev => ({ ...prev, [hoveredItem.id]: 0 }));
      stillIntervalRef.current[hoveredItem.id] = setInterval(() => {
        setCurrentStillIndex(prev => ({
          ...prev,
          [hoveredItem.id]: (prev[hoveredItem.id] + 1) % videoStills[hoveredItem.id].length
        }));
      }, 1000);
    }

    return () => {
      if (hoveredItem?.id && stillIntervalRef.current[hoveredItem.id]) {
        clearInterval(stillIntervalRef.current[hoveredItem.id]);
      }
    };
  }, [hoveredItem]);

  const compressImage = async (url: string, quality: number = 0.3): Promise<string> => {
    // Create a temporary image to load the original
    const img = new Image();
    img.crossOrigin = "anonymous"; // Handle CORS

    return new Promise((resolve, reject) => {
      img.onload = () => {
        // Create a canvas element
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Set canvas dimensions to match the image
        canvas.width = img.width;
        canvas.height = img.height;

        // Draw the image onto the canvas
        ctx?.drawImage(img, 0, 0);

        // Convert to compressed data URL
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = url;
    });
  };

  const handleDownload = async (url: string, quality: 'high' | 'low', type: 'image' | 'video') => {
    try {
      let downloadUrl = url;
      let filename = url.split('/').pop() || 'download';

      if (type === 'image' && quality === 'low') {
        // Compress image for low quality download
        downloadUrl = await compressImage(url, 0.3);
      }

      let response = await fetch(downloadUrl);
      let blob = await response.blob();

      // Check file size for low quality
      if (quality === 'low' && blob.size > 1024 * 1024) {
        // If still over 1MB, compress more
        if (type === 'image') {
          downloadUrl = await compressImage(url, 0.1);
          response = await fetch(downloadUrl);
          const recompressedBlob = await response.blob();
          blob = recompressedBlob;
        }
      }

      const extension = type === 'video' ? '.mp4' : '.jpg';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${filename}-${quality}${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

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
              src={
                item.type === 'video' &&
                hoveredItem?.id === item.id &&
                videoStills[item.id]?.[currentStillIndex[item.id]]
                  ? videoStills[item.id][currentStillIndex[item.id]]
                  : item.thumbnail
              }
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
                <div className="flex gap-2">
                  <Eye className="h-6 w-6" />
                  {user?.isAdmin && (
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
                          setItemToDelete(item);
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
                        handleDownload(item.url, 'high', item.type as 'video' | 'image');
                      }}>
                        Download High-Res
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(item.thumbnail, 'low', item.type as 'video' | 'image');
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() =>
                    selectedItem && handleDownload(selectedItem.url, 'high', selectedItem.type as 'video' | 'image')
                  }>
                    Download High-Res
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() =>
                    selectedItem && handleDownload(selectedItem.thumbnail, 'low', selectedItem.type as 'video' | 'image')
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
        </DialogContent>
      </Dialog>

      {/* Add Delete Confirmation Dialog */}
      <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Media Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this media item? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => itemToDelete && deleteMutation.mutateAsync(itemToDelete.id)}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Modal */}
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