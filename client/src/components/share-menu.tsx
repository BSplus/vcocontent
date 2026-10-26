import { Share2, Facebook, Linkedin, Link, Instagram, Image } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { prepareSharingImage, sharingTimeout, supportsImageSharing, type SharingAsset } from "@/lib/image-sharing";
import { SiX } from "react-icons/si";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

interface ShareMenuProps {
  url: string;
  title?: string;
  description?: string;
  className?: string;
  asset?: SharingAsset;
}

export function ShareMenu(props: ShareMenuProps) {
  return <ShareMenuContent key={`${props.url}:${props.asset?.kind}:${props.asset?.id}`} {...props} />;
}

function ShareMenuContent({ url, title, description, className, asset }: ShareMenuProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState<Awaited<ReturnType<typeof prepareSharingImage>>>();
  const [preparing, setPreparing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const busy = useRef(false);
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      setReady(undefined); setStatus("The prepared preview expired. Please prepare it again.");
    }, 60_000);
    return () => clearTimeout(timer);
  }, [ready]);

  function close() {
    if (busy.current && sharing) return;
    controller.current?.abort();
    setOpen(false); setReady(undefined); setStatus("");
  }
  async function prepare() {
    if (busy.current || !asset) return;
    setOpen(true); setReady(undefined);
    if (!supportsImageSharing()) {
      setStatus("Image sharing is not supported on this device. Use Copy Link or an available download option. For Instagram, save an image only through an available, permitted download option and select it in the Instagram app.");
      return;
    }
    busy.current = true; setPreparing(true); setStatus("Preparing public image preview…");
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), sharingTimeout);
    try {
      const result = await prepareSharingImage(asset, abort.signal);
      if (!abort.signal.aborted) { setReady(result); setStatus("Ready. Choose a compatible app in your device’s sharing dialog. Apps may omit text, credits or the source link. Instagram is available only if your device offers it."); }
    } catch (error) {
      if (controller.current === abort) setStatus(abort.signal.aborted ? "Image preparation was cancelled or timed out. Please try again." :
        error instanceof Error ? error.message : "The public preview could not be prepared. Please try again.");
    } finally { clearTimeout(timer); busy.current = false; setPreparing(false); }
  }
  function share() {
    if (!ready || busy.current) return;
    busy.current = true; setSharing(true);
    // Called synchronously from the button: retain transient user activation.
    try {
      const result = navigator.share({ files: [ready.file], title,
        text: [title, ready.credit, `Source: ${url}`].filter(Boolean).join("\n"), url });
      void result.then(() => {
        setStatus("The image was handed to your device’s sharing dialog. This does not confirm a published post.");
        setReady(undefined);
      }).catch(handleShareError).finally(() => { busy.current = false; setSharing(false); });
    } catch (error) { handleShareError(error); busy.current = false; setSharing(false); }
  }
  function handleShareError(error: unknown) {
    setStatus(error instanceof DOMException && error.name === "AbortError" ? "Sharing cancelled. Nothing was confirmed as posted." :
      "The image could not be shared. Try again, or use Copy Link or an available download option.");
  }

  const shareUrls = {
    x: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent([title, description].filter(Boolean).join("\n"))}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link copied",
        description: "The link has been copied to your clipboard.",
      });
    } catch (err) {
      toast({
        title: "Failed to copy",
        description: "Please try copying the link manually.",
        variant: "destructive",
      });
    }
  };

  const handleInstagramShare = () => {
    if (asset && supportsImageSharing()) { void prepare(); return; }
    toast({
      title: "Instagram Sharing",
      description: "Instagram cannot receive an image through a web link. Use an available, permitted download option to save an image, then select it in the Instagram app. This does not publish a post.",
    });
  };

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Share" className={className}>
          <Share2 className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {asset && <DropdownMenuItem disabled={preparing || sharing} onSelect={() => void prepare()}>
          <Image className="h-4 w-4 mr-2" />Share image…
        </DropdownMenuItem>}
        <DropdownMenuItem onClick={() => window.open(shareUrls.x, '_blank', 'noopener,noreferrer')}>
          <SiX className="h-4 w-4 mr-2" />
          Share link on X
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.open(shareUrls.facebook, '_blank', 'noopener,noreferrer')}>
          <Facebook className="h-4 w-4 mr-2" />
          Share link on Facebook
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.open(shareUrls.linkedin, '_blank', 'noopener,noreferrer')}>
          <Linkedin className="h-4 w-4 mr-2" />
          Share link on LinkedIn
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleInstagramShare}>
          <Instagram className="h-4 w-4 mr-2" />
          Share on Instagram
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copyToClipboard}>
          <Link className="h-4 w-4 mr-2" />
          Copy Link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Share image</DialogTitle>
          <DialogDescription>Share a public photo preview, video poster or gallery thumbnail — not the original file. Check reuse rights before posting.</DialogDescription>
        </DialogHeader>
        <p role="status">{status}</p>
        {ready ? <Button disabled={sharing} onClick={share}>{sharing ? "Sharing…" : "Share image…"}</Button> :
          <Button disabled={preparing || sharing} onClick={() => void prepare()}>{preparing ? "Preparing…" : "Prepare image"}</Button>}
      </DialogContent>
    </Dialog>
    </>
  );
}