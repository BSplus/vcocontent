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
import { MediaItem } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Wand2 } from "lucide-react";
import { analysisPending, requestAnalysis, useMediaAnalysis } from "@/hooks/use-media-analysis";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { z } from "zod";

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

interface CaptionPreview {
  numbers: string[];
  matches: { number: string; team: string; car: string; drivers: string }[];
  scene: string | null;
  suggestion: string;
  ambiguous: boolean;
}

type CaptionScene = "Race Action" | "Start" | "Finish";

const editFormSchema = z.object({
  caption: z.string().max(1000, "Caption cannot exceed 1000 characters"),
  photographer: z.string(),
  tags: z.string(),
});

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
  const [captionPreview, setCaptionPreview] = useState<CaptionPreview | null>(null);
  const [selectedScene, setSelectedScene] = useState<CaptionScene | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      caption: mediaItem.caption || "",
      photographer: mediaItem.photographer || "",
      tags: mediaItem.tags?.join(", ") || "",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({ caption: mediaItem.caption || "", photographer: mediaItem.photographer || "", tags: mediaItem.tags?.join(", ") || "" });
    setCaptionPreview(null);
    setSelectedScene(null);
  }, [open, mediaItem.id]);

  const captionPreviewMutation = useMutation({
    mutationFn: async (scene?: CaptionScene) => {
      const res = await fetch(`/api/media/${mediaItem.id}/caption-preview`, {
        method: "POST",
        credentials: "include",
        ...(scene && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scene }),
        }),
      });
      if (!res.ok) {
        throw new Error("Caption suggestion could not be generated. Please try again.");
      }
      return res.json() as Promise<CaptionPreview>;
    },
    onSuccess: (data) => {
      setCaptionPreview(data);
    },
    onError: (error: Error) => {
      toast({
        title: "Caption Suggestion Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<MediaItem>) => {
      const res = await apiRequest("PUT", `/api/media/${mediaItem.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: query =>
        String(query.queryKey[0]).startsWith(`/api/events/${mediaItem.eventId}/media`) });
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
  const analysis = useMediaAnalysis(mediaItem.id, open && mediaItem.type === "image");
  useEffect(() => {
    setIsAnalyzing(analysisPending(analysis.data?.status));
    if (analysis.data?.status !== "completed") return;
    setAiTags(analysis.data.generatedTags || []);
    setCategory(analysis.data.category || null);
    const typed = form.getValues("tags").split(",").map(tag => tag.trim()).filter(Boolean);
    form.setValue("tags", Array.from(new Set([...typed, ...(analysis.data.tags || [])])).join(", "), { shouldDirty: true });
    queryClient.invalidateQueries({ predicate: query =>
      String(query.queryKey[0]).startsWith(`/api/events/${mediaItem.eventId}/media`) });
  }, [analysis.data, mediaItem.id]);
  const analysisMutation = useMutation({
    mutationFn: () => requestAnalysis(mediaItem.id, analysis.data?.status === "failed"),
    onSuccess: (data) => {
      setIsAnalyzing(analysisPending(data.status));
      queryClient.invalidateQueries({ queryKey: [`/api/media/${mediaItem.id}/analysis`] });
      toast({ title: data.status === "completed" ? "Existing analysis reused" : "Analysis queued",
        description: "You can close this dialog; your media is already saved." });
    },
    onError: (error: Error) => {
      toast({
        title: "AI Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
      setIsAnalyzing(false);
    },
  });

  const handleAIAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      await analysisMutation.mutateAsync();
    } catch {
      // The mutation displays the safe status message above.
    } finally {
      // The persisted job status now controls the activity indicator.
    }
  };

  const onSubmit = async (formData: FormData) => {
    try {
      // Convert comma-separated string to array of tags
      const tags = formData.tags
        ? formData.tags.split(',').map((tag: string) => tag.trim()).filter(Boolean)
        : [];

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
       <DialogContent className="max-h-[90vh] overflow-y-auto">
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
              maxLength={1000}
              {...form.register("caption")}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectedScene(null);
                  captionPreviewMutation.mutate(undefined);
                }}
                disabled={captionPreviewMutation.isPending}
              >
                {captionPreviewMutation.isPending && selectedScene === null ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : null}
                Suggest Caption
              </Button>
              {(["Race Action", "Start", "Finish"] as const).map((scene) => (
                <Button
                  key={scene}
                  type="button"
                  size="sm"
                  variant={selectedScene === scene ? "default" : "outline"}
                  onClick={() => {
                    setSelectedScene(scene);
                    captionPreviewMutation.mutate(scene);
                  }}
                  disabled={captionPreviewMutation.isPending}
                >
                  {captionPreviewMutation.isPending && selectedScene === scene ? (
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  ) : null}
                  {scene}
                </Button>
              ))}
            </div>
            {form.formState.errors.caption && (
              <p className="text-sm text-destructive">{form.formState.errors.caption.message}</p>
            )}
            {captionPreview && (
              <div className="space-y-3 rounded-md border p-3">
                {captionPreview.scene && (
                  <p className="text-sm font-medium">Scene: {captionPreview.scene}</p>
                )}
                {captionPreview.numbers.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Detected numbers</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {captionPreview.numbers.map((number, index) => (
                        <Badge key={`${number}-${index}`} variant="outline">{number}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {captionPreview.matches.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Matching entries</p>
                    {captionPreview.matches.map((match, index) => (
                      <p key={`${match.number}-${index}`} className="text-sm">
                        #{match.number} · {match.team} · {match.car} · {match.drivers}
                      </p>
                    ))}
                  </div>
                )}
                {captionPreview.ambiguous && (
                  <p className="text-sm text-amber-600">
                    Some detected numbers have ambiguous matches. Review the suggestion before applying it.
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="caption-suggestion">Caption suggestion (editable)</Label>
                  <Textarea
                    id="caption-suggestion"
                    value={captionPreview.suggestion}
                    maxLength={1000}
                    onChange={(event) => setCaptionPreview({
                      ...captionPreview,
                      suggestion: event.target.value,
                    })}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => form.setValue("caption", captionPreview.suggestion, { shouldValidate: true, shouldDirty: true })}
                  >
                    Apply Suggestion to Caption
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="photographer">Photographer</Label>
            <Input
              id="photographer"
              {...form.register("photographer")}
            />
          </div>

          <div className="space-y-2">
             <div className="flex flex-wrap items-center justify-between gap-2">
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
                    <span>{analysis.data?.status === "failed" ? "Retry analysis" : "Auto-Generate Tags"}</span>
                  </>
                )}
              </Button>
              {analysis.data && <p role="status" className="text-sm text-muted-foreground">
                AI: {analysis.data.status}{analysis.data.error ? ` · ${analysis.data.error}` : ""}
                {analysisPending(analysis.data.status) ? " · Runs server-side; resumes when the server restarts." : ""}
              </p>}
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

           <div className="flex flex-wrap justify-end gap-2">
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
