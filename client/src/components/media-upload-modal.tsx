import { useEffect, useState, useRef } from "react";
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
import { Progress } from "@/components/ui/progress";
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
import { Loader2, Image as ImageIcon, Film, Upload, X } from "lucide-react";
import { extractIPTCMetadata } from "@/lib/iptc"; // Added import statement

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
}

export default function MediaUploadModal({
  open,
  onOpenChange,
  eventId,
}: MediaUploadModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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

  //Updated function for better video type validation
  function isValidVideoType(file: File): boolean {
    // Check file extension first
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.mp4') || fileName.endsWith('.mov')) {
      return true;
    }
    // Fallback to MIME type check
    const validTypes = [
      'video/mp4',
      'video/quicktime', // For .mov files
      'video/webm',
      'video/ogg'
    ];
    return validTypes.includes(file.type);
  }

  function isValidImageType(file: File): boolean {
    // Add zip to valid types
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/zip'];
    return validTypes.includes(file.type) || file.name.toLowerCase().endsWith('.zip');
  }

  const handleFilesChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const maxSize = form.getValues("type") === "video" ? 200 * 1024 * 1024 : 10 * 1024 * 1024;
    const newUploads: FileUpload[] = [];

    for (const file of files) {
      // Handle ZIP files
      if (file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip')) {
        toast({
          title: "ZIP files",
          description: "ZIP file upload is not yet supported. Please upload individual image files.",
          variant: "destructive",
        });
        continue;
      }

      // Rest of the validation logic remains unchanged
      const isValid = form.getValues("type") === "video"
        ? isValidVideoType(file)
        : isValidImageType(file);

      if (!isValid) {
        toast({
          title: "Error",
          description: `Invalid file type: ${file.name}. Please upload ${form.getValues("type") === "video" ? "MP4 or MOV" : "JPG, PNG, or GIF"} files only.`,
          variant: "destructive",
        });
        continue;
      }

      if (file.size > maxSize) {
        const sizeInMB = (file.size / (1024 * 1024)).toFixed(1);
        const limit = form.getValues("type") === "video" ? "200MB" : "10MB";
        toast({
          title: "Error",
          description: `File ${file.name} is too large. Maximum size is ${limit}. File size: ${sizeInMB}MB`,
          variant: "destructive",
        });
        continue;
      }

      const preview = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

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
    mutationFn: async (data: InsertMediaItem) => {
      const res = await apiRequest("POST", "/api/media", data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Upload failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/${eventId}/media`] });
    },
  });

  const handleBulkUpload = async () => {
    try {
      setUploading(true);
      const pendingUploads = uploads.filter(u => u.status === 'pending');

      for (const upload of pendingUploads) {
        try {
          upload.status = 'uploading';
          setUploads([...uploads]);

          const tags = typeof form.getValues("tags") === 'string'
            ? form.getValues("tags").split(',').map(tag => tag.trim()).filter(Boolean)
            : (form.getValues("tags") || []);

          const mediaItem: InsertMediaItem = {
            eventId,
            type: form.getValues("type"),
            url: upload.preview,
            thumbnail: upload.preview,
            caption: form.getValues("caption"),
            photographer: form.getValues("photographer"),
            tags,
          };

          await uploadMutation.mutateAsync(mediaItem);

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

      toast({
        title: "Success",
        description: `Successfully uploaded ${pendingUploads.length} files`,
      });

      onOpenChange(false);
      form.reset();
      setUploads([]);
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
            <div className="flex items-center justify-between">
              <Label htmlFor="type">Type</Label>
              <span className="text-xs text-muted-foreground">
                Maximum file size: {form.getValues("type") === "video" ? "200MB" : "10MB"}
              </span>
            </div>
            <Select
              onValueChange={(value) => {
                form.setValue("type", value as "image" | "video");
                setUploads([]); // Clear uploads when changing type
              }}
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

          <Input
            type="file"
            ref={mediaInputRef}
            className="hidden"
            accept={form.getValues("type") === "image" ? "image/*,.zip" : ".mp4,.mov"}
            onChange={handleFilesChange}
            multiple
          />

          <div className="space-y-2">
            <Label>Media Files</Label>
            {uploads.length > 0 ? (
              <div className="max-h-[400px] overflow-y-auto pr-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div
                onClick={() => mediaInputRef.current?.click()}
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              >
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-8 w-8" />
                  <p>Click or drag files here to upload</p>
                  <p className="text-sm text-muted-foreground">
                    {form.getValues("type") === "video" ? "MP4 or MOV" : "JPG, PNG, or GIF"}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="caption">Caption (applies to all uploads)</Label>
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
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={uploading || uploads.length === 0}
              className="bg-primary text-black hover:bg-primary/90"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Uploading...
                </>
              ) : (
                `Upload ${uploads.length} ${uploads.length === 1 ? 'File' : 'Files'}`
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}