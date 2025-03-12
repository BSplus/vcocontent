import { useEffect, useState } from "react";
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
import { Loader2, Image as ImageIcon, Film } from "lucide-react";

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

  const form = useForm<InsertMediaItem>({
    resolver: zodResolver(insertMediaItemSchema),
    defaultValues: {
      eventId,
      type: "image",
      url: "/attached_assets/%2389_3.png", // Default for testing
      thumbnail: "/attached_assets/%2389_3.png", // Default for testing
      caption: "",
      photographer: "",
      tags: [],
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertMediaItem) => {
      const res = await apiRequest("POST", "/api/media", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/${eventId}/media`] });
      onOpenChange(false);
      form.reset();
      setMediaPreview(null);
      setThumbnailPreview(null);
      toast({
        title: "Success",
        description: "Media item uploaded successfully",
      });
    },
    onError: (error: Error) => {
      console.error('Media upload error:', error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: InsertMediaItem) => {
    try {
      // Convert comma-separated tags string to array if it's a string
      const formattedData = {
        ...data,
        tags: typeof data.tags === 'string' ? data.tags.split(',').map(tag => tag.trim()) : data.tags || [],
      };
      await createMutation.mutateAsync(formattedData);
    } catch (error) {
      console.error('Form submission error:', error);
    }
  };

  useEffect(() => {
    if (!open) {
      form.reset();
      setMediaPreview(null);
      setThumbnailPreview(null);
    }
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Media</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <Select 
              onValueChange={(value) => form.setValue("type", value)}
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Media File</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  {form.getValues("type") === "image" ? (
                    <div className="h-40 border rounded-lg overflow-hidden bg-black/20">
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
                    </div>
                  ) : (
                    <div className="h-40 border rounded-lg flex items-center justify-center bg-black/20">
                      <Film className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Thumbnail</Label>
              <div className="h-40 border rounded-lg overflow-hidden bg-black/20">
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
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-primary text-black hover:bg-primary/90"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
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