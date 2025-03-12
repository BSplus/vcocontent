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
      console.log(`Selected ${type} file:`, file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        console.log(`Converted ${type} file to data URL`);
        if (type === 'media') {
          setMediaPreview(dataUrl);
          form.setValue('url', dataUrl);
          // Reset thumbnail if not set
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

  const createMutation = useMutation({
    mutationFn: async (data: InsertMediaItem) => {
      console.log('Submitting media data:', data);
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
      if (!data.url || !data.thumbnail) {
        toast({
          title: "Error",
          description: "Please select both media file and thumbnail",
          variant: "destructive",
        });
        return;
      }

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
                        <label className="cursor-pointer">
                          <Input
                            type="file"
                            accept={form.getValues("type") === "image" ? "image/*" : "video/*"}
                            className="hidden"
                            onChange={handleFileChange('media')}
                          />
                          <Button type="button" variant="outline" className="bg-transparent border-primary/20">
                            <Upload className="h-4 w-4 mr-2" />
                            Choose File
                          </Button>
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="relative h-40 border rounded-lg bg-black/20 group">
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <Film className="h-8 w-8" />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                        <label className="cursor-pointer">
                          <Input
                            type="file"
                            accept="video/*"
                            className="hidden"
                            onChange={handleFileChange('media')}
                          />
                          <Button type="button" variant="outline" className="bg-transparent border-primary/20">
                            <Upload className="h-4 w-4 mr-2" />
                            Choose Video
                          </Button>
                        </label>
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
                  <label className="cursor-pointer">
                    <Input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileChange('thumbnail')}
                    />
                    <Button type="button" variant="outline" className="bg-transparent border-primary/20">
                      <Upload className="h-4 w-4 mr-2" />
                      Choose Thumbnail
                    </Button>
                  </label>
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