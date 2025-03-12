import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { InsertMediaItem, insertMediaItemSchema } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Image as ImageIcon, Film, Upload } from "lucide-react";

interface MediaUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number;
}

export default function MediaUploadModal({
  open,
  onOpenChange,
  eventId,
}: MediaUploadModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const form = useForm<InsertMediaItem>({
    resolver: zodResolver(insertMediaItemSchema),
    defaultValues: {
      eventId,
      type: "image",
      url: "",
      thumbnail: "",
      caption: "",
      photographer: "",
      tags: [],
    },
  });

  const handleFileChange = (type: 'media' | 'thumbnail') => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const MAX_FILE_SIZE = file.type.startsWith('video/')
        ? 200 * 1024 * 1024  // 200MB for videos
        : 10 * 1024 * 1024;  // 10MB for images

      if (file.size > MAX_FILE_SIZE) {
        const sizeInMB = (file.size / (1024 * 1024)).toFixed(1);
        const limit = file.type.startsWith('video/') ? '200MB' : '10MB';
        toast({
          title: "Error",
          description: `File size too large. Maximum size is ${limit}. Your file is ${sizeInMB}MB`,
          variant: "destructive",
        });
        event.target.value = ''; // Reset input
        return;
      }

      // Calculate approximate base64 size
      const base64Size = Math.round((file.size * 4) / 3);
      const base64Limit = file.type.startsWith('video/')
        ? 190 * 1024 * 1024  // 190MB base64 limit for videos
        : 45 * 1024 * 1024;  // 45MB base64 limit for images

      if (base64Size > base64Limit) {
        toast({
          title: "Error",
          description: "File will be too large after encoding. Please choose a smaller file.",
          variant: "destructive",
        });
        event.target.value = ''; // Reset input
        return;
      }

      console.log(`Selected ${type} file:`, file.name, `(${(file.size / (1024 * 1024)).toFixed(1)}MB)`);
      const reader = new FileReader();

      // Add progress event
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = (e.loaded / e.total) * 50; // First 50% for file reading
          setUploadProgress(progress);
        }
      };

      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        console.log(`Converted ${type} file to data URL`);
        if (type === 'media') {
          setMediaPreview(dataUrl);
          form.setValue('url', dataUrl);
          if (!thumbnailPreview) {
            setThumbnailPreview(dataUrl);
            form.setValue('thumbnail', dataUrl);
          }
        } else {
          setThumbnailPreview(dataUrl);
          form.setValue('thumbnail', dataUrl);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerFileInput = (type: 'media' | 'thumbnail') => {
    console.log(`Triggering ${type} file input`);
    if (type === 'media') {
      mediaInputRef.current?.click();
    } else {
      thumbnailInputRef.current?.click();
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: InsertMediaItem) => {
      setUploadProgress(50); // Start at 50% after file reading
      console.log('Submitting media data:', {
        ...data,
        url: data.url.substring(0, 100) + '...',
        thumbnail: data.thumbnail.substring(0, 100) + '...'
      });

      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 5;
        });
      }, 300);

      try {
        const res = await apiRequest("POST", "/api/media", data);
        clearInterval(progressInterval);
        setUploadProgress(100);
        return res.json();
      } catch (error) {
        clearInterval(progressInterval);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/${eventId}/media`] });
      onOpenChange(false);
      form.reset();
      setMediaPreview(null);
      setThumbnailPreview(null);
      setUploadProgress(0);
      toast({
        title: "Success",
        description: "Media item uploaded successfully",
      });
    },
    onError: (error: Error) => {
      console.error('Media upload error:', error);
      setUploadProgress(0);
      toast({
        title: "Error",
        description: error.message || "Failed to upload media",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: InsertMediaItem) => {
    try {
      if (!data.url || !data.thumbnail) {
        toast({
          title: "Error",
          description: "Please select both media file and thumbnail",
          variant: "destructive",
        });
        return;
      }

      // Check if we have eventId
      if (!eventId) {
        toast({
          title: "Error",
          description: "No event selected for upload",
          variant: "destructive",
        });
        return;
      }

      // Process tags
      const tags = typeof data.tags === 'string'
        ? data.tags.split(',').map(tag => tag.trim()).filter(Boolean)
        : (data.tags || []);

      const formattedData = {
        ...data,
        eventId,
        tags,
      };

      console.log('Starting media upload...', {
        eventId,
        type: formattedData.type,
        caption: formattedData.caption,
        photographer: formattedData.photographer,
        tags: formattedData.tags,
      });

      await createMutation.mutateAsync(formattedData);
    } catch (error) {
      console.error('Form submission error:', error);
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload media",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (!open) {
      form.reset();
      setMediaPreview(null);
      setThumbnailPreview(null);
      setUploadProgress(0);
    }
  }, [open, form]);

  const tooltipText = "Maximum file size: 10MB";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Media</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {(uploadProgress > 0 || createMutation.isPending) && (
            <div className="space-y-2">
              <Progress value={uploadProgress} className="h-2" />
              <p className="text-sm text-muted-foreground text-center">
                {uploadProgress < 100 ? "Uploading..." : "Processing..."}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="type">Type</Label>
              <span className="text-xs text-muted-foreground">{tooltipText}</span>
            </div>
            <Select
              onValueChange={(value) => form.setValue("type", value as "image" | "video")}
              defaultValue={form.getValues("type")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select media type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="image">Image</SelectItem>
                <SelectItem value="video">Video</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Input
            type="file"
            ref={mediaInputRef}
            className="hidden"
            accept={form.getValues("type") === "image" ? "image/*" : "video/*"}
            onChange={handleFileChange('media')}
          />
          <Input
            type="file"
            ref={thumbnailInputRef}
            className="hidden"
            accept="image/*"
            onChange={handleFileChange('thumbnail')}
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Media File</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  {form.getValues("type") === "image" ? (
                    <div className="relative h-40 border rounded-lg overflow-hidden bg-black/20 group">
                      {mediaPreview ? (
                        <img
                          src={mediaPreview}
                          alt="Media preview"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                          <ImageIcon className="h-8 w-8" />
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          type="button"
                          variant="outline"
                          className="bg-transparent border-primary/20"
                          onClick={() => triggerFileInput('media')}
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          Choose File
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="relative h-40 border rounded-lg bg-black/20 group">
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <Film className="h-8 w-8" />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          type="button"
                          variant="outline"
                          className="bg-transparent border-primary/20"
                          onClick={() => triggerFileInput('media')}
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          Choose Video
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Thumbnail</Label>
              <div className="relative h-40 border rounded-lg overflow-hidden bg-black/20 group">
                {thumbnailPreview ? (
                  <img
                    src={thumbnailPreview}
                    alt="Thumbnail preview"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    type="button"
                    variant="outline"
                    className="bg-transparent border-primary/20"
                    onClick={() => triggerFileInput('thumbnail')}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Choose Thumbnail
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="caption">Caption</Label>
            <Textarea
              id="caption"
              {...form.register("caption")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="photographer">Photographer</Label>
            <Input
              id="photographer"
              {...form.register("photographer")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              placeholder="racing, action, pit-stop"
              {...form.register("tags")}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-primary text-black hover:bg-primary/90"
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                "Upload Media"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}