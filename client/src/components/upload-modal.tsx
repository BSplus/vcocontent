import { useState, useEffect, useRef, useCallback } from "react";
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
import { useAuth } from "@/hooks/use-auth";
import { eventCreateRoute } from "@/lib/event-create-route";
import EntryListEditor, { type EventEntryRow } from "@/components/entry-list-editor";

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
  console.log("UploadModal rendered with props:", { open, eventId });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isEditing = eventId !== null;
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const [validationSummary, setValidationSummary] = useState<string[]>([]);
  const [imageSource, setImageSource] = useState<"local" | "nextcloud">("local");
  const [links, setLinks] = useState<{ link: string; password: string }[]>([{ link: "", password: "" }]);
  const [preview, setPreview] = useState<{ count: number; images: number; videos: number; skipped: number } | null>(null);
  const [importEventId, setImportEventId] = useState<number | null>(null);
  const [createdEventId, setCreatedEventId] = useState<number | null>(null);
  const [entryDraft, setEntryDraft] = useState<{ rows: EventEntryRow[] | null; blocked: boolean }>({ rows: null, blocked: false });
  const onEntryDraftChange = useCallback((draft: { rows: EventEntryRow[] | null; blocked: boolean }) => setEntryDraft(draft), []);
  const [importBusy, setImportBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  const { data: eventData } = useQuery<Event>({
    queryKey: [`/api/events/${eventId}`],
    enabled: isEditing,
  });

  const { data: seriesList } = useQuery<Series[]>({
    queryKey: ["/api/series"],
  });
  const { data: importProgress } = useQuery<{
    status: string; error?: string; total: number; imported: number; importedImages: number; importedVideos: number;
    failed: number; skipped: number; warnings: number;
    files: { name: string; type?: "image" | "video"; status: string; message?: string; aiWarning?: string }[];
  }>({
    queryKey: [`/api/admin/events/${importEventId}/nextcloud`],
    enabled: open && !!importEventId,
    refetchInterval: importEventId ? 2000 : false,
  });

  const sources = () => links.map(({ link, password }) => ({ link: link.trim(), password: password || undefined }));
  const nextcloudPost = async (url: string, body: unknown) => {
    const response = await fetch(url, { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Nextcloud-Anfrage fehlgeschlagen.");
    return result;
  };
  const checkLinks = async () => {
    setPreview(null);
    setPreviewBusy(true);
    try {
      const result = await nextcloudPost("/api/admin/nextcloud/preview", { sources: sources() });
      setPreview(result);
    } catch (error) {
      toast({ title: "Nextcloud-Zugriff fehlgeschlagen", description: (error as Error).message, variant: "destructive" });
    } finally {
      setPreviewBusy(false);
    }
  };

  // Using as any to bypass type checking for date field which is handled by z.coerce.date() in the schema
  const form = useForm<InsertEvent>({
    resolver: zodResolver(insertEventSchema),
    defaultValues: {
      title: "",
      description: "",
      date: new Date().toISOString().split('T')[0] as any,
      coverImage: "/attached_assets/%2389_3.png",
      customThumbnail: undefined,
      seriesId: undefined,
      round: "",
      track: "",
    } as any,
  });

  useEffect(() => {
    if (eventData && isEditing) {
      const eventWithRaceDetails = eventData as Event & { round?: string | number | null; track?: string | null };
      form.reset({
        title: eventData.title,
        description: eventData.description || "",
        date: new Date(eventData.date).toISOString().split('T')[0] as any,
        coverImage: eventData.coverImage || "",
        customThumbnail: eventData.customThumbnail || undefined,
        seriesId: eventData.seriesId || undefined,
        round: eventWithRaceDetails.round ?? "",
        track: eventWithRaceDetails.track ?? "",
      } as any);

      if (eventData.customThumbnail) {
        setThumbnailPreview(eventData.customThumbnail);
      }
    }
  }, [eventData, isEditing, form]);

  useEffect(() => {
    if (open && eventId) setImportEventId(eventId);
  }, [open, eventId]);

  const handleThumbnailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const MAX_FILE_SIZE = 1024 * 1024; // Event thumbnails are small metadata; media uses multipart.
      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: "Error",
          description: `Event thumbnail too large. Maximum size is 1 MiB.`,
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
      const { endpoint, creatorId } = eventCreateRoute(user, imageSource);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          ...data,
          date: new Date(data.date),
          isPremium: false,
          creatorId,
          ...(entryDraft.rows ? { entryRows: entryDraft.rows } : {}),
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || error.message || "Failed to create event");
      }

      return res.json();
    },
    onSuccess: (event: Event) => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/creator/events"] });
      setCreatedEventId(event.id);
      toast({
        title: "Success",
        description: "Event created" + (entryDraft.rows ? " with its entry list." : ". You can add an entry list before closing."),
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
          customThumbnail: thumbnailPreview,
          seriesId: formData.seriesId,
          round: formData.round,
          track: formData.track,
          isPremium: false,
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
      setValidationSummary([]);
      if (!isEditing && !createdEventId && entryDraft.blocked) {
        setValidationSummary(["Review and confirm the entry list, or discard it before creating the event."]);
        return;
      }
      if (imageSource === "nextcloud") {
        setImportBusy(true);
        // Recheck the current inputs before creating an album, even if the preview
        // was for an older link or the share has since become unavailable.
        await nextcloudPost("/api/admin/nextcloud/preview", { sources: sources() });
        const id = importEventId || createdEventId || (isEditing ? eventId : null);
        const event = id ? null : await createMutation.mutateAsync(data);
        const targetId = id ?? event!.id;
        setImportEventId(targetId);
        await nextcloudPost(`/api/admin/events/${targetId}/nextcloud`, { sources: sources() });
        queryClient.invalidateQueries({ queryKey: [`/api/admin/events/${targetId}/nextcloud`] });
        toast({ title: "Nextcloud-Import gestartet", description: "Das Album bleibt erhalten. Fortschritt und Fehler sind hier sichtbar." });
        return;
      }
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
    } finally {
      setImportBusy(false);
    }
  };

  const onInvalid = (errors: typeof form.formState.errors) => {
    const messages = Object.values(errors)
      .map((error) => error?.message)
      .filter((message): message is string => typeof message === "string");
    setValidationSummary(messages.length ? messages : ["Please correct the highlighted fields."]);
  };

  useEffect(() => {
    if (!open) {
      form.reset();
      setThumbnailPreview(null);
      setImportEventId(null);
      setCreatedEventId(null);
      setEntryDraft({ rows: null, blocked: false });
      setPreview(null);
      setLinks([{ link: "", password: "" }]);
      setImageSource("local");
    }
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
       <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Event" : "Create New Event"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-4">
          {validationSummary.length > 0 && (
            <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium">Please check the event details:</p>
              <ul className="mt-1 list-disc pl-5">
                {validationSummary.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}
              </ul>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              {...form.register("title")}
              className="touch-auto"
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
              className="min-h-[100px] touch-auto"
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
              className="touch-auto"
            />
            {form.formState.errors.date && (
              <p className="text-sm text-red-500">{form.formState.errors.date.message}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="round">Round</Label>
              <Input id="round" {...form.register("round" as any)} className="touch-auto" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="track">Track</Label>
              <Input id="track" {...form.register("track" as any)} className="touch-auto" />
            </div>
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

          <EntryListEditor eventId={eventId ?? createdEventId} onDraftChange={onEntryDraftChange} />
          
          <div className="space-y-2">
            <Label>Event Thumbnail</Label>
            <Input
              type="file"
              ref={thumbnailInputRef}
              className="hidden"
              accept="image/*"
              onChange={handleThumbnailChange}
            />
             <div className="relative h-40 border rounded-lg overflow-hidden bg-black/20">
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
             <Button type="button" variant="outline" onClick={() => thumbnailInputRef.current?.click()}>
               <Upload className="h-4 w-4 mr-2" /> Choose Thumbnail
             </Button>
          </div>

          {user?.isAdmin && (
            <div className="space-y-3 rounded-md border p-4">
               <Label htmlFor="image-source">Medienquelle für das Album</Label>
              <Select value={imageSource} onValueChange={value => { setImageSource(value as "local" | "nextcloud"); setPreview(null); }}>
                <SelectTrigger id="image-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Lokaler Upload nach dem Anlegen</SelectItem>
                  <SelectItem value="nextcloud">Nextcloud-Ordner importieren</SelectItem>
                </SelectContent>
              </Select>
              {imageSource === "nextcloud" && <>
                 <p className="text-sm text-muted-foreground">Öffentliche Ordnerlinks von nextcloud.bs-plus.de funktionieren ohne Nextcloud-Konto. Ein Freigabepasswort kann unten eingegeben werden. Für interne Links muss der Betreiber die Instanz und den Nextcloud-Zugang einrichten. Alle Links und Unterordner werden in dieses eine Album importiert.</p>
                {links.map((entry, i) => (
                  <div className="space-y-2 border-b pb-3" key={i}>
                    <Label htmlFor={`nc-link-${i}`}>Ordnerlink {i + 1}</Label>
                     <Input id={`nc-link-${i}`} type="url" value={entry.link} placeholder="https://nextcloud.bs-plus.de/s/..."
                      onChange={e => { const next = [...links]; next[i] = { ...entry, link: e.target.value }; setLinks(next); setPreview(null); }} />
                    <Input aria-label={`Freigabepasswort für Link ${i + 1}`} type="password" autoComplete="off"
                      placeholder="Freigabepasswort (falls erforderlich)" value={entry.password}
                      onChange={e => { const next = [...links]; next[i] = { ...entry, password: e.target.value }; setLinks(next); setPreview(null); }} />
                    {links.length > 1 && <Button type="button" variant="ghost" onClick={() => { setLinks(links.filter((_, index) => index !== i)); setPreview(null); }}>Link entfernen</Button>}
                  </div>
                ))}
                 <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" disabled={links.length >= 10} onClick={() => setLinks([...links, { link: "", password: "" }])}>Weiterer Link</Button>
                    <Button type="button" variant="outline" disabled={previewBusy || importBusy} onClick={checkLinks}>{previewBusy ? "Prüfe Zugriff..." : "Zugriff und Medien prüfen"}</Button>
                </div>
                 {preview && <p role="status">{preview.images} Bilder und {preview.videos} Videos gefunden; {preview.skipped} Dateien übersprungen.</p>}
                {importProgress && <div role="status" className="text-sm space-y-1">
                   <p>Import: {importProgress.status} · {importProgress.imported}/{importProgress.total} Medien ({importProgress.importedImages} Bilder, {importProgress.importedVideos} Videos) · {importProgress.skipped} übersprungen · {importProgress.failed} Fehler · {importProgress.warnings} Bild-KI-Warnungen</p>
                  {importProgress.error && <p className="text-amber-600">{importProgress.error}</p>}
                  <div className="max-h-28 overflow-y-auto">
                    {importProgress.files.filter(file => file.message || file.aiWarning).map((file, index) =>
                      <p key={index}>{file.name}: {file.message || file.aiWarning}</p>)}
                  </div>
                   <p>Bei Unterbrechung dieselben Links erneut eingeben und den Import erneut starten. Bereits importierte Medien werden nicht verdoppelt.</p>
                </div>}
              </>}
            </div>
          )}

           <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending || updateMutation.isPending || importBusy}
            >
              Cancel
            </Button>
             <Button
              type={createdEventId && !isEditing && imageSource !== "nextcloud" ? "button" : "submit"}
              onClick={createdEventId && !isEditing && imageSource !== "nextcloud" ? () => onOpenChange(false) : undefined}
               disabled={createMutation.isPending || updateMutation.isPending || importBusy || previewBusy || (!isEditing && !createdEventId && entryDraft.blocked) || (imageSource === "nextcloud" && !preview && !createdEventId)}
              className="bg-primary text-black hover:bg-primary/90"
            >
               {createdEventId && !isEditing && imageSource !== "nextcloud" && !importBusy ? "Fertig" : createMutation.isPending || updateMutation.isPending || importBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {isEditing ? "Updating..." : "Creating..."}
                </>
              ) : imageSource === "nextcloud" ? (
                importEventId || isEditing ? "Import starten / fortsetzen" : "Album anlegen und importieren"
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
