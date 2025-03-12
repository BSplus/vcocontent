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
import { useToast } from "@/hooks/use-toast";
import { MediaItem, insertMediaItemSchema } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

interface EditMediaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediaItem: MediaItem;
}

// Type for form data
interface FormData {
  caption: string;
  photographer: string;
  tags: string;
}

export default function EditMediaModal({
  open,
  onOpenChange,
  mediaItem,
}: EditMediaModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FormData>({
    resolver: zodResolver(insertMediaItemSchema.partial()),
    defaultValues: {
      caption: mediaItem.caption || "",
      photographer: mediaItem.photographer || "",
      tags: mediaItem.tags?.join(", ") || "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<MediaItem>) => {
      const res = await apiRequest("PUT", `/api/media/${mediaItem.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/${mediaItem.eventId}/media`] });
      onOpenChange(false);
      toast({
        title: "Success",
        description: "Media item updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (formData: FormData) => {
    try {
      // Convert comma-separated string to array of tags
      const tags = formData.tags
        ? formData.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean)
        : null;

      await updateMutation.mutateAsync({
        ...formData,
        tags,
      });
    } catch (error) {
      console.error('Form submission error:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Media</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <div className="relative aspect-video bg-black/20 rounded-lg overflow-hidden">
              {mediaItem.type === "video" ? (
                <video
                  src={mediaItem.url}
                  controls
                  className="w-full h-full object-contain"
                />
              ) : (
                <img
                  src={mediaItem.url}
                  alt={mediaItem.caption || "Media preview"}
                  className="w-full h-full object-contain"
                />
              )}
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
              disabled={updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending}
              className="bg-primary text-black hover:bg-primary/90"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Updating...
                </>
              ) : (
                "Update Media"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}