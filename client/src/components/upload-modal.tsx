import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Event, InsertEvent, insertEventSchema, Series } from "@shared/schema";
import { Loader2, Upload, Image as ImageIcon } from "lucide-react";
import { generateEventThumbnail } from "@/lib/ai-thumbnail";

interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number | null;
}

export default function UploadModal({
  open,
  onOpenChange,
  eventId,
}: UploadModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = eventId !== null;
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);

  // Fetch event data when editing
  const { data: eventData } = useQuery<Event>({
    queryKey: [`/api/events/${eventId}`],
    enabled: isEditing,
  });

  // Fetch available series
  const { data: seriesList } = useQuery<Series[]>({
    queryKey: ["/api/series"],
  });

  const form = useForm<InsertEvent>({
    resolver: zodResolver(insertEventSchema),
    defaultValues: {
      title: "",
      description: "",
      date: new Date().toISOString().split('T')[0],
      coverImage: "/attached_assets/%2389_3.png",
      customThumbnail: undefined,
      seriesId: undefined,
    },
  });

  // Pre-fill form with event data when editing
  useEffect(() => {
    if (eventData && isEditing) {
      form.reset({
        title: eventData.title,
        description: eventData.description || "",
        date: new Date(eventData.date).toISOString().split('T')[0],
        coverImage: eventData.coverImage,
        customThumbnail: eventData.customThumbnail || undefined,
        seriesId: eventData.seriesId,
      });

      if (eventData.customThumbnail) {
        setThumbnailPreview(eventData.customThumbnail);
      }
    }
  }, [eventData, isEditing, form]);

  const handleThumbnailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: "Error",
          description: `File size too large. Maximum size is 10MB.`,
          variant: "destructive",
        });
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        setThumbnailPreview(dataUrl);
        form.setValue("customThumbnail", dataUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: InsertEvent) => {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          ...data,
          date: new Date(data.date),
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create event");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      onOpenChange(false);
      form.reset();
      setThumbnailPreview(null);
      toast({
        title: "Success",
        description: "Event created successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create event",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (id: number) => {
      const formData = form.getValues();
      const res = await fetch(`/api/events/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          title: formData.title,
          description: formData.description,
          date: new Date(formData.date),
          coverImage: formData.coverImage,
          customThumbnail: formData.customThumbnail,
          seriesId: formData.seriesId,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update event");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      if (eventId) {
        queryClient.invalidateQueries({ queryKey: [`/api/events/${eventId}`] });
      }
      onOpenChange(false);
      toast({
        title: "Success",
        description: "Event updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update event",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: InsertEvent) => {
    try {
      if (isEditing && eventId) {
        await updateMutation.mutateAsync(eventId);
      } else {
        await createMutation.mutateAsync(data);
      }
    } catch (error) {
      console.error("Form submission error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save event",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (!open) {
      form.reset();
      setThumbnailPreview(null);
    }
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Event" : "Create New Event"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              {...form.register("title")}
            />
            {form.formState.errors.title && (
              <p className="text-sm text-red-500">{form.formState.errors.title.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              {...form.register("description")}
            />
            {form.formState.errors.description && (
              <p className="text-sm text-red-500">{form.formState.errors.description.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              {...form.register("date")}
            />
            {form.formState.errors.date && (
              <p className="text-sm text-red-500">{form.formState.errors.date.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="series">Race Series (Optional)</Label>
            <Select
              value={form.watch("seriesId")?.toString() || "none"}
              onValueChange={(value) => form.setValue("seriesId", value === "none" ? undefined : parseInt(value))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a race series" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Series</SelectItem>
                {seriesList?.map((series) => (
                  <SelectItem key={series.id} value={series.id.toString()}>
                    {series.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Event Thumbnail</Label>
            <Input
              type="file"
              ref={thumbnailInputRef}
              className="hidden"
              accept="image/*"
              onChange={handleThumbnailChange}
            />
            <div className="relative h-40 border rounded-lg overflow-hidden bg-black/20 group">
              {thumbnailPreview ? (
                <img
                  src={thumbnailPreview}
                  alt="Thumbnail preview"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  {isGeneratingAI ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <p className="text-sm">Generating AI thumbnail...</p>
                    </div>
                  ) : (
                    <ImageIcon className="h-8 w-8" />
                  )}
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  type="button"
                  variant="outline"
                  className="bg-transparent border-primary/20"
                  onClick={() => thumbnailInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Choose Thumbnail
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Optional: Upload a custom thumbnail. For future events, an AI-generated thumbnail will be created automatically.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending || updateMutation.isPending || isGeneratingAI}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending || isGeneratingAI}
              className="bg-primary text-black hover:bg-primary/90"
            >
              {createMutation.isPending || updateMutation.isPending || isGeneratingAI ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {isGeneratingAI ? "Generating..." : isEditing ? "Updating..." : "Creating..."}
                </>
              ) : isEditing ? (
                "Update Event"
              ) : (
                "Create Event"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}