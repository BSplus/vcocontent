import { Share2, Facebook, Linkedin, Link, Instagram } from "lucide-react";
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
}

export function ShareMenu({ url, title, description, className }: ShareMenuProps) {
  const { toast } = useToast();

  const shareUrls = {
    x: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent([title, description].filter(Boolean).join("\n"))}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    instagram: `instagram://camera`
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
    // Show a toast explaining how to share on Instagram
    toast({
      title: "Instagram Sharing",
      description: "To share on Instagram, save the image and share it via the Instagram app.",
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Share" className={className}>
          <Share2 className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => window.open(shareUrls.x, '_blank')}>
          <SiX className="h-4 w-4 mr-2" />
          Share on X
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.open(shareUrls.facebook, '_blank')}>
          <Facebook className="h-4 w-4 mr-2" />
          Share on Facebook
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.open(shareUrls.linkedin, '_blank')}>
          <Linkedin className="h-4 w-4 mr-2" />
          Share on LinkedIn
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
  );
}