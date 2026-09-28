import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import JSZip from 'jszip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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

interface MediaUploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number;
}

interface FileUpload {
  file: File;
  preview: string;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
  aiWarning?: string;
  aiTags?: string[];
}

const IMAGE_LIMIT = 32 * 1024 * 1024;
export default function MediaUploadModal({
  open,
  onOpenChange,
  eventId,
}: MediaUploadModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: limits } = useQuery<{ imageBytes: number; videoBytes: number; maxPixels: number; zipCount: number; zipBytes: number }>({
    queryKey: ["/api/media/policy"],
  });
  const imageLimit = limits?.imageBytes ?? IMAGE_LIMIT;
  const videoLimit = limits?.videoBytes ?? VIDEO_LIMIT;
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [autoTagEnabled, setAutoTagEnabled] = useState(true);
  const [tagsInput, setTagsInput] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");

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
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
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
          throw new Error(`ZIP exceeds the ${imageLimit / 1048576} MiB/image or 100 MiB expanded limit`);
        unpacked += declared;
        const blob = await file.async('blob');
        if (blob.size > imageLimit || blob.size !== declared) throw new Error(`ZIP image exceeds ${imageLimit / 1048576} MiB`);
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

  const handleFilesChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
        const limit = `${maxSize / 1048576} MiB`;
        toast({
          title: "Error",
          description: `File ${file.name} is too large. Maximum size is ${limit}. File size: ${sizeInMB}MB`,
          variant: "destructive",
        });
        continue;
      }

      const preview = form.getValues("type") === "video"
        ? URL.createObjectURL(file)
        : await processImageFile(file);
      newUploads.push({
        file,
        preview,
        progress: 0,
        status: 'pending'
      });
    }

    setUploads(prev => [...prev, ...newUploads]);
  };

  const uploadMutation = useMutation({
    mutationFn: async ({ upload, tags, caption, photographer }: {
      upload: FileUpload;
      tags: string[];
      caption: string;
      photographer: string;
    }): Promise<MediaItem> => {
      const formData = new FormData();
      formData.append("file", upload.file);
      formData.append("type", upload.file.type.startsWith("video/") ? "video" : "image");
      formData.append("caption", caption);
      formData.append("photographer", photographer);
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
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: query =>
        String(query.queryKey[0]).startsWith(`/api/events/${eventId}/media`) });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/media-usage"] });
    },
  });

  const handleBulkUpload = async () => {
    try {
      if ((form.getValues("caption") || "").length > 1000) {
        toast({ title: "Caption too long", description: "Maximum 1000 characters.", variant: "destructive" });
        return;
      }
      setUploading(true);
      const pendingUploads = uploads.filter(u => u.status === 'pending');

      for (const upload of pendingUploads) {
        try {
          upload.status = 'uploading';
          setUploads([...uploads]);

          // Process tags from tagsInput (comma-separated string)
          const tags: string[] = tagsInput
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean);

          const mediaResponse = await uploadMutation.mutateAsync({
            upload,
            tags,
            caption: form.getValues("caption") || "",
            photographer: form.getValues("photographer") || "",
          });
          
          // If auto-tagging is enabled, analyze the uploaded media
          if (autoTagEnabled && mediaResponse && mediaResponse.id) {
            try {
              const tagResponse = await fetch(`/api/media/${mediaResponse.id}/analyze`, {
                method: "POST",
                credentials: "include",
              });
              const result = await tagResponse.json();
              if (!tagResponse.ok) {
                 upload.aiWarning = tagResponse.status === 503
                    ? "KI-Analyse ist noch nicht eingerichtet. Das Bild wurde trotzdem gespeichert."
                    : tagResponse.status === 502
                      ? "KI-Anbieteraufruf fehlgeschlagen. Das Bild wurde trotzdem gespeichert. Bitte später erneut versuchen."
                      : "KI-Analyse konnte nicht durchgeführt werden. Das Bild wurde trotzdem gespeichert.";
              } else if (result.success === true && Array.isArray(result.generatedTags) && result.generatedTags.length > 0 && result.generatedTags.every((tag: unknown) => typeof tag === "string")) {
                upload.aiTags = result.generatedTags;
              } else {
                upload.aiWarning = "KI-Analyse lieferte keine gültigen Tags.";
              }
            } catch (tagError) {
              upload.aiWarning = "KI-Analyse nicht erreichbar. Das Bild wurde trotzdem gespeichert.";
            }
          }

          upload.status = 'success';
          upload.progress = 100;
          setUploads([...uploads]);

        } catch (error) {
          upload.status = 'error';
          upload.error = error instanceof Error ? error.message : 'Upload failed';
          setUploads([...uploads]);
          console.error('Failed to upload file:', upload.file.name, error);
        }
      }

      const successfulCount = pendingUploads.filter(upload => upload.status === "success").length;
      const failedCount = pendingUploads.length - successfulCount;
      const aiWarningCount = pendingUploads.filter(upload => upload.aiWarning).length;
      const aiSuccessCount = pendingUploads.filter(upload => upload.aiTags?.length).length;
      const aiWarningDetails = pendingUploads.find(upload => upload.aiWarning)?.aiWarning;
      toast({
        title: failedCount || aiWarningCount ? "Upload completed with notices" : "Success",
        description: `${successfulCount} file${successfulCount === 1 ? "" : "s"} uploaded${failedCount ? `; ${failedCount} failed` : ""}${aiSuccessCount ? `; KI-Tags für ${aiSuccessCount} erstellt` : ""}${aiWarningCount ? `; AI tagging unavailable for ${aiWarningCount}: ${aiWarningDetails}` : ""}.`,
        variant: failedCount ? "destructive" : undefined,
      });

      // Keep successful files visible so creators can inspect the generated tags.
    } catch (error) {
      console.error('Bulk upload error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to upload files",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const removeUpload = (index: number) => {
    setUploads(uploads.filter((_, i) => i !== index));
  };

  useEffect(() => {
    if (!open) {
      form.reset();
      setUploads([]);
      setTagsInput("");
    }
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
       <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Media</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); handleBulkUpload(); }} className="space-y-4">
          <div className="space-y-2">
             <div className="flex flex-wrap items-center justify-between gap-1">
              <Label htmlFor="type">Type</Label>
              <span className="text-xs text-muted-foreground">
                 Maximum file size: {mediaType === "video" ? `${videoLimit / 1048576} MiB` : `${imageLimit / 1048576} MiB · ${((limits?.maxPixels ?? 40000000) / 1000000).toFixed(0)} MP`}
              </span>
            </div>
            <Select
              onValueChange={(value) => {
                 const type = value as "image" | "video";
                 setMediaType(type);
                 form.setValue("type", type);
                setUploads([]); // Clear uploads when changing type
              }}
               value={mediaType}
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
                      {upload.status === 'error' && (
                        <p className="text-sm text-destructive mt-1">{upload.error}</p>
                      )}
                      {upload.aiWarning && (
                        <p className="text-sm text-amber-600 mt-1">{upload.aiWarning}</p>
                      )}
                      {upload.aiTags && (
                        <p className="text-sm text-green-700 mt-1" role="status">
                          KI-Tags erstellt: {upload.aiTags.join(", ")}
                        </p>
                      )}
                      {upload.status === 'success' && !upload.aiTags && !upload.aiWarning && (
                        <p className="text-sm text-green-700 mt-1">Upload abgeschlossen</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
               <button type="button"
                 onClick={() => mediaInputRef.current?.click()}
                 className="w-full border-2 border-dashed rounded-lg p-4 sm:p-8 text-center cursor-pointer hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary transition-colors"
              >
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-8 w-8" />
                  <p>Click or drag files here to upload</p>
                  <p className="text-sm text-muted-foreground">
                     {mediaType === "video" ? `MP4, MOV or WebM · ${videoLimit / 1048576} MiB` : `JPG, PNG, GIF, WebP or ZIP · ${imageLimit / 1048576} MiB/image; ZIP 100 images / 100 MiB`}
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
            <Textarea
              id="caption"
               maxLength={1000}
              {...form.register("caption")}
              className="min-h-[100px] touch-auto"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="photographer">Photographer</Label>
            <Input
              id="photographer"
              {...form.register("photographer")}
              className="touch-auto"
            />
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

           <div className="flex flex-wrap items-center gap-2">
            <Switch 
              id="auto-tag" 
              checked={autoTagEnabled}
              onCheckedChange={setAutoTagEnabled}
            />
            <Label htmlFor="auto-tag" className="text-sm font-medium">
              Automatisch Sim-Racing Tags generieren
            </Label>
             <div>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <Info className="h-4 w-4 cursor-help text-muted-foreground" />
                </HoverCardTrigger>
                <HoverCardContent className="w-80 p-3">
                  <p className="text-sm">
                    Aktiviert die KI-basierte automatische Erkennung von Tags wie: Front View, Rear View, Aerial View, 
                    Side View, Onboard View, Group, Crash, Atmosphere, Day/Night, Rain/Wet Track, GT Car, Formula Car, usw.
                  </p>
                </HoverCardContent>
              </HoverCard>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            KI-Tagging ist nur verfügbar, wenn der Analyse-Service aktiv ist. Fehler werden pro Datei angezeigt.
          </p>

           <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={uploading || !uploads.some(upload => upload.status === "pending")}
              className="bg-primary text-black hover:bg-primary/90"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                `Upload ${uploads.filter(upload => upload.status === "pending").length} ${uploads.filter(upload => upload.status === "pending").length === 1 ? 'File' : 'Files'}`
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const ZIP_LIMIT = 100 * 1024 * 1024;

const VIDEO_LIMIT = 50 * 1024 * 1024;

const ZIP_COUNT = 100;
