import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import type { MediaItem } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { downloadMedia } from "@/lib/media-download";
import DownloadOptionLabel from "@/components/download-option-label";
import { Button } from "@/components/ui/button";
import MainNavigation from "@/components/main-navigation";
import Footer from "@/components/footer";
import MediaRightsNotice from "@/components/media-rights-notice";
import CommunityActions from "@/components/community-actions";
import { ShareMenu } from "@/components/share-menu";
import VideoPreview from "@/components/video-preview";
import { creditText, creditByline } from "@shared/media-credit";

export default function MediaDetail() {
  const [, params] = useRoute("/media/:id");
  const id = Number(params?.id);
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: item, isLoading, isError } = useQuery<MediaItem>({
    queryKey: [`/api/media/${id}`],
    enabled: Number.isSafeInteger(id) && id > 0,
    retry: false,
  });

  async function download(quality: "high" | "low") {
    if (!item) return;
    try {
      await downloadMedia(item, quality);
    } catch (error) {
      toast({ title: "Download unavailable", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    }
  }

  return <div className="min-h-screen bg-background">
    <MainNavigation />
    <main className="container mx-auto break-words px-4 py-5 md:py-8">
      {isLoading ? <p>Loading media…</p> : isError || !item ? <p>Media not found.</p> : <>
        <Link href={`/events/${item.eventId}`} className="text-primary underline">Back to event gallery</Link>
        <h1 className="mt-5 text-2xl font-bold">{item.caption || "Esports racing media"}</h1>
        {item.type === "image" && <div className="mt-4"><CommunityActions kind="media" id={item.id} title={item.caption || "photo"} /></div>}
        <div className="mt-4 md:mt-6 flex justify-center rounded-lg bg-black/40 p-1 md:p-3">
          {item.type === "video"
            ? <VideoPreview key={item.id} src={item.url} poster={item.thumbnail} signedIn={!!user} className="max-h-[75vh]" />
            : <img src={item.thumbnail} alt={item.caption || "Esports racing photo"} className="max-h-[75vh] max-w-full object-contain" />}
        </div>
        {item.photographer && <p className="mt-4">{creditText(item)}</p>}
        <div className="mt-4 md:mt-6 flex flex-wrap gap-2 md:gap-3 [&>button]:min-h-11 [&>a]:min-h-11">
          <ShareMenu url={window.location.href} title={item.caption || (item.type === "video" ? "VCO video" : "VCO photo")} description={creditByline(item)} />
          <Button variant="outline" onClick={async () => {
            const configuredCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
            let sourceUrl = `${window.location.origin}${window.location.pathname}`;
            if (configuredCanonical) {
              try {
                const canonical = new URL(configuredCanonical);
                if (canonical.protocol === "https:" && canonical.pathname === window.location.pathname && !canonical.search && !canonical.hash && !canonical.username && !canonical.password) sourceUrl = canonical.href;
              } catch {
                // Ignore malformed canonical metadata and use the current page URL.
              }
            }
            const credit = [
              creditText(item),
              item.caption?.trim() || "",
              `Source: ${sourceUrl}`,
            ].filter(Boolean).join("\n");
            try {
              await navigator.clipboard.writeText(credit);
              toast({ title: "Credit and source copied" });
            } catch {
              toast({ title: "Could not copy credit and source", description: "Check clipboard permissions and try again.", variant: "destructive" });
            }
          }}>Copy credit &amp; source</Button>
          {user
            ? <Button onClick={() => download("high")}><DownloadOptionLabel item={item} quality="high" /></Button>
            : <Button asChild><Link href="/auth"><DownloadOptionLabel item={item} quality="high" /> · Register or sign in</Link></Button>}
          {item.type === "image" && <Button variant="outline" onClick={() => download("low")}><DownloadOptionLabel item={item} quality="low" /></Button>}
        </div>
        <div className="mt-4"><MediaRightsNotice /></div>
      </>}
    </main>
    <Footer />
  </div>;
}
