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
import { Loader2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiTags, setAiTags] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);

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

  // AI analysis mutation
  const analysisMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/media/${mediaItem.id}/analyze`, {});
      return res.json();
    },
    onSuccess: (data) => {
      setAiTags(data.tags || []);
      setCategory(data.category || null);
      
      // Update the form with the new tags
      if (data.tags && data.tags.length > 0) {
        form.setValue("tags", data.tags.join(", "));
      }
      
      toast({
        title: "AI Analysis Complete",
        description: `Generated ${data.tags?.length || 0} tags for your media`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "AI Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAIAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      await analysisMutation.mutateAsync();
    } finally {
      setIsAnalyzing(false);
    }
  };

  const onSubmit = async (formData: FormData) => {
    try {
      // Convert comma-separated string to array of tags
      const tags = formData.tags
        ? formData.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean)
        : null;

      await updateMutation.mutateAsync({
        ...formData,
        tags,
        // Include category if provided by AI
        ...(category && { category })
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
            <div className="flex items-center justify-between">
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleAIAnalysis}
                disabled={isAnalyzing || analysisMutation.isPending}
                className="flex items-center gap-1"
                title="Generate tags using AI"
              >
                {isAnalyzing || analysisMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Analyzing...</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="h-3 w-3" />
                    <span>Auto-Generate Tags</span>
                  </>
                )}
              </Button>
            </div>
            
            <Input
              id="tags"
              placeholder="racing, action, pit-stop"
              {...form.register("tags")}
            />
            
            {aiTags.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-1">AI-generated tags:</p>
                <div className="flex flex-wrap gap-1">
                  {aiTags.map((tag, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            
            {category && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground">Category: 
                  <Badge variant="secondary" className="ml-2">
                    {category}
                  </Badge>
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updateMutation.isPending || isAnalyzing}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateMutation.isPending || isAnalyzing}
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