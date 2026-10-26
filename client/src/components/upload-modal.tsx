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
import EntryListEditor, { type EventEntryRow, type PendingEventReference } from "@/components/entry-list-editor";
import LegalLinks from "@/components/legal-links";
import { creatorAssociationsKey, invalidateCommunityGalleryQueries } from "@/components/creator-gallery-association";
import GalleryThumbnailSelector from "@/components/gallery-thumbnail-selector";
import { eventImagePolicy } from "@shared/event-image-policy";
import { EventSaveError, saveEvent } from "@/lib/event-save";
import { EventCreateError, createEventRequest } from "@/lib/event-create";
import { pluralize } from "@/lib/utils";

interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number | null;
}
type SourceEntry = { id?: string; link: string; password: string; hasPassword?: boolean; removePassword?: boolean; photographer?: string };

export default function UploadModal({
  ...props
}: UploadModalProps) {
  // Event-bound drafts must not survive a switch to another event or creation.
  return <EventUploadModal key={props.eventId ?? "new"} {...props} />;
}

function EventUploadModal({
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
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
  const [thumbnailBusy, setThumbnailBusy] = useState(false);
  const [galleryThumbnailReference, setGalleryThumbnailReference] = useState<string | null>(null);
  const [validationSummary, setValidationSummary] = useState<string[]>([]);
  const [imageSource, setImageSource] = useState<"local" | "nextcloud">("local");
   const [links, setLinks] = useState<SourceEntry[]>([{ link: "", password: "" }]);
   const [savedLinks, setSavedLinks] = useState<SourceEntry[]>([]);
   const [sourcesBusy, setSourcesBusy] = useState(false);
   const [sourcesLoaded, setSourcesLoaded] = useState(false);
   const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ count: number; images: number; videos: number; skipped: number } | null>(null);
  const [importEventId, setImportEventId] = useState<number | null>(null);
  const [createdEventId, setCreatedEventId] = useState<number | null>(null);
  const [entryDraft, setEntryDraft] = useState<{ rows: EventEntryRow[] | null; blocked: boolean }>({ rows: null, blocked: false });
  const onEntryDraftChange = useCallback((draft: { rows: EventEntryRow[] | null; blocked: boolean }) => setEntryDraft(draft), []);
  const [pendingEventReference, setPendingEventReference] = useState<PendingEventReference | null>(null);
  const pendingEventReferenceRef = useRef<PendingEventReference | null>(null);
  const [referenceImportRecovery, setReferenceImportRecovery] = useState<{ eventId: number; status: "uploading" | "failed"; error?: string } | null>(null);
  const [referenceRefreshToken, setReferenceRefreshToken] = useState(0);
  const onReferenceSelection = useCallback((reference: PendingEventReference) => {
    pendingEventReferenceRef.current = reference;
    setPendingEventReference(reference);
  }, []);
  const [importBusy, setImportBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const baseline = useRef<Event | null>(null);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [creationStage, setCreationStage] = useState<string | null>(null);
  const [importStarted, setImportStarted] = useState(false);
  const problemRef = useRef<HTMLDivElement>(null);
  const [unknownSave, setUnknownSave] = useState(false);
  const [checkingSave, setCheckingSave] = useState(false);
  const [saveCheck, setSaveCheck] = useState<string | null>(null);
  const attemptedChanges = useRef<Record<string, unknown>>({});

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
    analysisPending: number; analysisCompleted: number;
    budgets?: { imageBytes: number; videoBytes: number; transferBytes: number; eventStoredBytes: number };
    run?: { found: number; existing: number; imported: number; skipped: number; failed: number } | null;
    files: { name: string; type?: "image" | "video"; status: string; message?: string; aiWarning?: string;
      failure?: { stage: string; code: string };
      mediaId?: number; analysisStatus?: string; analysisError?: string }[];
  }>({
    queryKey: [`/api/admin/events/${importEventId}/nextcloud`],
     enabled: open && !!importEventId && !!user?.isAdmin && !eventData?.creatorId,
     refetchInterval: query => !query.state.data || ["scanning", "queued", "running"].includes(query.state.data.status)
      || query.state.data.analysisPending > 0 ? 4000 : false,
  });

   const sources = () => links.filter(entry => entry.link.trim()).map(({ id, link, password, removePassword, photographer }) =>
     ({ id, link: link.trim(), password: password || undefined, removePassword, photographer: photographer || "" }));
   const sourcesDirty = JSON.stringify(links) !== JSON.stringify(savedLinks.length ? savedLinks : [{ link: "", password: "" }]);
   const activeImport = !!importProgress && ["scanning", "queued", "running"].includes(importProgress.status);
  const nextcloudPost = async (url: string, body: unknown) => {
    const response = await fetch(url, { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
     const result = await response.json().catch(() => null);
     if (!response.ok) throw new Error(result?.error || (response.status === 401
       ? "Your session has expired. Sign in again."
       : "Nextcloud could not confirm this request. Check access and import progress before retrying."));
     if (!result || typeof result !== "object")
       throw new Error("Nextcloud returned an unexpected response. Check import progress before retrying.");
    return result;
  };
  const checkLinks = async () => {
    setPreview(null);
    setPreviewBusy(true);
    try {
       const result = await nextcloudPost(importEventId ? `/api/admin/events/${importEventId}/nextcloud/preview` : "/api/admin/nextcloud/preview", { sources: sources() });
      setPreview(result);
    } catch (error) {
      toast({ title: "Nextcloud access failed", description: (error as Error).message, variant: "destructive" });
    } finally {
      setPreviewBusy(false);
    }
  };
  const applySavedSources = (data: { sources: Omit<SourceEntry, "password">[] }) => {
    const entries = data.sources.map(source => ({ ...source, photographer: source.photographer || "", password: "" }));
    setSavedLinks(entries);
    setLinks(entries.length ? entries : [{ link: "", password: "" }]);
    setSourcesLoaded(true);
    setSourcesError(null);
  };
  useEffect(() => {
    if (!open || !eventId || !user?.isAdmin || !eventData || eventData.creatorId) return;
    const controller = new AbortController();
    setSourcesLoaded(false);
    setSourcesError(null);
    void fetch(`/api/admin/events/${eventId}/nextcloud/sources`, { credentials: "include", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Saved sources could not be loaded. Reopen the dialog to try again.");
        const data = await response.json();
        if (!controller.signal.aborted) {
          applySavedSources(data);
          if (data.sources.length) setImageSource("nextcloud");
        }
      }).catch(error => { if (!controller.signal.aborted) setSourcesError(error.message); });
    return () => controller.abort();
  }, [open, eventId, user?.isAdmin, eventData?.id, eventData?.creatorId]);
  const saveSourceLinks = async () => {
    if (!importEventId) return;
    setSourcesBusy(true);
    try {
      applySavedSources(await nextcloudPost(`/api/admin/events/${importEventId}/nextcloud/sources`, { sources: sources() }));
      toast({ title: "Sources saved", description: "No import was started." });
    } catch (error) {
      toast({ title: "Sources could not be saved", description: (error as Error).message, variant: "destructive" });
    } finally { setSourcesBusy(false); }
  };
  const updateGallery = async () => {
    if (!importEventId) return;
    setImportBusy(true);
    try {
      await nextcloudPost(`/api/admin/events/${importEventId}/nextcloud/update`, {});
      toast({ title: "Gallery update started", description: "Saved sources are scanned for new media." });
    } catch (error) {
      toast({ title: "Gallery update failed", description: (error as Error).message, variant: "destructive" });
    } finally {
      await queryClient.invalidateQueries({ queryKey: [`/api/admin/events/${importEventId}/nextcloud`] });
      await queryClient.invalidateQueries({ queryKey: [`/api/events/${importEventId}/media`] });
      setImportBusy(false);
    }
  };

  const importCreatedEventReference = async (targetEventId: number, reference: PendingEventReference) => {
    setReferenceImportRecovery({ eventId: targetEventId, status: "uploading" });
    const body = new FormData();
    body.append("file", reference.file);
    body.append("kind", reference.kind);
    body.append("scope", reference.scope);
    body.append("seasonYear", String(reference.seasonYear));
    body.append("session", reference.session);
    if(reference.rows) body.append("rows",JSON.stringify(reference.rows));
    try {
      const response = await fetch(`/api/events/${targetEventId}/references`, {
        method: "POST", credentials: "include", body,
      });
      if (!response.ok) {
        let message = "The event was created, but its reference file was not imported.";
        try {
          const payload = await response.json();
          message = payload.error || payload.message || message;
        } catch {
          // Keep the recoverable fallback for non-JSON errors.
        }
        throw new Error(message);
      }
      pendingEventReferenceRef.current = null;
      setPendingEventReference(null);
      setReferenceImportRecovery(null);
      setReferenceRefreshToken(token => token + 1);
      toast({ title: "Reference imported", description: "The event was created and its source document is saved." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The event was created, but its reference file was not imported.";
      setReferenceImportRecovery({ eventId: targetEventId, status: "failed", error: message });
      toast({ title: "Reference import needs a retry", description: message, variant: "destructive" });
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
       platform: "",
        vehicle: "",
    } as any,
  });

  useEffect(() => {
    if (open && eventData?.id === eventId && isEditing && baseline.current?.id !== eventId) {
      baseline.current = eventData;
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
         platform: eventData.platform ?? "",
          vehicle: (eventData as Event & { vehicle?: string | null }).vehicle ?? "",
      } as any);

       setThumbnailPreview(eventData.customThumbnail ? `/api/events/${eventData.id}/thumbnail?field=customThumbnail` : null);
       setGalleryThumbnailReference(eventData.customThumbnail &&
         /^\/api\/media\/(?:files\/thumb-[0-9a-f-]{36}\.webp|legacy\/[1-9][0-9]*\/thumbnail)$/.test(eventData.customThumbnail)
         ? eventData.customThumbnail : null);
      setThumbnailError(null);
    }
  }, [open, eventData, isEditing, form]);

  useEffect(() => {
    if (open && eventId) setImportEventId(eventId);
  }, [open, eventId]);

  const handleThumbnailChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      setThumbnailError(null);
      setThumbnailBusy(true);
      try {
        if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type))
          throw new Error("Choose a JPEG, PNG, WebP or GIF image.");
        if (file.size > eventImagePolicy.bytes) throw new Error("Event thumbnail too large. Maximum size is 1 MiB.");
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Image could not be read. Please try again."));
          reader.readAsDataURL(file);
        });
        const image = new Image();
        image.src = dataUrl;
        try { await image.decode(); }
        catch { throw new Error("Image is damaged or cannot be decoded. Choose another image."); }
        if (image.naturalWidth * image.naturalHeight > eventImagePolicy.pixels)
          throw new Error("Event thumbnail must not exceed 40 megapixels.");
        setThumbnailPreview(dataUrl);
        setGalleryThumbnailReference(null);
        form.setValue("customThumbnail", dataUrl, { shouldDirty: true });
      } catch (error) {
        setThumbnailError((error as Error).message);
      } finally { setThumbnailBusy(false); }
    }
  };

  const createMutation = useMutation({
    retry: false, // Validation failures are final; creation must not be replayed automatically.
    mutationFn: async (data: InsertEvent) => {
      const { endpoint, creatorId } = eventCreateRoute(user, imageSource);
      return createEventRequest<Event>(endpoint, {
          ...data,
          ...(creatorId ? { coverImage: undefined, customThumbnail: undefined } : {}),
          date: new Date(data.date),
          isPremium: false,
          visibility: "draft",
          creatorId,
          ...(entryDraft.rows ? { entryRows: entryDraft.rows } : {}),
        });
    },
    onSuccess: async (event: Event) => {
      queryClient.setQueryData([`/api/events/${event.id}`], event);
      queryClient.invalidateQueries({ queryKey: ["/api/creator/usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/creator/events"] });
      queryClient.invalidateQueries({ queryKey: creatorAssociationsKey });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      setCreatedEventId(event.id);
      const reference = pendingEventReferenceRef.current;
      if (reference) await importCreatedEventReference(event.id, reference);
      if (imageSource !== "nextcloud") {
        setCreationStage("Event saved. Review its entry list if needed, then choose Done.");
        toast({ title: "Event created", description: "The event is saved. You can manage it from your event list." });
      }
    },
    onError: (error: Error) => {
      const unknown = error instanceof EventCreateError && error.status === "unknown";
      setUnknownSave(unknown);
      setSaveProblem(unknown
        ? `${error.message} Your inputs are preserved. Close this form and check your event list before creating again to avoid duplicates.`
        : `Event not created. ${error.message} Your inputs are preserved.`);
    },
  });

  const updateMutation = useMutation({
    retry: false,
    mutationFn: async (id: number) => {
      if (unknownSave) throw new EventSaveError("unknown", "Check the saved event before submitting again.");
      const previous = baseline.current;
      if (!previous) throw new EventSaveError("rejected", "Wait until the event details have loaded.");
      const formData = form.getValues();
      const imageFields: Record<string, unknown> = {};
      if ((formData.customThumbnail || null) !== (previous.customThumbnail || null)) {
        imageFields.customThumbnail = formData.customThumbnail || null;
      }
      if ((formData.coverImage || null) !== (previous.coverImage || null)) {
        imageFields.coverImage = formData.coverImage || null;
      }
      const details: Record<string, unknown> = {};
      for (const field of ["title", "description", "round", "track", "seriesId"] as const) {
        if ((formData[field] || null) !== (previous[field] || null)) details[field] = formData[field] ?? null;
      }
      const platform = formData.platform?.trim() || null;
      if (platform !== (previous.platform?.trim() || null)) details.platform = platform;
       const vehicle = String((formData as typeof formData & { vehicle?: string | null }).vehicle ?? "").trim() || null;
       const previousVehicle = String((previous as Event & { vehicle?: string | null }).vehicle ?? "").trim() || null;
       if (vehicle !== previousVehicle) details.vehicle = vehicle;
      if (new Date(formData.date).toISOString().slice(0, 10) !== new Date(previous.date).toISOString().slice(0, 10))
        details.date = new Date(formData.date);
      setSaveProblem(null);
      setSaveCheck(null);
      attemptedChanges.current = { ...details, ...imageFields };
      return saveEvent(id, attemptedChanges.current);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/creator/events"] });
      void invalidateCommunityGalleryQueries(queryClient);
      queryClient.invalidateQueries({ predicate: query => typeof query.queryKey[0] === "string" &&
        /^\/api\/events\/creator\/\d+$/.test(query.queryKey[0]) });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      if (eventId) {
         if ("title" in result && "date" in result) {
           queryClient.setQueryData([`/api/events/${eventId}`], result);
         }
        queryClient.invalidateQueries({ queryKey: [`/api/events/${eventId}`] });
         queryClient.invalidateQueries({ queryKey: [`/api/events/${eventId}/photo-matching`] });
      }
      onOpenChange(false);
      toast({
        title: result.saveStatus === "unchanged" ? "No changes" : "Event saved",
        description: result.saveStatus === "unchanged" ? "The event details are unchanged." :
          result.safetyCheckStatus === "unavailable" ? "Changes were saved. The current safety check status could not be loaded; check it before publishing." : "Event updated successfully",
      });
    },
    onError: (error: Error) => {
      const unknown = error instanceof EventSaveError && error.status === "unknown";
      setUnknownSave(unknown);
      setSaveProblem(unknown ? `Save status unknown. ${error.message} Your inputs are preserved. Check the saved event before submitting again.` : `Changes rejected. ${error.message}`);
    },
  });

  const checkSavedEvent = async () => {
    if (!eventId) return;
    setCheckingSave(true);
    try {
      const response = await fetch(`/api/events/${eventId}`, { credentials: "include",
        signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("read failed");
      const current: Event = await response.json();
      if (current?.id !== eventId || typeof current.title !== "string" || !Number.isFinite(+new Date(current.date)))
        throw new Error("invalid read");
      const different = Object.entries(attemptedChanges.current).filter(([field, value]) =>
        field === "date" ? +new Date(value as string) !== +new Date(current.date) :
          (value || null) !== ((current as unknown as Record<string, unknown>)[field] || null)).map(([field]) => field);
      baseline.current = current;
      setUnknownSave(false);
      setSaveProblem(null);
      setSaveCheck(different.length ? `Saved values differ for: ${different.join(", ")}. Your inputs are unchanged; review them before saving again.` :
        "The saved event matches your submitted changes. Your inputs are unchanged.");
    } catch {
      setSaveProblem("Save status unknown. The saved event could not be loaded. Your inputs are preserved; try checking again.");
    } finally { setCheckingSave(false); }
  };

  const onSubmit = async (data: InsertEvent) => {
    if (thumbnailBusy || unknownSave) return;
    const vehicle = String(form.getValues("vehicle" as any) ?? "").trim();
    if (vehicle.length > 160) {
      const message = "Vehicle or make cannot exceed 160 characters.";
      form.setError("vehicle" as any, { type: "maxLength", message });
      setValidationSummary([message]);
      return;
    }
    form.clearErrors("vehicle" as any);
    const normalizedData = { ...data, vehicle: vehicle || null } as InsertEvent;
    if (creationBlocked.length) {
      setValidationSummary(creationBlocked);
      return;
    }
    let savedId = importEventId || createdEventId;
    try {
      setSaveProblem(null);
      setCreationStage(null);
      setImportStarted(false);
      setValidationSummary([]);
      if (!isEditing && !createdEventId && entryDraft.blocked) {
        setValidationSummary(["Review and confirm the entry list, or discard it before creating the event."]);
        return;
      }
       if (imageSource === "nextcloud" && !isEditing) {
        setImportBusy(true);
        setCreationStage("Checking Nextcloud access…");
        // Recheck the current inputs before creating an album, even if the preview
        // was for an older link or the share has since become unavailable.
         await nextcloudPost(importEventId ? `/api/admin/events/${importEventId}/nextcloud/preview` : "/api/admin/nextcloud/preview", { sources: sources() });
         setCreationStage(savedId ? "Preparing the saved event…" : "Creating event…");
        const id = importEventId || createdEventId || (isEditing ? eventId : null);
         const event = id ? null : await createMutation.mutateAsync(normalizedData);
        const targetId = id ?? event!.id;
         savedId = targetId;
        setImportEventId(targetId);
         setCreationStage("Saving Nextcloud sources…");
         applySavedSources(await nextcloudPost(`/api/admin/events/${targetId}/nextcloud/sources`, { sources: sources() }));
         setCreationStage("Starting background import…");
         await nextcloudPost(`/api/admin/events/${targetId}/nextcloud/update`, {});
         setImportStarted(true);
        queryClient.invalidateQueries({ queryKey: [`/api/admin/events/${targetId}/nextcloud`] });
         setCreationStage("Event saved. Import is running in the background; you can safely close this window.");
         toast({ title: "Event created — import started", duration: 10000,
           description: "The import continues in the background. Reopen Edit Event from your event list to check progress or errors." });
         // Preserve a failed reference import and its retry controls.
         if (!pendingEventReferenceRef.current) onOpenChange(false);
        return;
      }
      if (isEditing && eventId) {
        await updateMutation.mutateAsync(eventId);
      } else {
         await createMutation.mutateAsync(normalizedData);
      }
    } catch (error) {
      // Edit errors are displayed once, inline, by the mutation handler.
      if (isEditing) return;
      setCreationStage(null);
      if (error instanceof EventCreateError) return; // Mutation handler displays one persistent error.
      const message = error instanceof Error ? error.message : "Please try again later.";
      setSaveProblem(savedId
        ? `The event is saved, but Nextcloud setup or import start needs attention. ${message} Check import progress before retrying. This form will reuse the saved event, not create another one.`
        : `Event not created. ${message} Your inputs are preserved.`);
    } finally {
      setImportBusy(false);
    }
  };

  const creationBlocked = !isEditing && !createdEventId ? [
    !user ? "Sign in before creating an event." : null,
    user?.suspended ? "This account is suspended. Contact an administrator." : null,
    user && !user.isAdmin && (user.creatorStatus === "rejected" || (!user.isCreator && user.creatorStatus !== "approved")) ? "Creator approval is required before you can create a gallery." : null,
    entryDraft.blocked ? "Review and confirm the entry list, or discard it before creating the event." : null,
    imageSource === "nextcloud" && !preview ? "Use Check access and media before creating the event. Recheck after changing a source." : null,
  ].filter((reason): reason is string => !!reason) : [];

  useEffect(() => {
    if (saveProblem || validationSummary.length) problemRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [saveProblem, validationSummary]);

  const onInvalid = (errors: typeof form.formState.errors) => {
    const messages = Object.entries(errors)
      .map(([field, error]) => field === "date" ? "Choose a valid event date." : error?.message)
      .filter((message): message is string => typeof message === "string");
    setValidationSummary(messages.length ? messages : ["Please correct the highlighted fields."]);
  };

  useEffect(() => {
    if (!open) {
      baseline.current = null;
      setSaveProblem(null);
      setCreationStage(null);
      setValidationSummary([]);
      setImportStarted(false);
      setUnknownSave(false);
      setSaveCheck(null);
      form.reset();
      setThumbnailPreview(null);
      setGalleryThumbnailReference(null);
      setThumbnailError(null);
      setImportEventId(null);
      setCreatedEventId(null);
      setEntryDraft({ rows: null, blocked: false });
      setPreview(null);
      setLinks([{ link: "", password: "" }]);
       setSavedLinks([]);
       setSourcesLoaded(false);
       setSourcesError(null);
      setImageSource("local");
      if (!referenceImportRecovery) {
        pendingEventReferenceRef.current = null;
        setPendingEventReference(null);
      }
    }
  }, [open, form, referenceImportRecovery]);

  return (
    <Dialog open={open} onOpenChange={nextOpen=>{
       if(!nextOpen && (thumbnailBusy || sourcesBusy || importBusy || createMutation.isPending || updateMutation.isPending || checkingSave || referenceImportRecovery?.status==="uploading")) return;
      onOpenChange(nextOpen);
    }}>
       <DialogContent className="block max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader className="mb-4">
          <DialogTitle>
            {isEditing ? "Edit Event" : createdEventId ? "Event created" : "Create New Event"}
          </DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-4">
          {creationStage && <div role="status" aria-live="polite" className="rounded-md border border-primary/50 bg-primary/10 p-3 text-sm">
            {creationStage}
          </div>}
          {saveProblem && <div ref={problemRef} role="alert" className="rounded-md border border-destructive/50 p-3 text-sm">
            <p>{saveProblem}</p>
            {unknownSave && isEditing && <Button type="button" variant="outline" onClick={checkSavedEvent} disabled={checkingSave}>
              {checkingSave ? "Checking..." : "Check saved event"}
            </Button>}
          </div>}
          {saveCheck && <p role="status" className="text-sm">{saveCheck}</p>}
          {validationSummary.length > 0 && (
            <div ref={problemRef} role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
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

          <div className="space-y-2">
            <Label htmlFor="platform">Sim-racing platform (optional)</Label>
            <Input id="platform" {...form.register("platform")} placeholder="e.g. iRacing"
              aria-label="Sim-racing platform (optional)" className="touch-auto"
              aria-invalid={!!form.formState.errors.platform}
              aria-describedby={form.formState.errors.platform ? "platform-error" : undefined} />
            {form.formState.errors.platform && (
              <p id="platform-error" role="alert" className="text-sm text-destructive">{form.formState.errors.platform.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="vehicle">Single vehicle or make (optional)</Label>
            <Input
              id="vehicle"
              maxLength={160}
              {...form.register("vehicle" as any)}
              placeholder="e.g. Porsche 911 GT3 R"
              className="touch-auto"
              aria-invalid={!!(form.formState.errors as any).vehicle}
              aria-describedby={(form.formState.errors as any).vehicle ? "vehicle-error vehicle-help" : "vehicle-help"}
            />
            <p id="vehicle-help" className="text-sm text-muted-foreground">
              Leave empty for mixed-vehicle events. This is event-wide caption context, not evidence of a vehicle’s identity.
            </p>
            {(form.formState.errors as any).vehicle && (
              <p id="vehicle-error" role="alert" className="text-sm text-destructive">
                {(form.formState.errors as any).vehicle.message}
              </p>
            )}
          </div>

          <EntryListEditor
            eventId={eventId ?? createdEventId}
            seriesId={form.watch("seriesId") ?? null}
            seasonYear={form.watch("date") ? Number(String(form.watch("date")).slice(0, 4)) : new Date().getFullYear()}
            onDraftChange={onEntryDraftChange}
            onReferenceSelection={onReferenceSelection}
            refreshReferencesToken={referenceRefreshToken}
          />
          <div className="text-sm leading-relaxed">
            <p>Only provide reference documents you are entitled to use. Source files stay private to the owner and authorised administrators;
              image/scanned document extraction may use Replit-managed OpenAI, and derived driver/team details can appear in public media metadata.</p>
            <LegalLinks />
          </div>
          {referenceImportRecovery && (
            <div className={`rounded-md border p-3 text-sm ${referenceImportRecovery.status === "failed" ? "border-destructive/40 bg-destructive/5" : "border-border"}`}
              role={referenceImportRecovery.status === "failed" ? "alert" : "status"}>
              {referenceImportRecovery.status === "uploading" ? (
                <p>Event created. Importing the selected reference file…</p>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p>Event #{referenceImportRecovery.eventId} was created, but the reference file was not imported. {referenceImportRecovery.error}</p>
                  <Button type="button" size="sm" variant="outline" disabled={!pendingEventReference}
                    onClick={() => pendingEventReference && void importCreatedEventReference(referenceImportRecovery.eventId, pendingEventReference)}>
                    Retry source import
                  </Button>
                </div>
              )}
            </div>
          )}
          
          {open && isEditing && eventId && eventData && (
            <GalleryThumbnailSelector
              eventId={eventId}
              selectedReference={galleryThumbnailReference}
              selectedPreview={galleryThumbnailReference && eventData.customThumbnail
                ? `/api/events/${eventId}/thumbnail?field=customThumbnail` : undefined}
              onSelect={(reference, previewImage) => {
                setGalleryThumbnailReference(reference);
                setThumbnailPreview(previewImage);
                setThumbnailError(null);
                form.setValue("customThumbnail", reference, { shouldDirty: true });
              }}
            />
          )}

          {user?.isAdmin && (!isEditing || eventData && !eventData.creatorId) && <div className="space-y-2">
            <Label>Event Thumbnail</Label>
            <Input
              type="file"
              ref={thumbnailInputRef}
              className="hidden"
              accept={eventImagePolicy.accept}
              aria-label="Choose event thumbnail"
              disabled={thumbnailBusy}
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
             <p className="text-sm text-muted-foreground">{eventImagePolicy.help}</p>
             {thumbnailError && <p role="alert" className="text-sm text-destructive">{thumbnailError}</p>}
             <Button type="button" variant="outline" disabled={thumbnailBusy} onClick={() => thumbnailInputRef.current?.click()}>
               <Upload className="h-4 w-4 mr-2" /> Choose Thumbnail
             </Button>
          </div>}

          {user?.isAdmin && (!isEditing || eventData && !eventData.creatorId) && (
            <div className="space-y-3 rounded-md border p-4">
               <Label htmlFor="image-source">Gallery media source</Label>
              <Select value={imageSource} onValueChange={value => { setImageSource(value as "local" | "nextcloud"); setPreview(null); }}>
                <SelectTrigger id="image-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Upload files after creating the event</SelectItem>
                  <SelectItem value="nextcloud">Import a Nextcloud folder</SelectItem>
                </SelectContent>
              </Select>
              {imageSource === "nextcloud" && <>
                <p className="text-sm">Updates only add new media. Removing links or files from Nextcloud never deletes gallery media, tags or captions. Changed files at the same source path are not replaced.</p>
                {isEditing && !sourcesLoaded && !sourcesError && <p role="status">Loading saved sources…</p>}
                {sourcesError && <p role="alert">{sourcesError}</p>}
                {isEditing && sourcesLoaded && !savedLinks.length && <p>No saved sources. Historical links cannot be recovered; enter them once and choose Save sources.</p>}
                {savedLinks.length > 0 && <p role="status">{savedLinks.length} saved {pluralize(savedLinks.length, "source", "sources")}{sourcesDirty ? " · Unsaved changes" : " · No import started by saving sources"}</p>}
                 <p className="text-sm text-muted-foreground">Public folder links from nextcloud.vco-motorsports.com, nextcloud.bs-plus.de or a separately configured instance work without a Nextcloud account. Both /s/TOKEN and /index.php/s/TOKEN are supported. Enter a share password below if needed. Internal links require the instance and Nextcloud access to be configured by an administrator. All links and subfolders are imported into this gallery.</p>
                {links.map((entry, i) => (
                  <div className="space-y-2 border-b pb-3" key={i}>
                    <Label htmlFor={`nc-link-${i}`}>Folder link {i + 1}</Label>
                     <Input id={`nc-link-${i}`} type="url" value={entry.link} placeholder="https://nextcloud.vco-motorsports.com/index.php/s/TOKEN"
                      onChange={e => { const next = [...links]; next[i] = { ...entry, link: e.target.value }; setLinks(next); setPreview(null); }} />
                    <Input aria-label={`Share password for link ${i + 1}`} type="password" autoComplete="off"
                      placeholder={entry.hasPassword && !entry.removePassword ? "Saved password kept (enter to replace)" : "Share password (if needed)"} value={entry.password}
                      onChange={e => { const next = [...links]; next[i] = { ...entry, password: e.target.value }; setLinks(next); setPreview(null); }} />
                    <Label htmlFor={`nc-credit-${i}`}>Photographer / Videographer for link {i + 1}</Label>
                    <Input id={`nc-credit-${i}`} maxLength={150} value={entry.photographer || ""} aria-describedby={`nc-credit-help-${i}`}
                      onChange={e => { const next = [...links]; next[i] = { ...entry, photographer: e.target.value }; setLinks(next); setPreview(null); }} />
                    <p id={`nc-credit-help-${i}`} className="text-sm text-muted-foreground">Optional. Applies only to newly imported files from this source, not to existing media or a running import. Independent of the uploading account and tags.</p>
                    {entry.hasPassword && <Button type="button" variant="ghost" onClick={() => {
                      const next = [...links]; next[i] = { ...entry, password: "", removePassword: !entry.removePassword }; setLinks(next); setPreview(null);
                    }}>{entry.removePassword ? "Keep saved password" : "Remove saved password"}</Button>}
                    <Button type="button" variant="ghost" onClick={() => { setLinks(links.filter((_, index) => index !== i)); setPreview(null); }}>Remove link</Button>
                  </div>
                ))}
                 <div className="flex flex-wrap gap-2">
                   <Button type="button" variant="outline" disabled={links.length >= 10} onClick={() => setLinks([...links, { link: "", password: "" }])}>Add another link</Button>
                    <Button type="button" variant="outline" disabled={previewBusy || importBusy || sourcesBusy || (isEditing && !sourcesLoaded)} onClick={checkLinks}>{previewBusy ? "Checking access…" : "Check access and media"}</Button>
                    {importEventId && <>
                      <Button type="button" variant="outline" disabled={sourcesBusy || importBusy || activeImport || (isEditing && !sourcesLoaded)} onClick={saveSourceLinks}>{sourcesBusy ? "Saving sources…" : "Save sources"}</Button>
                      <Button type="button" disabled={sourcesBusy || importBusy || activeImport || !savedLinks.length || sourcesDirty || (isEditing && !sourcesLoaded)} onClick={updateGallery}>{importBusy ? "Scanning…" : "Update gallery"}</Button>
                      {sourcesDirty && <p className="text-sm">Save source changes before updating the gallery.</p>}
                    </>}
                </div>
                 {preview && <p role="status">{preview.count === 0 ? "No supported media found. " : ""}{preview.images} {pluralize(preview.images, "image", "images")} and {preview.videos} {pluralize(preview.videos, "video", "videos")} found; {preview.skipped} {pluralize(preview.skipped, "file", "files")} skipped.</p>}
                {importProgress && <div role="status" className="text-sm space-y-1">
                  {importProgress.run && <>
                    <p>Current run: {importProgress.status} · {importProgress.run.found} found · {importProgress.run.existing} already present · {importProgress.run.imported} newly imported · {importProgress.run.skipped} skipped · {importProgress.run.failed} failed</p>
                    {importProgress.status === "completed" && importProgress.run.found === 0 && <p>No supported media found</p>}
                    {importProgress.status === "completed" && importProgress.run.found > 0 && importProgress.run.existing === importProgress.run.found && <p>All supported media already present. No new media imported.</p>}
                  </>}
                   <p>Historical totals: {importProgress.imported}/{importProgress.total} {pluralize(importProgress.total, "file", "files")} ({importProgress.importedImages} {pluralize(importProgress.importedImages, "image", "images")}, {importProgress.importedVideos} {pluralize(importProgress.importedVideos, "video", "videos")}) · {importProgress.warnings} analysis {pluralize(importProgress.warnings, "warning", "warnings")}</p>
                  {importProgress.error && <p className="text-amber-600">{importProgress.error}</p>}
                  {importProgress.budgets && <p className="text-xs text-muted-foreground">
                    Per file: images {importProgress.budgets.imageBytes / 1048576} MiB, videos {importProgress.budgets.videoBytes / 1048576} MiB.
                    {" "}New source transfers per run: {importProgress.budgets.transferBytes / 1048576} MiB.
                    {" "}Stored event budget: {importProgress.budgets.eventStoredBytes / 1048576} MiB, including existing media, posters and active reservations.
                  </p>}
                  <p>Analysis: {importProgress.analysisPending || 0} media {pluralize(importProgress.analysisPending, "item", "items")} waiting or being processed · {importProgress.analysisCompleted || 0} complete. Files are already saved. Matching runs automatically with a confirmed applicable entry list, including photos saved before the list.</p>
                  <div className="max-h-28 overflow-y-auto">
                    {importProgress.files.filter(file => file.message || file.aiWarning || file.analysisStatus === "failed").map((file, index) =>
                      <div key={index}>{file.name}: {file.message || (file.aiWarning || file.analysisStatus === "failed" ? "Analysis failed. You can retry." : "")}
                        {file.failure && <span className="text-xs"> ({file.failure.stage}: {file.failure.code})</span>}
                        {file.mediaId && (file.aiWarning || file.analysisStatus === "failed") && <Button type="button" variant="outline" size="sm"
                          onClick={async () => {
                            try {
                              await nextcloudPost(`/api/media/${file.mediaId}/analyze`, { retry: true });
                              await queryClient.invalidateQueries({ queryKey: [`/api/admin/events/${importEventId}/nextcloud`] });
                             } catch { toast({ title: "Analysis unavailable", description: "Analysis could not be completed. Please try again.", variant: "destructive" }); }
                          }}>Retry analysis</Button>}
                      </div>)}
                  </div>
                  {["partial", "error"].includes(importProgress.status) && <Button type="button" variant="outline"
                    onClick={async () => {
                      try { await nextcloudPost(`/api/admin/events/${importEventId}/nextcloud/resume`, {});
                        await queryClient.invalidateQueries({ queryKey: [`/api/admin/events/${importEventId}/nextcloud`] }); }
                      catch (error) { toast({ title: "Import could not resume", description: error instanceof Error ? error.message : "Check the links again", variant: "destructive" }); }
                    }}>Resume failed files</Button>}
                   <p>Imports resume automatically after a server restart. Saved media is not duplicated or reanalysed. Sources stay encrypted until removed; temporary recovery access expires within 24 hours. Saved passwords are never returned to your browser.</p>
                </div>}
              </>}
            </div>
          )}

           {creationBlocked.length > 0 && <div role="status" className="rounded-md border p-3 text-sm">
             <p className="font-medium">Before you can create this event:</p>
             <ul className="list-disc pl-5">{creationBlocked.map(reason => <li key={reason}>{reason}</li>)}</ul>
           </div>}
           <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={checkingSave || thumbnailBusy || createMutation.isPending || updateMutation.isPending || importBusy}
            >
              Cancel
            </Button>
             <Button
              type={createdEventId && !isEditing && (imageSource !== "nextcloud" || importStarted) ? "button" : "submit"}
              onClick={createdEventId && !isEditing && (imageSource !== "nextcloud" || importStarted) ? () => onOpenChange(false) : undefined}
               disabled={unknownSave || creationBlocked.length > 0 || checkingSave || thumbnailBusy || sourcesBusy || createMutation.isPending || updateMutation.isPending || importBusy || previewBusy || (!isEditing && imageSource === "nextcloud" && !preview && !createdEventId)}
              className="bg-primary text-black hover:bg-primary/90"
            >
                {referenceImportRecovery?.status==="uploading" ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving reference...</>
                ) : createdEventId && !isEditing && !importBusy && importStarted ? "Close — import continues" : createdEventId && !isEditing && imageSource !== "nextcloud" && !importBusy ? "Done" : createMutation.isPending || updateMutation.isPending || importBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {isEditing ? "Updating..." : "Creating..."}
                </>
              ) : imageSource === "nextcloud" && !isEditing ? (
                importEventId || isEditing ? "Start / resume import" : "Create event and import"
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
