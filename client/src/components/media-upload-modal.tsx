import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import JSZip from 'jszip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
   DialogTitle,
   DialogDescription,
} from "@/components/ui/dialog";
import { 
  HoverCard, 
  HoverCardContent, 
  HoverCardTrigger 
} from "@/components/ui/hover-card";
import { Switch } from "@/components/ui/switch";
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
import { InsertMediaItem, MediaItem, insertMediaItemSchema } from "@shared/schema";
import { Loader2, Upload, X, Info } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { analysisPending, requestAnalysis, type AnalysisState } from "@/hooks/use-media-analysis";
import { useAuth } from "@/hooks/use-auth";
import LegalLinks from "@/components/legal-links";
import { mediaCreditSchema, uploadCreditLabel } from "@shared/media-credit";
import { resumableUpload, cancelResumableUpload, hasResumableUploadRecord, ResumableRejected, UploadPaused } from "@/lib/resumable-upload";

interface MediaUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number;
}

interface FileUpload {
  file: File;
  preview: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'unknown' | 'paused';
  resumable?: boolean;
  error?: string;
  aiWarning?: string;
  aiTags?: string[];
  mediaId?: number;
  aiStatus?: AnalysisState["status"];
}

const IMAGE_LIMIT = 5_000_000;
class UploadRejected extends Error {}
const backgroundNotice = "AI analysis and safety checks are separate and may still be running or need attention. Saving does not confirm publication; unchecked media stays private. Check status or retry analysis in Edit Media.";
export default function MediaUploadModal({
  open,
  onOpenChange,
  eventId,
}: MediaUploadModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: limits } = useQuery<{ imageBytes: number; videoBytes: number; maxPixels: number; zipCount: number; zipBytes: number; community: boolean; resumableUploads?:boolean }>({
    queryKey: [`/api/media/policy?eventId=${eventId}`],
  });
  const imageLimit = limits?.imageBytes ?? IMAGE_LIMIT;
  const videoLimit = limits?.videoBytes ?? 0;
  const community = limits?.community ?? true;
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const previewUrls = useRef(new Set<string>());
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const uploadLock = useRef(false);
  const uploadAbort = useRef<AbortController|null>(null);
  const selectionLock = useRef(false);
  const [selecting, setSelecting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const busy = uploading || selecting;
  const [autoTagEnabled, setAutoTagEnabled] = useState(true);
  const [tagsInput, setTagsInput] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const jobQuery = useQuery<(AnalysisState & { mediaId: number })[]>({
    queryKey: [`/api/events/${eventId}/analysis`],
    enabled: open && uploads.some(u => u.mediaId && analysisPending(u.aiStatus)),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: query => query.state.fetchFailureCount < 3 &&
      (query.state.data?.some(job => analysisPending(job.status)) ?? true) ? 4000 : false,
  });
  useEffect(() => {
    if (!jobQuery.data) return;
    setUploads(previous => previous.map(upload => {
      const job = jobQuery.data.find(job => job.mediaId === upload.mediaId);
      if (!job) return upload;
      return { ...upload, aiStatus: job.status, aiTags: job.tags || undefined,
        aiWarning: job.error || undefined };
    }));
    queryClient.invalidateQueries({ predicate: query =>
      String(query.queryKey[0]).startsWith(`/api/events/${eventId}/media`) ||
      String(query.queryKey[0]).startsWith("/api/creator/media") ||
      String(query.queryKey[0]).startsWith("/api/media") });
  }, [jobQuery.data, eventId]);
  const retryTags = async (upload: FileUpload) => {
    if (!upload.mediaId) return;
    try {
      const job = await requestAnalysis(upload.mediaId, true);
      setUploads(previous => previous.map(u => u.mediaId === upload.mediaId
        ? { ...u, aiStatus: job.status, aiWarning: job.error || undefined } : u));
      queryClient.invalidateQueries({ queryKey: [`/api/events/${eventId}/analysis`] });
    } catch (error) {
      toast({ title: "Analysis unavailable", description: "Analysis could not be completed. Please try again from Edit Media.", variant: "destructive" });
    }
  };

  const form = useForm<InsertMediaItem>({
    resolver: zodResolver(insertMediaItemSchema),
    defaultValues: {
      eventId,
      type: "image",
      url: "",
      thumbnail: "",
      caption: "",
      photographer: "",
      tags: [], // Must be an array of strings
    },
  });

  function isValidVideoType(file: File): boolean {
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.mp4') || fileName.endsWith('.mov')) {
      return true;
    }
    const validTypes = [
      'video/mp4',
      'video/quicktime',
      'video/webm',
    ];
    return validTypes.includes(file.type);
  }

  function isValidImageType(file: File): boolean {
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/zip'];
    return validTypes.includes(file.type) || file.name.toLowerCase().endsWith('.zip');
  }

  const processImageFile = async (file: File): Promise<string> => {
    const url = URL.createObjectURL(file);
    previewUrls.current.add(url);
    return url;
  };

  const handleZipFile = async (zipFile: File) => {
    try {
      if (zipFile.size > ZIP_LIMIT) throw new Error("ZIP exceeds 100 MiB");
      const zip = new JSZip();
      const contents = await zip.loadAsync(zipFile);
      const imageFiles: FileUpload[] = [];
      const entries = Object.entries(contents.files).filter(([filename, file]) =>
        !file.dir && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(filename.toLowerCase().split('.').pop() || ''));
      if (entries.length > ZIP_COUNT || uploads.length + entries.length > ZIP_COUNT)
        throw new Error(`ZIP selection exceeds ${ZIP_COUNT} images`);
      let unpacked = 0;

      for (const [filename, file] of entries) {
        const ext = filename.toLowerCase().split('.').pop();
        // JSZip exposes the declared uncompressed size; reject bombs before
        // allocating a Blob. Also check the actual expanded size afterwards.
        const declared = (file as any)._data?.uncompressedSize;
        if (!Number.isSafeInteger(declared) || declared < 1 || declared > imageLimit || unpacked + declared > ZIP_LIMIT)
          throw new Error(`ZIP exceeds the ${imageLimit.toLocaleString("en-US")} bytes/image or 100 MiB expanded limit`);
        unpacked += declared;
        const blob = await file.async('blob');
        if (blob.size > imageLimit || blob.size !== declared) throw new Error(`ZIP image exceeds ${imageLimit.toLocaleString("en-US")} bytes`);
        const imageFile = new File([blob], filename, {
          type: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
            ext === 'png' ? 'image/png' :
              ext === 'webp' ? 'image/webp' : 'image/gif'
        });

        const preview = await processImageFile(imageFile);
        imageFiles.push({
          file: imageFile,
          preview,
          progress: 0,
          status: 'pending'
        });
      }

      if (imageFiles.length === 0) {
        toast({
          title: "No valid images",
          description: "The ZIP file doesn't contain supported images.",
          variant: "destructive",
        });
        return;
      }

      setUploads(prev => [...prev, ...imageFiles]);
      toast({
        title: "Success",
        description: `Extracted ${imageFiles.length} images from ZIP file.`,
      });
    } catch (error) {
      console.error('Failed to process ZIP file:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to process ZIP file.",
        variant: "destructive",
      });
    }
  };

  const handleFilesChange = async (event: {target:{files:FileList|null}}) => {
    if (uploadLock.current || selectionLock.current) return;
    selectionLock.current = true;
    setSelecting(true);
    try {
    const files = Array.from(event.target.files || []);
      const maxSize = form.getValues("type") === "video" ? videoLimit : imageLimit;
    const newUploads: FileUpload[] = [];

    for (const file of files) {
      // Handle ZIP files
      if (file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip')) {
        if (mediaType !== "image") {
          toast({ title: "ZIP contains images only", variant: "destructive" });
          continue;
        }
        await handleZipFile(file);
        continue;
      }

      // Regular file validation
      const isValid = form.getValues("type") === "video"
        ? isValidVideoType(file)
        : isValidImageType(file);

      if (!isValid) {
        toast({
          title: "Error",
          description: `Invalid file type: ${file.name}. Use ${form.getValues("type") === "video" ? "MP4, MOV or WebM" : "JPG, PNG, GIF or WebP"}.`,
          variant: "destructive",
        });
        continue;
      }

      if (file.size > maxSize) {
        const sizeInMB = (file.size / (1024 * 1024)).toFixed(1);
        const limit = mediaType === "image" && community ? "5 MB (5,000,000 bytes)" : `${maxSize / 1048576} MiB`;
        toast({
          title: "Error",
          description: `File ${file.name} is too large. Maximum size is ${limit}. File size: ${sizeInMB}MB`,
          variant: "destructive",
        });
        continue;
      }

      const preview = await processImageFile(file);
      newUploads.push({
        file,
        preview,
        progress: 0,
        status: 'pending'
      });
    }

    setUploads(prev => [...prev, ...newUploads]);
    } finally {
      if (mediaInputRef.current) mediaInputRef.current.value = "";
      selectionLock.current = false;
      setSelecting(false);
    }
  };

  const uploadMutation = useMutation({
    // Uploads are not idempotent: a lost response may follow a committed save.
    retry: false,
    mutationFn: async ({ upload, tags, caption, photographer }: {
      upload: FileUpload;
      tags: string[];
      caption: string;
      photographer: string;
    }): Promise<MediaItem> => {
      if(user && (limits?.resumableUploads || hasResumableUploadRecord(upload.file,user.id,eventId))){
        upload.resumable=true;
        setUploads(previous=>previous.map(u=>u.file===upload.file?{...u,resumable:true}:u));
        const controller=new AbortController();uploadAbort.current=controller;
        try{return await resumableUpload({file:upload.file,userId:user.id,eventId,
          metadata:{type:upload.file.type.startsWith("video/")?"video":"image",caption,photographer,tags,
            autoTag:upload.file.type.startsWith("video/") || autoTagEnabled},
          signal:controller.signal,onProgress:progress=>setUploads(previous=>previous.map(u=>u.file===upload.file?{...u,progress}:u))});
        }finally{uploadAbort.current=null;}
      }
      const formData = new FormData();
      formData.append("file", upload.file);
      formData.append("type", upload.file.type.startsWith("video/") ? "video" : "image");
      formData.append("caption", caption);
      formData.append("photographer", photographer);
      formData.append("autoTag", String(upload.file.type.startsWith("video/") || autoTagEnabled));
      formData.append("tags", JSON.stringify(tags));

      const res = await fetch(`/api/events/${eventId}/media/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const responseText = await res.text();
        let message = responseText || `Upload failed (${res.status})`;
        try {
          const error = JSON.parse(responseText);
          message = error.error || error.message || message;
        } catch {
          // Preserve the server's plain-text error message.
        }
        if (res.status >= 400 && res.status < 500) throw new UploadRejected(message);
        throw new Error("Save not confirmed");
      }
      const media = await res.json();
      if (!Number.isSafeInteger(media?.id) || media.id <= 0 || media.eventId !== eventId)
        throw new Error("Save not confirmed");
      return media;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/creator/usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/creator/media"] });
      queryClient.invalidateQueries({ queryKey: ["/api/creator/events"] });
      queryClient.invalidateQueries({ predicate: query =>
        String(query.queryKey[0]).startsWith(`/api/events/${eventId}/media`) });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/media-usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
    },
  });

  const handleBulkUpload = async () => {
    if (uploadLock.current || selectionLock.current) return;
    const batch = uploads.map(upload => ({ ...upload }));
    const pendingUploads = batch.filter(u => u.status === 'pending' || u.status==="paused" || u.status==="unknown" && u.resumable);
    if (!pendingUploads.length) return;
    const updateUpload = (upload: FileUpload, changes: Partial<FileUpload>) => {
      Object.assign(upload, changes);
      setUploads(previous => previous.map(u => u.file === upload.file ? { ...u, ...changes } : u));
    };
    try {
      const credit = mediaCreditSchema.safeParse(form.getValues("photographer") || "");
      if (!credit.success) {
        toast({ title: "Credit too long", description: "Maximum 150 characters.", variant: "destructive" });
        return;
      }
      if ((form.getValues("caption") || "").length > 1000) {
        toast({ title: "Caption too long", description: "Maximum 1000 characters.", variant: "destructive" });
        return;
      }
      uploadLock.current = true;
      setUploading(true);
      setAttempted(true);

      for (const upload of pendingUploads) {
        try {
          updateUpload(upload, { status: "uploading", error: undefined });

          // Process tags from tagsInput (comma-separated string)
          const tags: string[] = tagsInput
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean);

          const mediaResponse = await uploadMutation.mutateAsync({
            upload,
            tags,
            caption: form.getValues("caption") || "",
            photographer: credit.data,
          });
          
          // Analysis commits with the saved media; never await the model here.
          updateUpload(upload, { mediaId: mediaResponse.id, status: "success", progress: 100,
             aiStatus: (mediaResponse as MediaItem & {analysis?: AnalysisState}).analysis?.status ??
               (community || upload.file.type.startsWith("video/") || autoTagEnabled ? "queued" : "not_requested") });

        } catch (error) {
          updateUpload(upload, { status: error instanceof UploadPaused?"paused":error instanceof UploadRejected || error instanceof ResumableRejected ? "error" : "unknown",
            error: error instanceof UploadPaused || error instanceof ResumableRejected || upload.resumable && error instanceof Error ? error.message : error instanceof UploadRejected ? error.message :
              "Save not confirmed. This file may already be stored. Check Manage Media before selecting it again; it will not be automatically retried." });
          if(error instanceof UploadPaused) break;
        }
      }

      if (batch.every(upload => upload.status === "success")) {
        toast({ title: `${batch.length} file${batch.length === 1 ? "" : "s"} saved`,
          description: backgroundNotice, duration: 12000 });
        onOpenChange(false);
      }
      // Refresh even uncertain outcomes, without repeating a non-idempotent POST.
      queryClient.invalidateQueries({ queryKey: ["/api/creator/usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/creator/media"] });
      queryClient.invalidateQueries({ queryKey: ["/api/creator/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/media-usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/media"] });
      queryClient.invalidateQueries({ predicate: query =>
        String(query.queryKey[0]).startsWith(`/api/events/${eventId}/media`) });
    } catch (error) {
      console.error('Bulk upload error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to upload files",
        variant: "destructive",
      });
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  };

  const removeUpload = async (index: number) => {
    if (uploadLock.current || selectionLock.current) return;
    if(user && hasResumableUploadRecord(uploads[index].file,user.id,eventId)){
      try{await cancelResumableUpload(uploads[index].file,user.id,eventId);}
      catch(error){toast({title:"Upload not removed",description:error instanceof Error?error.message:"Cancellation not confirmed.",variant:"destructive"});return;}
    }
    URL.revokeObjectURL(uploads[index].preview);
    previewUrls.current.delete(uploads[index].preview);
    setUploads(previous=>previous.filter(u=>u.file!==uploads[index].file));
  };

  useEffect(() => {
    if (!open) {
      previewUrls.current.forEach(url => URL.revokeObjectURL(url));
      previewUrls.current.clear();
      form.reset();
      setUploads([]);
      setTagsInput("");
      setMediaType("image");
      setAutoTagEnabled(true);
      setAttempted(false);
    }
  }, [open, form]);
  useEffect(() => () => {
    uploadAbort.current?.abort();
    previewUrls.current.forEach(url => URL.revokeObjectURL(url));
    previewUrls.current.clear();
  }, []);

  return (
    <Dialog open={open} onOpenChange={next => {
      if (!uploadLock.current && !selectionLock.current) onOpenChange(next);
    }}>
       <DialogContent className="max-w-2xl" closeDisabled={busy}
         onEscapeKeyDown={event => { if (uploadLock.current || selectionLock.current) event.preventDefault(); }}
         onInteractOutside={event => { if (uploadLock.current || selectionLock.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Upload Media</DialogTitle>
          <DialogDescription>Matching runs automatically with a saved applicable entry list, even when optional photo tagging is off. Files are saved separately from background analysis and publication checks.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); handleBulkUpload(); }} className="space-y-4">
          {attempted && <div role={uploading ? "status" : "alert"} className="rounded border border-border p-3 text-sm space-y-2">
            <p className="font-semibold">{uploads.filter(u => u.status === "success").length} saved · {uploads.filter(u => u.status === "error").length} rejected · {uploads.filter(u => u.status === "unknown").length} unconfirmed · {uploads.filter(u => u.status === "pending" || u.status === "uploading" || u.status==="paused").length} remaining</p>
            <p>{uploading ? "Uploading — please keep this dialog open." : "Rejected files can be retried below. Unconfirmed files may already be saved; check Manage Media before uploading them again."}</p>
            <p>{backgroundNotice}</p>
          </div>}
          <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="space-y-2">
             <div className="flex flex-wrap items-center justify-between gap-1">
              <Label htmlFor="type">Media type</Label>
              <span className="text-xs text-muted-foreground">
                 Maximum file size: {mediaType === "video" ? `${(videoLimit / 1048576).toFixed(0)} MiB` : `${(imageLimit / (community ? 1000000 : 1048576)).toFixed(0)} ${community ? "MB" : "MiB"} · ${((limits?.maxPixels ?? 40000000) / 1000000).toFixed(0)} MP`}
              </span>
            </div>
            {!community && <Select
              onValueChange={(value) => {
                 if (uploadLock.current || selectionLock.current) return;
                 const type = value as "image" | "video";
                 setMediaType(type);
                 form.setValue("type", type);
                 previewUrls.current.forEach(url => URL.revokeObjectURL(url));
                 previewUrls.current.clear();
                 setUploads([]);
                 setAttempted(false);
              }}
               value={mediaType}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select media type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="image">Image</SelectItem>
                {videoLimit > 0 && <SelectItem value="video">Video</SelectItem>}
              </SelectContent>
            </Select>}
            {community && <p className="text-sm text-muted-foreground">Community galleries accept photos only, up to 5 MB per image.</p>}
          </div>

          <Input
            type="file"
            ref={mediaInputRef}
            className="hidden"
             accept={mediaType === "image" ? ".jpg,.jpeg,.png,.gif,.webp,.zip" : ".mp4,.mov,.webm"}
            onChange={handleFilesChange}
            multiple
          />

          <div className="space-y-2">
            <Label>Media Files</Label>
            {uploads.length > 0 ? (
              <div className="max-h-[400px] overflow-y-auto pr-2">
                 <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
                  {uploads.map((upload, index) => (
                    <div key={index} className="relative">
                      <div className="relative aspect-square rounded-lg overflow-hidden bg-black/20">
                        <img
                          src={upload.preview}
                          alt={`Upload preview ${index + 1}`}
                          className="w-full h-full object-contain"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-2 right-2"
                           aria-label={`Remove ${upload.file.name}`}
                          onClick={() => removeUpload(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        {upload.status === 'uploading' && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <div className="text-center">
                              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                              <p className="text-sm">Uploading...</p>
                            </div>
                          </div>
                        )}
                      </div>
                      <p className="mt-1 break-all text-xs font-medium">{upload.file.name}</p>
                      {upload.resumable && <p role="status" className="text-xs text-muted-foreground mt-1">{upload.progress}% transferred{upload.status==="paused"?" · Paused":""}</p>}
                      {(upload.status === 'error' || upload.status === "unknown" || upload.status==="paused") && (
                        <p className="text-sm text-destructive mt-1">{upload.error}</p>
                      )}
                      {upload.status === "error" && <Button type="button" size="sm" variant="outline" disabled={uploading}
                        onClick={() => setUploads(previous => previous.map(u => u === upload
                          ? { ...u, status: "pending", error: undefined } : u))}>Retry upload</Button>}
                      {upload.aiWarning && (
                        <p className="text-sm text-amber-600 mt-1">Analysis failed. You can retry from Edit Media.</p>
                      )}
                      {upload.status === "success" && analysisPending(upload.aiStatus) && (
                          <p role="status" className="text-muted-foreground text-xs mt-1">Saved · Adding tags in the background…</p>
                      )}
                      {upload.aiStatus === "failed" && (
                        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => retryTags(upload)}>Retry analysis</Button>
                      )}
                      {upload.aiTags && (
                        <p className="text-sm text-green-700 mt-1" role="status">
                          Tags added
                        </p>
                      )}
                      {upload.status === 'success' && !upload.aiTags && !upload.aiWarning && (
                        <p className="text-sm text-green-700 mt-1">File saved</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
               <button type="button"
                 onClick={() => mediaInputRef.current?.click()}
                 onDragOver={event=>{event.preventDefault();event.dataTransfer.dropEffect="copy";}}
                 onDrop={event=>{event.preventDefault();if (!uploading) void handleFilesChange({target:{files:event.dataTransfer.files}});}}
                 className="w-full border-2 border-dashed rounded-lg p-4 sm:p-8 text-center cursor-pointer hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary transition-colors"
              >
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-8 w-8" />
                  <p>Click or drag files here to upload</p>
                  <p className="text-sm text-muted-foreground">
                     {mediaType === "video" ? `MP4, MOV or WebM · ${videoLimit / 1048576} MiB` : `JPG, PNG, GIF, WebP or ZIP · ${community ? "5 MB (5,000,000 bytes)" : `${imageLimit / 1048576} MiB`}/image; ZIP 100 images / 100 MiB`}
                  </p>
                </div>
               </button>
            )}
             {uploads.length > 0 && (
               <Button type="button" variant="outline" onClick={() => mediaInputRef.current?.click()}>
                 <Upload className="mr-2 h-4 w-4" /> Add more files
               </Button>
             )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="caption">Caption (applies to all uploads)</Label>
            {uploads.some(u => analysisPending(u.aiStatus)) && <p className="text-sm text-muted-foreground">
              Analysis continues in the background after you close this dialog. You can check its status or retry in Edit Media.
              {jobQuery.isError && " Status is temporarily unavailable; the files remain saved."}
            </p>}
            <Textarea
              id="caption"
               maxLength={1000}
              {...form.register("caption")}
              className="min-h-[100px] touch-auto"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="photographer">{uploadCreditLabel(uploads.map(u => u.file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(u.file.name) ? "video" : "image"))}</Label>
            <Input
              id="photographer"
              maxLength={150}
              aria-describedby="upload-credit-help"
              {...form.register("photographer")}
              className="touch-auto"
            />
            <p id="upload-credit-help" className="text-sm text-muted-foreground">Optional. This name applies to all files in this upload, independently of the uploading account and tags.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tagsInput">Tags (comma-separated)</Label>
            <Input
              id="tagsInput"
              placeholder="racing, action, pit-stop"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="touch-auto"
            />
          </div>

           <div className="space-y-2 text-sm leading-relaxed">
             <p>Only upload media you are entitled to share, including the rights of people shown or named.
               Media and metadata may be sent to Replit-managed OpenAI for tagging and a separate publication safety check.
               Failed or uncertain checks keep new content private. Private reference documents may also be processed by AI.</p>
             <LegalLinks />
           </div>
           <div className="flex flex-wrap items-center gap-2">
            <Switch 
              id="auto-tag" 
              checked={community || autoTagEnabled}
              disabled={community}
              onCheckedChange={setAutoTagEnabled}
            />
            <Label htmlFor="auto-tag" className="text-sm font-medium">
              Automatically tag images
            </Label>
             <div>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <Info className="h-4 w-4 cursor-help text-muted-foreground" />
                </HoverCardTrigger>
                <HoverCardContent className="w-80 p-3">
                  <p className="text-sm">
                    Adds visual tags such as Front View, Rear View, Aerial View, Side View, Onboard View, Pit Lane, Race Action, Night and Wet Track when supported by the image.
                  </p>
                </HoverCardContent>
              </HoverCard>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {community ? "Photo tagging runs automatically in the background. New files stay private until their safety check passes." : "Videos are analyzed automatically after upload. The AI tagging switch applies to images only. An analysis issue will not prevent your files from being saved."}
          </p>
          </fieldset>

           <div className="flex flex-wrap justify-end gap-2">
            {uploading && (limits?.resumableUploads || uploads.some(u=>u.resumable)) &&
              <Button type="button" variant="outline" onClick={()=>uploadAbort.current?.abort()}>Pause uploads</Button>}
            {!uploading && uploads.some(u=>u.resumable && u.status!=="success") &&
              <p className="w-full text-xs text-muted-foreground">Paused uploads expire after one hour. Reselect the same file to resume after reopening. Resume keeps the saved caption, credit and tags.</p>}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {attempted ? "Close" : "Cancel"}
            </Button>
            <Button
              type={uploads.some(upload => upload.status === "pending" || upload.status==="paused" || upload.status==="unknown" && upload.resumable) ? "submit" : "button"}
              disabled={busy || !uploads.length}
              onClick={() => {
                if (!uploads.some(upload => upload.status === "pending" || upload.status==="paused" || upload.status==="unknown" && upload.resumable)) onOpenChange(false);
              }}
              className="bg-primary text-black hover:bg-primary/90"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                uploads.some(upload => upload.status==="paused" || upload.status==="unknown" && upload.resumable) ? "Resume / check status" :
                uploads.some(upload => upload.status === "pending")
                  ? `Upload ${uploads.filter(upload => upload.status === "pending").length} ${uploads.filter(upload => upload.status === "pending").length === 1 ? "file" : "files"}`
                  : uploads.some(upload => upload.status !== "success") ? "Close" : uploads.length ? "Done — all files saved" : "Select files above"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const ZIP_LIMIT = 100 * 1024 * 1024;


const ZIP_COUNT = 100;
