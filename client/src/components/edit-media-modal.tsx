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
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { MediaIdentification } from "@/hooks/use-media-analysis";
import { parseEditableTags, reconcileAnalysisTags } from "@/lib/reconcile-analysis-tags";
import VideoPreview from "@/components/video-preview";
import { useAuth } from "@/hooks/use-auth";
import AssignNumberAction from "@/components/assign-number-dialog";

interface EditMediaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mediaItem: MediaItem;
  onCloseAutoFocus?: (event: Event) => void;
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
  onCloseAutoFocus,
}: EditMediaModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [identification, setIdentification] = useState<MediaIdentification[]>([]);
  const appliedGeneration = useRef<string | null>(null);
  const syncedIdentificationGeneration = useRef<string | null>(null);
  const observedPending = useRef(false);
  const tagsAtAnalysisStart = useRef<string[]>([]);
  const identificationEdited = useRef(false);
  const tagsEdited = useRef(false);
  const sessionEdited = useRef(false);
  const captionEdited = useRef(false);
  const [recognitionSession, setRecognitionSession] = useState("");
  const savedTagSnapshot = useRef<string[]>([]);
  const assignedCaptionProtection = useRef<string | null>(null);
  const assignedIdentificationProtection = useRef<MediaIdentification[] | null>(null);
  const [captionPreview, setCaptionPreview] = useState<CaptionPreview | null>(null);
  const [selectedScene, setSelectedScene] = useState<CaptionScene | null>(null);
  const editorBaseline = useRef<{ caption: string; photographer: string; tags: string; identification: MediaIdentification[]; session: string }>({
    caption: "", photographer: "", tags: "", identification: [], session: "",
  });

  const form = useForm<FormData>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      caption: mediaItem.caption || "",
      photographer: mediaItem.photographer || "",
      tags: mediaItem.tags?.join(", ") || "",
    },
  });
  const watchedValues = form.watch();

  useEffect(() => {
    if (!open) return;
    assignedCaptionProtection.current = null;
    assignedIdentificationProtection.current = null;
    form.reset({ caption: mediaItem.caption || "", photographer: mediaItem.photographer || "", tags: mediaItem.tags?.join(", ") || "" });
    setIdentification(Array.isArray((mediaItem as any).identification) ? (mediaItem as any).identification : []);
    identificationEdited.current = false;
    tagsEdited.current = false;
    sessionEdited.current = false;
    captionEdited.current = false;
    setRecognitionSession(mediaItem.recognitionSession || "");
    editorBaseline.current = {
      caption: mediaItem.caption || "",
      photographer: mediaItem.photographer || "",
      tags: (mediaItem.tags || []).join(", "),
      identification: Array.isArray((mediaItem as any).identification) ? (mediaItem as any).identification : [],
      session: mediaItem.recognitionSession || "",
    };
    observedPending.current = false;
    savedTagSnapshot.current = (mediaItem.tags || []).map(tag => tag.trim()).filter(Boolean);
    setCaptionPreview(null);
    setSelectedScene(null);
  }, [open, mediaItem.id]);

  useEffect(() => {
    if (!open || captionEdited.current || (assignedCaptionProtection.current !== null &&
      (mediaItem.caption || "") !== assignedCaptionProtection.current)) return;
    form.resetField("caption", {defaultValue:mediaItem.caption || ""});
    editorBaseline.current.caption = mediaItem.caption || "";
  }, [open, mediaItem.caption, form]);

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
      queryClient.invalidateQueries({ queryKey: ["/api/creator/media"] });
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
  const analysis = useMediaAnalysis(mediaItem.id, open);
  useEffect(() => {
    if (!open) return;
    let current = true;
    void analysis.refetch().then(result => {
      if (!current || !result.data) return;
      if (!sessionEdited.current) setRecognitionSession(result.data.recognitionSession || "");
      if (Array.isArray(result.data.tags)) {
        savedTagSnapshot.current = result.data.tags.map(tag => tag.trim()).filter(Boolean);
        if (!tagsEdited.current) form.setValue("tags", savedTagSnapshot.current.join(", "), { shouldDirty: false });
      }
      const matchesAssignedIdentification = assignedIdentificationProtection.current === null ||
        JSON.stringify(result.data.identification) === JSON.stringify(assignedIdentificationProtection.current);
      if (!identificationEdited.current && Array.isArray(result.data.identification) && matchesAssignedIdentification) {
        setIdentification(result.data.identification);
        editorBaseline.current.identification = result.data.identification;
        syncedIdentificationGeneration.current = `${mediaItem.id}:${result.data.generation ?? "legacy"}:${result.data.status}`;
      }
      if (!sessionEdited.current) editorBaseline.current.session = result.data.recognitionSession || "";
      if (!tagsEdited.current && Array.isArray(result.data.tags)) editorBaseline.current.tags = result.data.tags.join(", ");
    });
    return () => { current = false; };
  }, [open, mediaItem.id, mediaItem.type]);
  useEffect(() => {
    if (!open) return;
    const matchesAssignedIdentification = assignedIdentificationProtection.current === null ||
      JSON.stringify(analysis.data?.identification) === JSON.stringify(assignedIdentificationProtection.current);
    if (!captionEdited.current && analysis.data?.caption !== undefined &&
      (assignedCaptionProtection.current === null || analysis.data.caption === assignedCaptionProtection.current)) {
      form.resetField("caption", {defaultValue:analysis.data.caption || ""});
      editorBaseline.current.caption = analysis.data.caption || "";
    }
    setIsAnalyzing(analysisPending(analysis.data?.status));
    if (analysisPending(analysis.data?.status) && !observedPending.current) {
      tagsAtAnalysisStart.current = parseEditableTags(form.getValues("tags"));
      observedPending.current = true;
    }
    const identificationGeneration = `${mediaItem.id}:${analysis.data?.generation ?? "legacy"}:${analysis.data?.status}`;
    if (!identificationEdited.current && analysis.data?.identification && matchesAssignedIdentification &&
      syncedIdentificationGeneration.current !== identificationGeneration) {
      setIdentification(analysis.data.identification);
      editorBaseline.current.identification = analysis.data.identification;
      syncedIdentificationGeneration.current = identificationGeneration;
    }
    if (analysis.data?.status !== "completed") return;
    const generationKey = `${mediaItem.id}:${analysis.data.generation ?? "legacy"}`;
    if (!observedPending.current || appliedGeneration.current === generationKey) return;
    observedPending.current = false;
    appliedGeneration.current = generationKey;
    setCategory(analysis.data.category || null);
    const latestSavedTags = (analysis.data.tags || []).map(tag => tag.trim()).filter(Boolean);
    form.setValue("tags", reconcileAnalysisTags(parseEditableTags(form.getValues("tags")),
      tagsAtAnalysisStart.current, latestSavedTags).join(", "), { shouldDirty: true });
    if (!tagsEdited.current) editorBaseline.current.tags = reconcileAnalysisTags(
      parseEditableTags(editorBaseline.current.tags), tagsAtAnalysisStart.current, latestSavedTags,
    ).join(", ");
    savedTagSnapshot.current = latestSavedTags;
    queryClient.invalidateQueries({ predicate: query =>
      String(query.queryKey[0]).startsWith(`/api/events/${mediaItem.eventId}/media`) ||
      (String(query.queryKey[0]).startsWith("/api/media") && !String(query.queryKey[0]).endsWith("/analysis")) });
  }, [open, analysis.data?.status, analysis.data?.generation, analysis.data?.tags, analysis.data?.identification, analysis.data?.identificationManual, analysis.data?.caption, mediaItem.id]);

  const currentTags = parseEditableTags(watchedValues.tags || "").join(", ");
  const baselineTags = parseEditableTags(editorBaseline.current.tags).join(", ");
  const hasUnsavedEditorChanges = (watchedValues.caption || "") !== editorBaseline.current.caption ||
    (watchedValues.photographer || "") !== editorBaseline.current.photographer ||
    currentTags !== baselineTags ||
    JSON.stringify(identification) !== JSON.stringify(editorBaseline.current.identification) ||
    recognitionSession !== editorBaseline.current.session;
  const analysisMutation = useMutation({
    mutationFn: (mode: "start" | "retry" | "reanalyse") => requestAnalysis(
      mediaItem.id,
      mode === "retry" ? { retry: true } : mode === "reanalyse" ? { reanalyse: true } : {},
    ),
    onSuccess: (data) => {
      setIsAnalyzing(analysisPending(data.status));
      observedPending.current = true;
      queryClient.invalidateQueries({ queryKey: [`/api/media/${mediaItem.id}/analysis`] });
      toast({ title: data.status === "completed" ? "Tags added" : "Analysis queued",
        description: "You can close this dialog; your media is already saved." });
    },
    onError: () => {
      observedPending.current = false;
      toast({
        title: "Analysis unavailable",
        description: "Analysis could not be completed. Please try again.",
        variant: "destructive",
      });
      setIsAnalyzing(false);
    },
  });

  const handleAIAnalysis = async (mode: "start" | "retry" | "reanalyse") => {
    tagsAtAnalysisStart.current = parseEditableTags(form.getValues("tags"));
    observedPending.current = true;
    setIsAnalyzing(true);
    try {
      await analysisMutation.mutateAsync(mode);
    } catch {
      // The mutation displays the safe status message above.
    } finally {
      // The persisted job status now controls the activity indicator.
    }
  };

  const onSubmit = async (formData: FormData) => {
    try {
      const { tags: tagText, caption, ...editableMetadata } = formData;
      await updateMutation.mutateAsync({
        ...editableMetadata,
        ...(captionEdited.current ? {caption} : {}),
        ...(tagsEdited.current ? {
          tags: tagText
            ? tagText.split(",").map((tag: string) => tag.trim()).filter(Boolean)
            : [],
        } : {}),
        ...(identificationEdited.current ? { identification } : {}),
        ...(sessionEdited.current ? { recognitionSession: recognitionSession.trim() || null } : {}),
        // Include category if provided by AI
        ...(category && { category })
      });
    } catch (error) {
      console.error('Form submission error:', error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
       <DialogContent onCloseAutoFocus={onCloseAutoFocus} className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Media</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <div className="relative aspect-video bg-black/20 rounded-lg overflow-hidden">
              {mediaItem.type === "video" ? (
                open && <VideoPreview key={mediaItem.id} src={mediaItem.url}
                  poster={mediaItem.thumbnail} signedIn={!!user} />
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
              {...form.register("caption", {onChange:()=>{captionEdited.current=true;}})}
            />
            {mediaItem.type === "image" && <div className="flex flex-wrap gap-2">
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
            </div>}
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
                    onClick={() => {
                      captionEdited.current=true;
                      form.setValue("caption", captionPreview.suggestion, { shouldValidate: true, shouldDirty: true });
                    }}
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
              {analysis.data?.status !== "completed" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleAIAnalysis(analysis.data?.status === "failed" ? "retry" : "start")}
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
                    <span>{analysis.data?.status === "failed" ? "Retry analysis" :
                      mediaItem.type === "video" ? "Analyze video" : "Generate tags"}</span>
                  </>
                )}
              </Button>
              )}
              {analysis.data && <p role="status" className="w-full text-sm text-muted-foreground">
                {analysis.data.status === "completed" ? "Tags added" :
                  analysis.data.status === "failed" ? "Analysis failed" :
                  analysis.data.status === "queued" ? "Analysis queued" :
                    analysis.data.status === "running" ? (mediaItem.type === "video" ? "Analyzing video…" : "Adding tags…") : "Not analysed"}
                {analysis.data.status === "failed" ? " · You can retry the analysis." : ""}
              </p>}
            </div>
            
            <Input
              id="tags"
              placeholder="racing, action, pit-stop"
              {...form.register("tags", {
                onChange: () => { tagsEdited.current = true; },
              })}
            />
            
            {category && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground">Category: 
                  <Badge variant="secondary" className="ml-2">
                    {category}
                  </Badge>
                </p>
              </div>
            )}
            {analysis.data?.status === "completed" && (
              <Button type="button" variant="ghost" size="sm" className="px-0 text-muted-foreground"
                disabled={analysisMutation.isPending} onClick={() => handleAIAnalysis("reanalyse")}>
                {analysisMutation.isPending ? "Reanalysing…" : "Reanalyse"}
              </Button>
            )}
          </div>

          <section className="space-y-3 rounded-md border p-3" aria-label="Recognized entry details">
            <div className="space-y-1">
              <Label htmlFor="recognition-session">Reference session</Label>
              <Input id="recognition-session" maxLength={120} value={recognitionSession}
                placeholder="Optional, e.g. Race 1"
                onChange={event => { sessionEdited.current = true; setRecognitionSession(event.target.value); }} />
              <p className="text-xs text-muted-foreground">Save a changed session before reanalysing to use its reference lists.</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold">Entry identification</h3>
              <p className="text-xs text-muted-foreground">Drivers are the official entry lineup, not individually identified people.</p>
            </div>
            {identification.map((entry, index) => (
              <div key={index} className="space-y-2 rounded-md bg-muted/40 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    ["number", "Race number"], ["team", "Team"], ["drivers", "Listed drivers"],
                    ["vehicle", "Vehicle"], ["manufacturer", "Manufacturer"],
                    ["racingClass", "Racing class"], ["discipline", "Discipline"],
                  ] as const).map(([field, label]) => (
                    <div key={field} className="space-y-1">
                      <Label htmlFor={`identification-${index}-${field}`}>{label}</Label>
                      <Input id={`identification-${index}-${field}`} value={entry[field] || ""}
                        onChange={event => { identificationEdited.current = true; setIdentification(current => current.map((item, row) =>
                          row === index ? { ...item, [field]: event.target.value, source: "manual" } : item)); }} />
                    </div>
                  ))}
                </div>
                <Button type="button" size="sm" variant="ghost"
                  onClick={() => { identificationEdited.current = true; setIdentification(current => current.filter((_, row) => row !== index)); }}>Remove vehicle</Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => { identificationEdited.current = true; setIdentification(current => [
              ...current, { number: "", team: "", drivers: "", vehicle: "", manufacturer: "", racingClass: "", discipline: "", source: "manual" },
            ]); }} disabled={identification.length >= 12}>Add vehicle</Button>
          </section>

          <div className="border-t border-border pt-4">
            <AssignNumberAction
              mediaItem={mediaItem}
              disabled={hasUnsavedEditorChanges || updateMutation.isPending}
              disabledReason={hasUnsavedEditorChanges ? "Save changes first before assigning a number. Your current editor changes will be preserved." : undefined}
              onSaved={saved => {
                const savedIdentification = Array.isArray((saved as any).identification) ? (saved as any).identification : [];
                assignedCaptionProtection.current = saved.caption || "";
                assignedIdentificationProtection.current = savedIdentification;
                form.reset({
                  caption: saved.caption || "",
                  photographer: saved.photographer || "",
                  tags: saved.tags?.join(", ") || "",
                });
                setIdentification(savedIdentification);
                setRecognitionSession(saved.recognitionSession || "");
                identificationEdited.current = true;
                tagsEdited.current = false;
                sessionEdited.current = false;
                captionEdited.current = false;
                editorBaseline.current = {
                  caption: saved.caption || "",
                  photographer: saved.photographer || "",
                  tags: saved.tags?.join(", ") || "",
                  identification: savedIdentification,
                  session: saved.recognitionSession || "",
                };
                queryClient.setQueryData([`/api/media/${mediaItem.id}/analysis`], (old: any) =>
                  old ? { ...old, caption: saved.caption, captionSource: "manual",
                    identification: savedIdentification, identificationManual: true } : old);
                void queryClient.invalidateQueries({ queryKey: ["/api/creator/media"] });
                void queryClient.invalidateQueries({ queryKey: ["/api/media"] });
                void queryClient.invalidateQueries({ predicate: query => {
                  const key = String(query.queryKey[0]);
                  return key.startsWith(`/api/events/${mediaItem.eventId}/media`) ||
                    key.startsWith("/api/admin/media") || key.includes("/search") || key.startsWith("/api/search");
                } });
              }}
            />
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
